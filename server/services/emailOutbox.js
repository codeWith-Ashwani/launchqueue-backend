const crypto = require("crypto");
const mongoose = require("mongoose");
const EmailOutbox = require("../models/EmailOutbox");
const Signup = require("../models/Signup");
const sendEmail = require("../utils/sendEmail");

function encryptionKey() {
  return crypto
    .createHash("sha256")
    .update(process.env.EMAIL_ENCRYPTION_KEY || process.env.JWT_SECRET)
    .digest();
}
function encrypt(message) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(message), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
function decrypt(value) {
  const data = Buffer.from(value, "base64");
  const cipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    data.subarray(0, 12),
  );
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(
      "utf8",
    ),
  );
}

async function recordEmail(
  { dedupeKey, kind, waitlistId, signupId, expiresAt, ...message },
  session = null,
) {
  return EmailOutbox.findOneAndUpdate(
    { dedupeKey },
    {
      $setOnInsert: {
        dedupeKey,
        kind,
        waitlistId,
        signupId,
        expiresAt,
        deliveryKey: crypto.randomUUID(),
        encryptedPayload: encrypt(message),
      },
    },
    { upsert: true, returnDocument: "after", session },
  );
}

async function deliverEmail(job, { leaseMs = 90000 } = {}) {
  const id = job.data.outboxId;
  const generation = job.data.generation || 0;
  const leaseToken = crypto.randomUUID();
  const item = await EmailOutbox.findOneAndUpdate(
    {
      _id: id,
      generation,
      state: { $in: ["pending", "queued", "processing"] },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lt: new Date() } }],
    },
    {
      $set: {
        state: "processing",
        leaseUntil: new Date(Date.now() + leaseMs),
        leaseToken,
      },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after" },
  ).select("+encryptedPayload");
  if (!item) {
    const current = await EmailOutbox.findById(id);
    if (
      !current ||
      current.state === "sent" ||
      current.generation !== generation
    )
      return;
    throw new Error("Delivery currently leased or unavailable");
  }
  try {
    if (!item.deliveryKey) {
      item.deliveryKey = crypto.randomUUID();
      const migrated = await EmailOutbox.updateOne(
        { _id: id, leaseToken },
        { $set: { deliveryKey: item.deliveryKey } },
      );
      if (!migrated.matchedCount) throw new Error("Delivery lease changed");
    }
    if (item.expiresAt && item.expiresAt <= new Date())
      throw new Error("Notification expired");
    await sendEmail({
      ...decrypt(item.encryptedPayload),
      messageId: `<${item._id}@launchqueue>`,
      deliveryKey: item.deliveryKey,
    });
    await mongoose.connection.transaction(async (session) => {
      const receipt = await EmailOutbox.updateOne(
        { _id: id, leaseToken },
        {
          $set: {
            state: "sent",
            sentAt: new Date(),
            leaseUntil: null,
            lastError: null,
          },
        },
        { session },
      );
      if (!receipt.matchedCount) throw new Error("Delivery lease changed");
      if (item.kind === "invitation")
        await Signup.updateOne(
          { _id: item.signupId, waitlistId: item.waitlistId },
          { $set: { status: "invited", invitationState: "sent" } },
          { session },
        );
    });
  } catch (err) {
    const finalAttempt =
      (job.attemptsMade || 0) + 1 >= (job.opts?.attempts || 1);
    const expired = item.expiresAt && item.expiresAt <= new Date();
    const failed = finalAttempt || expired;
    await EmailOutbox.updateOne(
      { _id: id, leaseToken },
      {
        $set: {
          state: failed ? "failed" : "queued",
          leaseUntil: null,
          lastError: expired ? "Notification expired" : "Email delivery failed",
        },
      },
    );
    if (failed && item.kind === "invitation")
      await Signup.updateOne(
        { _id: item.signupId, waitlistId: item.waitlistId },
        { $set: { invitationState: "failed" } },
      );
    throw err;
  }
}

async function dispatchInline(items) {
  if (process.env.EMAIL_DELIVERY_MODE === "queue") return;
  await Promise.allSettled(
    items.filter(Boolean).map((item) =>
      deliverEmail({
        data: { outboxId: item._id.toString(), generation: item.generation },
        opts: { attempts: 1 },
        attemptsMade: 0,
      }),
    ),
  );
}

async function dispatchPending(
  queue,
  limit = 100,
  { redispatchMs = 60000 } = {},
) {
  for (let i = 0; i < limit; i++) {
    const item = await EmailOutbox.findOneAndUpdate(
      {
        nextDispatchAt: { $lte: new Date() },
        $or: [
          { state: { $in: ["pending", "queued"] } },
          { state: "processing", leaseUntil: { $lt: new Date() } },
        ],
      },
      {
        $set: {
          state: "queued",
          nextDispatchAt: new Date(Date.now() + redispatchMs),
        },
      },
      { returnDocument: "after", sort: { nextDispatchAt: 1 } },
    );
    if (!item) break;
    try {
      const existing = await queue.getJob(`${item._id}-${item.generation}`);
      if (existing && (await existing.getState()) === "failed") {
        await existing.retry();
        continue;
      }
      await queue.add(
        "deliver",
        { outboxId: item._id.toString(), generation: item.generation },
        {
          jobId: `${item._id}-${item.generation}`,
          attempts: 5,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: { age: 86400, count: 1000 },
          removeOnFail: { age: 604800, count: 1000 },
        },
      );
    } catch {
      await EmailOutbox.updateOne(
        { _id: item._id, state: "queued", generation: item.generation },
        {
          $set: {
            state: "pending",
            nextDispatchAt: new Date(Date.now() + 5000),
          },
        },
      );
      break;
    }
  }
}

module.exports = { recordEmail, deliverEmail, dispatchInline, dispatchPending };
