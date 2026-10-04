const { once } = require("events");
const Founder = require("../models/Founder");
const { limitsFor, quotaError } = require("../services/entitlements");
const mongoose = require("mongoose");
const { rankedSignups } = require("../services/ranking");
const Waitlist = require("../models/Waitlist");
const Signup = require("../models/Signup");
const { recordEmail, dispatchInline } = require("../services/emailOutbox");
const EmailOutbox = require("../models/EmailOutbox");
const invitedEmail = require("../templates/invitedEmail");

function escapeCsvField(val) {
  if (val === null || val === undefined) return "";
  const raw = String(val);
  const str = /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw;
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// POST /api/waitlists  (protected)
async function create(req, res) {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Waitlist name is required" });
    }

    const waitlist = await mongoose.connection.transaction(async (session) => {
      const owner = await Founder.findOneAndUpdate(
        { _id: req.founder._id },
        { $inc: { usageVersion: 1 } },
        { session, returnDocument: "after" },
      );
      const limits = limitsFor(owner);
      if (
        (await Waitlist.countDocuments({ founderId: owner._id }).session(
          session,
        )) >= limits.campaigns
      ) {
        throw quotaError(
          "Your plan's campaign limit has been reached. Upgrade to create another waitlist.",
        );
      }
      const baseSlug =
        name
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || "waitlist";
      let slug = baseSlug;
      let suffix = 1;
      while (await Waitlist.findOne({ slug }).session(session))
        slug = `${baseSlug}-${suffix++}`;
      const [created] = await Waitlist.create(
        [
          {
            ...req.body,
            founderId: owner._id,
            name,
            slug,
            description: description || "",
          },
        ],
        { session },
      );
      return created;
    });
    res.status(201).json({ waitlist });
  } catch (err) {
    console.error("Waitlist create error:", {
      requestId: req.requestId,
      code: err.code || "INTERNAL",
    });
    res.status(err.status || 500).json({
      ...(err.upgradeRequired ? { upgradeRequired: true } : {}),
      error: err.status
        ? err.message
        : process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
    });
  }
}

