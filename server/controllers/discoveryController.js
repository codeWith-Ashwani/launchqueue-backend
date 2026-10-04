const Waitlist = require("../models/Waitlist");
async function leaderboard(req, res, next) {
  try {
    const { period, limit } = req.validatedQuery;
    const since = new Date(Date.now() - 7 * 86400000);
    const products = await Waitlist.aggregate([
      {
        $match: {
          discoverable: true,
          paused: { $ne: true },
          discoveryHidden: { $ne: true },
        },
      },
      {
        $lookup: {
          from: "founders",
          localField: "founderId",
          foreignField: "_id",
          as: "owner",
          pipeline: [{ $project: { _id: 1 } }],
        },
      },
      { $match: { "owner.0": { $exists: true } } },
      {
        $lookup: {
          from: "signups",
          let: { campaign: "$_id" },
          as: "counts",
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$waitlistId", "$$campaign"] },
                verificationState: { $ne: "pending" },
              },
            },
            {
              $group: {
                _id: null,
                members: { $sum: 1 },
                weeklyMembers: {
                  $sum: {
                    $cond: [
                      {
                        $gte: [
                          { $ifNull: ["$verifiedAt", "$createdAt"] },
                          since,
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      {
        $set: {
          members: { $ifNull: [{ $first: "$counts.members" }, 0] },
          weeklyMembers: { $ifNull: [{ $first: "$counts.weeklyMembers" }, 0] },
        },
      },
      {
        $sort:
          period === "week"
            ? { weeklyMembers: -1, members: -1, createdAt: -1, _id: 1 }
            : { members: -1, createdAt: -1, _id: 1 },
      },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          name: 1,
          slug: 1,
          description: { $substrCP: ["$description", 0, 240] },
          accentColor: 1,
          members: 1,
          weeklyMembers: 1,
        },
      },
    ]);
    res
      .set("Cache-Control", "no-store")
      .json({
        products: products.map((p, i) => ({ ...p, rank: i + 1 })),
        period,
        updatedAt: new Date(),
      });
  } catch (error) {
    next(error);
  }
}
module.exports = { leaderboard };
