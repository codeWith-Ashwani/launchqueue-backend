const { rankedSignups } = require("../services/ranking");
const Waitlist = require("../models/Waitlist");
const Signup = require("../models/Signup");
const PageView = require("../models/PageView");
const { observe } = require("../services/telemetry");

async function visitors(waitlistId, filter = {}) {
  const [result] = await PageView.aggregate([
    { $match: { waitlistId, ...filter } },
    { $facet: { views: [{ $count: "count" }], unique: [{ $group: { _id: "$visitorId" } }, { $count: "count" }] } },
  ]);
  return { totalPageViews: result.views[0]?.count || 0, totalVisitors: result.unique[0]?.count || 0 };
}
async function topReferrers(waitlistId, filter = {}, limit = 10) {
  const credits = await Signup.aggregate([
    { $match: { waitlistId, verificationState: { $ne: "pending" }, referredBy: { $ne: null }, ...filter } },
    { $group: { _id: "$referredBy", count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }, { $limit: limit },
  ]);
  if (!credits.length) return [];
  const ranked = await rankedSignups(waitlistId, [{ $match: { refCode: { $in: credits.map((c) => c._id) } } },
    { $project: { email: 1, currentPosition: 1, refCode: 1, status: 1, referralCount: 1 } }]);
  return credits.flatMap((c) => { const row = ranked.find((s) => s.refCode === c._id); return row ? [{ ...row, totalReferralCount: row.referralCount, referralCount: c.count }] : []; });
}
async function owned(req) { return Waitlist.findOne({ _id: req.params.id, founderId: req.founder._id }); }
function failure(res) { res.status(500).json({ error: "Unable to load analytics" }); }

async function getStats(req, res) {
  try {
    const waitlist = await owned(req);
    if (!waitlist) return res.status(404).json({ error: "Waitlist not found" });
    const { page, limit } = req.validatedQuery;
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today); start.setUTCDate(start.getUTCDate() - 29);
    const [summary, traffic, signups, referrers] = await Promise.all([
      () => Signup.aggregate([{ $match: { waitlistId: waitlist._id } }, { $facet: {
        totals: [{ $group: { _id: null, total: { $sum: 1 }, pending: { $sum: { $cond: [{ $eq: ["$verificationState", "pending"] }, 1, 0] } },
          today: { $sum: { $cond: [{ $gte: ["$createdAt", today] }, 1, 0] } },
          referred: { $sum: { $cond: [{ $and: [{ $ne: ["$verificationState", "pending"] }, { $ne: ["$referredBy", null] }] }, 1, 0] } },
        } }],
        chart: [{ $match: { createdAt: { $gte: start } } }, { $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } }, count: { $sum: 1 },
        } }, { $sort: { _id: 1 } }],
      } }]),
      () => visitors(waitlist._id),
      () => rankedSignups(waitlist._id, [{ $skip: (page - 1) * limit }, { $limit: limit }, { $project: {
        email: 1, referralCount: 1, currentPosition: 1, status: 1, invitationState: 1, verificationState: 1, createdAt: 1,
      } }]),
      () => topReferrers(waitlist._id),
    ].map((action, i) => observe(["mongo.analytics.summary", "mongo.analytics.visitors", "mongo.analytics.ranking", "mongo.analytics.referrers"][i], action)));
    const totals = summary[0].totals[0] || { total: 0, pending: 0, today: 0, referred: 0 };
    const verified = totals.total - totals.pending;
    const chartData = Array.from({ length: 30 }, (_, i) => {
      const day = new Date(start); day.setUTCDate(day.getUTCDate() + i);
      const date = day.toISOString().slice(0, 10);
      return { date, signups: summary[0].chart.find((entry) => entry._id === date)?.count || 0 };
    });
    res.json({ waitlist, totalVisitors: traffic.totalVisitors, totalSignups: totals.total, verifiedSignups: verified, pendingSignups: totals.pending,
      conversionRate: traffic.totalVisitors ? Math.round(verified / traffic.totalVisitors * 100) : 0,
      signupsToday: totals.today, referralRate: verified ? Math.round(totals.referred / verified * 100) : 0,
      topReferrers: referrers, signups, chartData, timezone: "UTC",
      pagination: { page, limit, total: totals.total, totalPages: Math.ceil(totals.total / limit) },
    });
  } catch { failure(res); }
}
async function getFunnelStats(req, res) {
  try {
    const waitlist = await owned(req);
    if (!waitlist) return res.status(404).json({ error: "Waitlist not found" });
    const { days } = req.validatedQuery;
    const filter = days ? { createdAt: { $gte: new Date(Date.now() - days * 86400000) } } : {};
    const [traffic, summary, referrers] = await Promise.all([
      visitors(waitlist._id, filter),
      Signup.aggregate([{ $match: { waitlistId: waitlist._id, verificationState: { $ne: "pending" }, ...filter } },
        { $group: { _id: null, total: { $sum: 1 }, direct: { $sum: { $cond: [{ $eq: ["$referredBy", null] }, 1, 0] } } } }]),
      topReferrers(waitlist._id, filter, 5),
    ]);
    const totalSignups = summary[0]?.total || 0; const directSignups = summary[0]?.direct || 0;
    res.json({ ...traffic, totalSignups, directSignups, referredSignups: totalSignups - directSignups,
      conversionRate: traffic.totalVisitors ? Math.round(totalSignups / traffic.totalVisitors * 100) : 0, topReferrers: referrers });
  } catch { failure(res); }
}
module.exports = { getStats, getFunnelStats };
