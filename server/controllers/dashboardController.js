const Waitlist = require("../models/Waitlist");
const Signup = require("../models/Signup");

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
      .select("email referralCount currentPosition");

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
      totalSignups,
      signupsToday,
      referralRate,
      topReferrers,
      chartData,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getStats,
  exportCsv,
};