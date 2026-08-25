const Waitlist = require("../models/Waitlist");
const Signup = require("../models/Signup");
const sendEmail = require("../utils/sendEmail");
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
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
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
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
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
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
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
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
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

    const signups = await Signup.find({
      waitlistId: waitlist._id,
    }).sort({ currentPosition: 1 });

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
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
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

    const signup = await Signup.findOne({
      _id: signupId,
      waitlistId: waitlist._id,
    });

    if (!signup) {
      return res.status(404).json({ error: "Signup not found" });
    }

    // Manual admin override: directly updates this signup's currentPosition.
    // Intentionally does NOT recalculate or shuffle other signups' positions.
    signup.currentPosition = currentPosition;
    await signup.save();

    res.json({ signup });
  } catch (err) {
    console.error("Waitlist updateSignupPosition error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
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

    // Filter to only signups that belong to this specific waitlist
    const validSignups = await Signup.find({
      _id: { $in: signupIds },
      waitlistId: waitlist._id,
    });

    if (validSignups.length === 0) {
      return res.json({ invitedCount: 0 });
    }

    const validIds = validSignups.map((s) => s._id);

    await Signup.updateMany(
      { _id: { $in: validIds } },
      { $set: { status: "invited" } }
    );

    // Send invitations concurrently via Promise.allSettled so individual email failures
    // do not block or abort the rest of the batch.
    // Note: For very high-volume production lists, a persistent background job queue (e.g., BullMQ)
    // would be the appropriate architectural upgrade.
    const emailPromises = validSignups.map((signup) =>
      sendEmail({
        to: signup.email,
        subject: `You're invited to ${waitlist.name}!`,
        html: invitedEmail({
          waitlistName: waitlist.name,
          thankYouMessage: waitlist.thankYouMessage,
        }),
      })
    );

    await Promise.allSettled(emailPromises);

    res.json({ invitedCount: validSignups.length });
  } catch (err) {
    console.error("Waitlist batchInvite error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
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
