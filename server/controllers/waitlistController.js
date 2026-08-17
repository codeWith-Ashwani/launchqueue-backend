const Waitlist = require("../models/Waitlist");
const Signup = require("../models/Signup");

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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
}

module.exports = { create, list, getOne, update };