// GET /api/waitlists  (protected) — list all of this founder's waitlists
async function list(req, res) {
  try {
    const waitlists = await Waitlist.find({ founderId: req.founder._id }).sort({
      createdAt: -1,
    });

    const counts = await Signup.aggregate([
      { $match: { waitlistId: { $in: waitlists.map((w) => w._id) } } },
      { $group: { _id: "$waitlistId", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(
      counts.map((entry) => [entry._id.toString(), entry.count]),
    );
    const withCounts = waitlists.map((w) => ({
      ...w.toObject(),
      signupCount: countMap.get(w._id.toString()) || 0,
    }));
    res.json({ waitlists: withCounts });
  } catch (err) {
    console.error("Waitlist list error:", {
      requestId: req.requestId,
      code: err.code || "INTERNAL",
    });
    res.status(err.status || 500).json({
      ...(err.upgradeRequired ? { upgradeRequired: true } : {}),
      error: err.status
        ? err.message
        : process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
    });
  }
}

// GET /api/waitlists/:id  (protected) — get one waitlist, must belong to this founder
async function getOne(req, res) {
  try {
    const waitlist = await Waitlist.findOne({
      _id: req.params.id,
      founderId: req.founder._id,
    });
    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }
    res.json({ waitlist });
  } catch (err) {
    console.error("Waitlist getOne error:", {
      requestId: req.requestId,
      code: err.code || "INTERNAL",
    });
    res.status(err.status || 500).json({
      ...(err.upgradeRequired ? { upgradeRequired: true } : {}),
      error: err.status
        ? err.message
        : process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
    });
  }
}

async function update(req, res) {
  try {
    const allowedFields = [
      "name",
      "description",
      "thankYouMessage",
      "paused",
      "heroHeadline",
      "heroSubheadline",
      "heroImageUrl",
      "accentColor",
      "ctaText",
      "features",
      "milestones",
      "pageDesign",
      "discoverable",
    ];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    const waitlist = await Waitlist.findOneAndUpdate(
      { _id: req.params.id, founderId: req.founder._id },
      updates,
      { new: true, runValidators: true },
    );

    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }

    res.json({ waitlist });
  } catch (err) {
    console.error("Waitlist update error:", {
      requestId: req.requestId,
      code: err.code || "INTERNAL",
    });
    res.status(err.status || 500).json({
      ...(err.upgradeRequired ? { upgradeRequired: true } : {}),
      error: err.status
        ? err.message
        : process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
    });
  }
}

// GET /api/waitlists/:id/export  (protected)
async function exportSignups(req, res) {
  try {
    const waitlist = await Waitlist.findOne({
      _id: req.params.id,
      founderId: req.founder._id,
    });

    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }

    if (!limitsFor(req.founder).csv)
      return res
        .status(403)
        .json({
          error: "CSV export requires a paid plan",
          upgradeRequired: true,
        });
    const cursor = rankedSignups(waitlist._id).cursor({ batchSize: 100 });
    const cancellation = new AbortController();
    const closed = () => {
      cancellation.abort();
    };
    res.once("close", closed);
    try {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${waitlist.slug}-signups.csv"`,
      );
      res.write("email,currentPosition,referralCount,referredBy,joinedAt\n");
      for await (const signup of cursor) {
        if (res.destroyed) break;
        const row =
          [
            signup.email,
            signup.currentPosition,
            signup.referralCount || 0,
            signup.referredBy,
            signup.createdAt?.toISOString(),
          ]
            .map(escapeCsvField)
            .join(",") + "\n";
        if (!res.write(row))
          await once(res, "drain", { signal: cancellation.signal });
      }
      if (!res.destroyed) res.end();
    } finally {
      res.removeListener("close", closed);
      await cursor.close();
    }
  } catch (err) {
    if (res.headersSent) {
      if (!res.destroyed) res.destroy();
      return;
    }
    console.error("Waitlist exportSignups error:", {
      requestId: req.requestId,
      code: err.code || "INTERNAL",
    });
    res.status(err.status || 500).json({
      ...(err.upgradeRequired ? { upgradeRequired: true } : {}),
      error: err.status
        ? err.message
        : process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
    });
  }
}

// PATCH /api/waitlists/:id/signups/:signupId/position  (protected)
async function updateSignupPosition(req, res) {
  try {
    const { id, signupId } = req.params;
    const { currentPosition } = req.body;

    const waitlist = await Waitlist.findOne({
      _id: id,
      founderId: req.founder._id,
    });

    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }

    const signup = await mongoose.connection.transaction(async (session) => {
      // Serialize manual moves against concurrent joins and other moves.
      await Waitlist.updateOne(
        { _id: waitlist._id },
        { $inc: { queueVersion: 1 } },
        { session },
      );
      const ordered = await rankedSignups(waitlist._id, [], session);
      const target = ordered.find((entry) => entry._id.toString() === signupId);
      if (!target)
        throw Object.assign(new Error("Signup not found"), { status: 404 });
      if (target.verificationState === "pending")
        throw Object.assign(
          new Error("Subscriber must verify their email first"),
          { status: 400 },
        );
      const eligible = ordered.filter(
        (entry) => entry.verificationState !== "pending",
      );
      if (currentPosition > eligible.length)
        throw Object.assign(new Error("Position exceeds queue size"), {
          status: 400,
        });
      const others = eligible.filter(
        (entry) => entry._id.toString() !== signupId,
      );
      const index = currentPosition - 1;
      const before = others[index - 1];
      const after = others[index];
      const score =
        before && after
          ? (before.queueScore + after.queueScore) / 2
          : before
            ? before.queueScore + 1
            : after
              ? after.queueScore - 1
              : 1;
      // Equal-score neighbours need deterministic spacing before inserting.
      if (before && after && before.queueScore === after.queueScore) {
        for (let i = 0; i < others.length; i++) {
          await Signup.updateOne(
            { _id: others[i]._id },
            {
              $set: {
                priorityOffset:
                  (i + 1) * 10 -
                  (others[i].basePosition - others[i].referralCount * 5),
              },
            },
            { session },
          );
        }
      }
      const effectiveScore =
        before && after && before.queueScore === after.queueScore
          ? (index + 0.5) * 10
          : score;
      await Signup.updateOne(
        { _id: target._id },
        {
          $set: {
            priorityOffset:
              effectiveScore - (target.basePosition - target.referralCount * 5),
            currentPosition,
          },
        },
        { session },
      );
      const [updated] = await rankedSignups(
        waitlist._id,
        [{ $match: { _id: target._id } }],
        session,
      );
      return updated;
    });

    res.json({ signup });
  } catch (err) {
    console.error("Waitlist updateSignupPosition error:", {
      requestId: req.requestId,
      code: err.code || "INTERNAL",
    });
    res.status(err.status || 500).json({
      ...(err.upgradeRequired ? { upgradeRequired: true } : {}),
      error: err.status
        ? err.message
        : process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
    });
  }
}

