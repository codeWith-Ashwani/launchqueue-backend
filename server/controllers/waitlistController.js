const mongoose = require("mongoose");
const { rankedSignups } = require("../services/ranking");
const Waitlist = require("../models/Waitlist");
const Signup = require("../models/Signup");
const { recordEmail, dispatchInline } = require("../services/emailOutbox");
const EmailOutbox = require("../models/EmailOutbox");
const invitedEmail = require("../templates/invitedEmail");

function escapeCsvField(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
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

    // generate a slug from the name: "RocketPay" -> "rocketpay"
    let baseSlug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    let slug = baseSlug;
    let suffix = 1;

    // if the slug is taken, append a number until it's unique
    while (await Waitlist.findOne({ slug })) {
      slug = `${baseSlug}-${suffix}`;
      suffix++;
    }

    const waitlist = await Waitlist.create({
      founderId: req.founder._id,
      name,
      slug,
      description: description || "",
    });

    res.status(201).json({ waitlist });
  } catch (err) {
    console.error("Waitlist create error:", err);
    res.status(err.status || 500).json({
      error: err.status ? err.message : process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// GET /api/waitlists  (protected) — list all of this founder's waitlists
async function list(req, res) {
  try {
    const waitlists = await Waitlist.find({ founderId: req.founder._id }).sort({ createdAt: -1 });

    // attach a signup count to each one
    const withCounts = await Promise.all(
      waitlists.map(async (w) => {
        const count = await Signup.countDocuments({ waitlistId: w._id });
        return { ...w.toObject(), signupCount: count };
      })
    );

    res.json({ waitlists: withCounts });
  } catch (err) {
    console.error("Waitlist list error:", err);
    res.status(err.status || 500).json({
      error: err.status ? err.message : process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// GET /api/waitlists/:id  (protected) — get one waitlist, must belong to this founder
async function getOne(req, res) {
  try {
    const waitlist = await Waitlist.findOne({ _id: req.params.id, founderId: req.founder._id });
    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }
    res.json({ waitlist });
  } catch (err) {
    console.error("Waitlist getOne error:", err);
    res.status(err.status || 500).json({
      error: err.status ? err.message : process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

async function update(req, res) {
  try {
    const allowedFields = [
      "name", "description", "thankYouMessage", "paused",
      "heroHeadline", "heroSubheadline", "heroImageUrl",
      "accentColor", "ctaText", "features", "milestones",
    ];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    const waitlist = await Waitlist.findOneAndUpdate(
      { _id: req.params.id, founderId: req.founder._id },
      updates,
      { new: true, runValidators: true }
    );

    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }

    res.json({ waitlist });
  } catch (err) {
    console.error("Waitlist update error:", err);
    res.status(err.status || 500).json({
      error: err.status ? err.message : process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
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

    const signups = await rankedSignups(waitlist._id);

    const header = "email,currentPosition,referralCount,referredBy,joinedAt\n";

    const rows = signups
      .map((s) => {
        const email = escapeCsvField(s.email);
        const currentPosition = escapeCsvField(s.currentPosition);
        const referralCount = escapeCsvField(s.referralCount ?? 0);
        const referredBy = escapeCsvField(s.referredBy ?? "");
        const joinedAt = escapeCsvField(s.createdAt ? s.createdAt.toISOString() : "");
        return `${email},${currentPosition},${referralCount},${referredBy},${joinedAt}`;
      })
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${waitlist.slug || "waitlist"}-signups.csv"`
    );

    res.status(200).send(header + (rows.length > 0 ? rows + "\n" : ""));
  } catch (err) {
    console.error("Waitlist exportSignups error:", err);
    res.status(err.status || 500).json({
      error: err.status ? err.message : process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
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
      await Waitlist.updateOne({ _id: waitlist._id }, { $inc: { queueVersion: 1 } }, { session });
      const ordered = await rankedSignups(waitlist._id, [], session);
      const target = ordered.find((entry) => entry._id.toString() === signupId);
      if (!target) throw Object.assign(new Error("Signup not found"), { status: 404 });
      if (currentPosition > ordered.length) throw Object.assign(new Error("Position exceeds queue size"), { status: 400 });
      const others = ordered.filter((entry) => entry._id.toString() !== signupId);
      const index = currentPosition - 1;
      const before = others[index - 1];
      const after = others[index];
      const score = before && after ? (before.queueScore + after.queueScore) / 2 :
        before ? before.queueScore + 1 : after ? after.queueScore - 1 : 1;
      // Equal-score neighbours need deterministic spacing before inserting.
      if (before && after && before.queueScore === after.queueScore) {
        for (let i = 0; i < others.length; i++) {
          await Signup.updateOne({ _id: others[i]._id }, { $set: {
            priorityOffset: (i + 1) * 10 - (others[i].basePosition - others[i].referralCount * 5),
          } }, { session });
        }
      }
      const effectiveScore = before && after && before.queueScore === after.queueScore ? (index + 0.5) * 10 : score;
      await Signup.updateOne({ _id: target._id }, { $set: {
        priorityOffset: effectiveScore - (target.basePosition - target.referralCount * 5), currentPosition,
      } }, { session });
      const [updated] = await rankedSignups(waitlist._id, [{ $match: { _id: target._id } }], session);
      return updated;
    });

    res.json({ signup });
  } catch (err) {
    console.error("Waitlist updateSignupPosition error:", err);
    res.status(err.status || 500).json({
      error: err.status ? err.message : process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
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
      await Waitlist.updateOne({ _id: waitlist._id }, { $inc: { queueVersion: 1 } }, { session });
      const selected = await Signup.find({ _id: { $in: signupIds }, waitlistId: waitlist._id, status: { $ne: "invited" } }).session(session);
      const queued = [];
      for (const signup of selected) {
        let email = await EmailOutbox.findOne({ dedupeKey: `invitation-${signup._id}` }).session(session);
        if (email && !["failed"].includes(email.state)) continue;
        if (email) {
          email = await EmailOutbox.findByIdAndUpdate(email._id, { $inc: { generation: 1 }, $set: {
            state: "pending", nextDispatchAt: new Date(), leaseUntil: null, lastError: null,
          } }, { session, returnDocument: "after" });
        } else {
          email = await recordEmail({ dedupeKey: `invitation-${signup._id}`, kind: "invitation", waitlistId: waitlist._id, signupId: signup._id,
            to: signup.email, subject: `You're invited to ${waitlist.name}!`,
            html: invitedEmail({ waitlistName: waitlist.name, thankYouMessage: waitlist.thankYouMessage }) }, session);
        }
        await Signup.updateOne({ _id: signup._id }, { $set: { invitationState: "queued" } }, { session });
        queued.push(email);
      }
      return queued;
    });
    await dispatchInline(emails);
    const deliveredCount = await EmailOutbox.countDocuments({ _id: { $in: emails.map((e) => e._id) }, state: "sent" });
    const failedCount = await EmailOutbox.countDocuments({ _id: { $in: emails.map((e) => e._id) }, state: "failed" });
    res.json({ invitedCount: deliveredCount, queuedCount: emails.length - deliveredCount - failedCount, failedCount });

  } catch (err) {
    console.error("Waitlist batchInvite error:", err);
    res.status(err.status || 500).json({
      error: err.status ? err.message : process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
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
