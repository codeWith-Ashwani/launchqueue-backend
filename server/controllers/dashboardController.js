const Waitlist = require("../models/Waitlist");
const Signup = require("../models/Signup");
const PageView = require("../models/PageView");

// GET /api/waitlists/:id/stats (protected)
async function getStats(req, res) {
  try {
    const waitlist = await Waitlist.findOne({
      _id: req.params.id,
      founderId: req.founder._id,
    });

    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }

    const totalSignups = await Signup.countDocuments({
      waitlistId: waitlist._id,
    });

    // Count unique visitors from PageView records (fallback to at least totalSignups)
    const uniqueVisitors = (
      await PageView.distinct("visitorId", { waitlistId: waitlist._id })
    ).length;
    const totalVisitors = Math.max(uniqueVisitors, totalSignups);

    const conversionRate =
      totalVisitors > 0
        ? Math.min(100, Math.round((totalSignups / totalVisitors) * 100))
        : 0;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const signupsToday = await Signup.countDocuments({
      waitlistId: waitlist._id,
      createdAt: { $gte: startOfToday },
    });

    const referredCount = await Signup.countDocuments({
      waitlistId: waitlist._id,
      referredBy: { $ne: null },
    });

    const referralRate =
      totalSignups > 0
        ? Math.round((referredCount / totalSignups) * 100)
        : 0;

    const topReferrers = await Signup.find({
      waitlistId: waitlist._id,
      referralCount: { $gt: 0 },
    })
      .sort({ referralCount: -1 })
      .limit(10)
      .select("email referralCount currentPosition status");

    const signups = await Signup.find({
      waitlistId: waitlist._id,
    })
      .sort({ currentPosition: 1 })
      .select("email referralCount currentPosition status createdAt");

    // Signups grouped by day, last 30 days, for the chart
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const chartDataRaw = await Signup.aggregate([
      {
        $match: {
          waitlistId: waitlist._id,
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    const chartData = chartDataRaw.map((d) => ({
      date: d._id,
      signups: d.count,
    }));

    res.json({
      waitlist,
      totalVisitors,
      totalSignups,
      conversionRate,
      signupsToday,
      referralRate,
      topReferrers,
      signups,
      chartData,
    });
  } catch (err) {
    console.error("Dashboard getStats error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// GET /api/waitlists/:id/funnel (protected)
async function getFunnelStats(req, res) {
  try {
    const waitlist = await Waitlist.findOne({
      _id: req.params.id,
      founderId: req.founder._id,
    });

    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }

    const dateFilter = {};
    if (req.query.days) {
      const days = parseInt(req.query.days, 10);
      if (!isNaN(days) && days > 0) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        dateFilter.createdAt = { $gte: startDate };
      }
    }

    const totalPageViews = await PageView.countDocuments({
      waitlistId: waitlist._id,
      ...dateFilter,
    });

    const totalSignups = await Signup.countDocuments({
      waitlistId: waitlist._id,
      ...dateFilter,
    });

    const conversionRate =
      totalPageViews > 0
        ? Math.min(100, Math.round((totalSignups / totalPageViews) * 100))
        : 0;

    const directSignups = await Signup.countDocuments({
      waitlistId: waitlist._id,
      referredBy: null,
      ...dateFilter,
    });

    const referredSignups = await Signup.countDocuments({
      waitlistId: waitlist._id,
      referredBy: { $ne: null },
      ...dateFilter,
    });

    const topReferrers = await Signup.find({
      waitlistId: waitlist._id,
      referralCount: { $gt: 0 },
    })
      .sort({ referralCount: -1 })
      .limit(5)
      .select("email refCode referralCount currentPosition status");

    res.json({
      totalPageViews,
      totalSignups,
      conversionRate,
      directSignups,
      referredSignups,
      topReferrers,
    });
  } catch (err) {
    console.error("Dashboard getFunnelStats error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// GET /api/waitlists/:id/export (protected)
async function exportCsv(req, res) {
  try {
    const waitlist = await Waitlist.findOne({
      _id: req.params.id,
      founderId: req.founder._id,
    });

    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }

    // Gate CSV export behind a paid plan
    if (req.founder.plan === "free") {
      return res.status(403).json({
        error: "CSV export requires a paid plan",
        upgradeRequired: true,
      });
    }

    const signups = await Signup.find({
      waitlistId: waitlist._id,
    }).sort({ currentPosition: 1 });

    const header = "email,position,referralCount,joinedAt\n";

    const rows = signups
      .map(
        (s) =>
          `${s.email},${s.currentPosition},${s.referralCount},${s.createdAt.toISOString()}`
      )
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${waitlist.slug}-signups.csv"`
    );

    res.send(header + rows);
  } catch (err) {
    console.error("Dashboard exportCsv error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

module.exports = {
  getStats,
  getFunnelStats,
  exportCsv,
};