// POST /api/waitlists/:id/signups/batch-invite  (protected)
async function batchInvite(req, res) {
  try {
    const { id } = req.params;
    const { signupIds } = req.body;

    const waitlist = await Waitlist.findOne({
      _id: id,
      founderId: req.founder._id,
    });

    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }

    const emails = await mongoose.connection.transaction(async (session) => {
      await Waitlist.updateOne(
        { _id: waitlist._id },
        { $inc: { queueVersion: 1 } },
        { session },
      );
      const selected = await Signup.find({
        _id: { $in: signupIds },
        waitlistId: waitlist._id,
        status: { $ne: "invited" },
        verificationState: { $ne: "pending" },
      }).session(session);
      const queued = [];
      for (const signup of selected) {
        let email = await EmailOutbox.findOne({
          dedupeKey: `invitation-${signup._id}`,
        }).session(session);
        if (email && !["failed"].includes(email.state)) continue;
        if (email) {
          email = await EmailOutbox.findByIdAndUpdate(
            email._id,
            {
              $inc: { generation: 1 },
              $set: {
                state: "pending",
                nextDispatchAt: new Date(),
                leaseUntil: null,
                lastError: null,
              },
            },
            { session, returnDocument: "after" },
          );
        } else {
          email = await recordEmail(
            {
              dedupeKey: `invitation-${signup._id}`,
              kind: "invitation",
              waitlistId: waitlist._id,
              signupId: signup._id,
              to: signup.email,
              subject: `You're invited to ${waitlist.name}!`,
              html: invitedEmail({
                waitlistName: waitlist.name,
                thankYouMessage: waitlist.thankYouMessage,
              }),
            },
            session,
          );
        }
        await Signup.updateOne(
          { _id: signup._id },
          { $set: { invitationState: "queued" } },
          { session },
        );
        queued.push(email);
      }
      return queued;
    });
    await dispatchInline(emails);
    const deliveredCount = await EmailOutbox.countDocuments({
      _id: { $in: emails.map((e) => e._id) },
      state: "sent",
    });
    const failedCount = await EmailOutbox.countDocuments({
      _id: { $in: emails.map((e) => e._id) },
      state: "failed",
    });
    res.json({
      invitedCount: deliveredCount,
      queuedCount: emails.length - deliveredCount - failedCount,
      failedCount,
    });
  } catch (err) {
    console.error("Waitlist batchInvite error:", {
      requestId: req.requestId,
      code: err.code || "INTERNAL",
    });
    res.status(err.status || 500).json({
      ...(err.upgradeRequired ? { upgradeRequired: true } : {}),
      error: err.status
        ? err.message
        : process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
    });
  }
}

module.exports = {
  create,
  list,
  getOne,
  update,
  exportSignups,
  updateSignupPosition,
  batchInvite,
};
