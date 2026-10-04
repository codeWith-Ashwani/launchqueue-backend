const mongoose = require("mongoose");
const Founder = require("../models/Founder");
const Waitlist = require("../models/Waitlist");
const Signup = require("../models/Signup");
const EmailOutbox = require("../models/EmailOutbox");
const AdminAudit = require("../models/AdminAudit");
const { effectivePlan } = require("../services/entitlements");
function regex(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}
function paging(query, total) {
  return {
    page: query.page,
    limit: query.limit,
    total,
    pages: Math.max(1, Math.ceil(total / query.limit)),
  };
}
async function overview(_req, res, next) {
  try {
    const since = new Date(Date.now() - 7 * 86400000);
    const [
      founders,
      campaigns,
      subscribers,
      pendingVerification,
      newFounders,
      listedProducts,
      delivery,
      plans,
    ] = await Promise.all([
      Founder.countDocuments(),
      Waitlist.countDocuments(),
      Signup.countDocuments(),
      Signup.countDocuments({ verificationState: "pending" }),
      Founder.countDocuments({ createdAt: { $gte: since } }),
      Waitlist.countDocuments({
        discoverable: true,
        paused: { $ne: true },
        discoveryHidden: { $ne: true },
      }),
      EmailOutbox.aggregate([
        { $group: { _id: "$state", count: { $sum: 1 } } },
      ]),
      Founder.aggregate([
        {
          $group: {
            _id: { plan: "$plan", status: "$subscriptionStatus" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);
    res.json({
      totals: {
        founders,
        campaigns,
        subscribers,
        pendingVerification,
        newFounders,
        listedProducts,
      },
      delivery,
      plans,
    });
  } catch (error) {
    next(error);
  }
}
async function founders(req, res, next) {
  try {
    const q = req.validatedQuery;
    const match = q.search
      ? { $or: [{ name: regex(q.search) }, { email: regex(q.search) }] }
      : {};
    const [rows, total] = await Promise.all([
      Founder.find(match)
        .select(
          "name email plan authProvider subscriptionStatus subscriptionEndsAt createdAt",
        )
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Founder.countDocuments(match),
    ]);
    const counts = await Waitlist.aggregate([
      { $match: { founderId: { $in: rows.map((r) => r._id) } } },
      { $group: { _id: "$founderId", campaigns: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((r) => [String(r._id), r.campaigns]));
    res.json({
      items: rows.map((r) => ({
        ...r,
        effectivePlan: effectivePlan(r),
        campaignCount: countMap.get(String(r._id)) || 0,
      })),
      pagination: paging(q, total),
    });
  } catch (error) {
    next(error);
  }
}
async function campaigns(req, res, next) {
  try {
    const q = req.validatedQuery;
    const match = {};
    if (q.search)
      match.$or = [{ name: regex(q.search) }, { slug: regex(q.search) }];
    if (q.founderId) match.founderId = q.founderId;
    const [items, total] = await Promise.all([
      Waitlist.find(match)
        .select(
          "name slug founderId paused discoverable discoveryHidden createdAt",
        )
        .populate("founderId", "name email")
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Waitlist.countDocuments(match),
    ]);
    const counts = await Signup.aggregate([
      { $match: { waitlistId: { $in: items.map((r) => r._id) } } },
      { $group: { _id: "$waitlistId", subscribers: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((r) => [String(r._id), r.subscribers]));
    res.json({
      items: items.map((r) => ({
        ...r,
        signupCount: countMap.get(String(r._id)) || 0,
      })),
      pagination: paging(q, total),
    });
  } catch (error) {
    next(error);
  }
}
async function subscribers(req, res, next) {
  try {
    const q = req.validatedQuery;
    const match = {};
    if (q.search) match.email = regex(q.search);
    if (q.waitlistId) match.waitlistId = q.waitlistId;
    const [items, total] = await Promise.all([
      Signup.find(match)
        .select(
          "email waitlistId status verificationState invitationState referralCount createdAt verifiedAt",
        )
        .populate("waitlistId", "name slug")
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Signup.countDocuments(match),
    ]);
    res.json({ items, pagination: paging(q, total) });
  } catch (error) {
    next(error);
  }
}
async function moderate(req, res, next) {
  try {
    const campaign = await mongoose.connection.transaction(async (session) => {
      const updated = await Waitlist.findByIdAndUpdate(
        req.params.id,
        { $set: { discoveryHidden: req.body.discoveryHidden } },
        { session, returnDocument: "after" },
      );
      if (!updated) return null;
      await AdminAudit.create(
        [
          {
            actorId: req.founder._id,
            campaignId: updated._id,
            action: req.body.discoveryHidden
              ? "hide-discovery"
              : "restore-discovery",
          },
        ],
        { session },
      );
      return updated;
    });
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    res.json({
      campaign: {
        _id: campaign._id,
        discoveryHidden: campaign.discoveryHidden,
      },
    });
  } catch (error) {
    next(error);
  }
}
module.exports = { overview, founders, campaigns, subscribers, moderate };
