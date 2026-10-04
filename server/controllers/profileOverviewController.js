const Waitlist = require("../models/Waitlist");
const Signup = require("../models/Signup");
const { limitsFor } = require("../services/entitlements");
module.exports = async (req, res, next) => {
  try {
    const campaigns = await Waitlist.find({ founderId: req.founder._id }).select("name slug paused discoverable discoveryHidden createdAt").sort({ createdAt: -1, _id: -1 }).lean();
    const counts = await Signup.aggregate([
      { $match: { waitlistId: { $in: campaigns.map((c) => c._id) } } },
      { $group: { _id: "$waitlistId", signups: { $sum: 1 }, confirmed: { $sum: { $cond: [{ $ne: ["$verificationState", "pending"] }, 1, 0] } } } },
    ]);
    const map = new Map(counts.map((c) => [String(c._id), c]));
    const items = campaigns.map((c) => ({ ...c, signupCount: map.get(String(c._id))?.signups || 0, confirmedCount: map.get(String(c._id))?.confirmed || 0 }));
    const limits = limitsFor(req.founder);
    res.set("Cache-Control", "no-store").json({ campaigns: items,
      usage: { campaigns: items.length, signups: counts.reduce((total, c) => total + c.signups, 0), confirmed: counts.reduce((total, c) => total + c.confirmed, 0) },
      limits: { campaigns: Number.isFinite(limits.campaigns) ? limits.campaigns : null, signups: Number.isFinite(limits.signups) ? limits.signups : null },
    });
  } catch (error) { next(error); }
};
