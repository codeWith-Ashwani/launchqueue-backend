const Signup = require("../models/Signup");

// Scores order the queue; displayed positions are contiguous ranks, not scores.
function rankPipeline(waitlistId) {
  return [
    { $match: { waitlistId } },
    {
      $set: {
        queueScore: {
          $add: [
            {
              $subtract: [
                "$basePosition",
                { $multiply: [{ $ifNull: ["$referralCount", 0] }, 5] },
              ],
            },
            { $ifNull: ["$priorityOffset", 0] },
          ],
        },
      },
    },
    {
      $set: {
        queueOrder: {
          score: "$queueScore",
          sequence: "$basePosition",
          id: "$_id",
        },
      },
    },
    {
      $set: {
        queueEligible: {
          $ne: [{ $ifNull: ["$verificationState", "legacy"] }, "pending"],
        },
      },
    },
    {
      $setWindowFields: {
        partitionBy: "$queueEligible",
        sortBy: { queueOrder: 1 },
        output: { currentPosition: { $documentNumber: {} } },
      },
    },
    {
      $set: {
        currentPosition: {
          $cond: ["$queueEligible", "$currentPosition", null],
        },
      },
    },
    { $sort: { queueEligible: -1, currentPosition: 1, basePosition: 1 } },
  ];
}

function rankedSignups(waitlistId, stages = [], session = null) {
  const query = Signup.aggregate([
    ...rankPipeline(waitlistId),
    ...stages,
  ]).allowDiskUse(true);
  return session ? query.session(session) : query;
}

// A page needs ordering, not a window calculation over every subscriber.
// Eligible members precede pending members, so the page offset is their rank.
function pagePipeline(waitlistId, page, limit) {
  return [
    { $match: { waitlistId } },
    {
      $set: {
        queueEligible: {
          $ne: [{ $ifNull: ["$verificationState", "legacy"] }, "pending"],
        },
        queueScore: {
          $add: [
            {
              $subtract: [
                "$basePosition",
                { $multiply: [{ $ifNull: ["$referralCount", 0] }, 5] },
              ],
            },
            { $ifNull: ["$priorityOffset", 0] },
          ],
        },
      },
    },
    { $set: { pageScore: { $cond: ["$queueEligible", "$queueScore", 0] } } },
    { $sort: { queueEligible: -1, pageScore: 1, basePosition: 1, _id: 1 } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
    {
      $project: {
        email: 1,
        refCode: 1,
        referralCount: 1,
        status: 1,
        invitationState: 1,
        verificationState: 1,
        createdAt: 1,
        queueEligible: 1,
      },
    },
  ];
}
async function rankedPage(waitlistId, page, limit) {
  const rows = await Signup.aggregate(
    pagePipeline(waitlistId, page, limit),
  ).allowDiskUse(true);
  return rows.map(({ queueEligible, ...row }, index) => ({
    ...row,
    currentPosition: queueEligible ? (page - 1) * limit + index + 1 : null,
  }));
}

async function signupState(signup, waitlist, alreadyJoined = false) {
  const [ranked] = await rankedSignups(waitlist._id, [
    { $match: { _id: signup._id } },
  ]);
  return {
    position: ranked.currentPosition,
    basePosition: signup.basePosition,
    referralCount: signup.referralCount || 0,
    positionsGained: Math.max(
      0,
      (signup.initialPosition ?? signup.basePosition) - ranked.currentPosition,
    ),
    refCode: signup.refCode,
    email: signup.email,
    waitlistName: waitlist.name,
    milestones: waitlist.milestones,
    alreadyJoined,
  };
}

// A small referrer list needs only its ranks. Count preceding compound keys in
// one campaign scan instead of sorting/windowing every full subscriber record.
async function rankedReferrers(waitlistId, refCodes) {
  // Keep candidate keys and preceding counts on the same database snapshot.
  return Signup.db.transaction(async (session) => {
  const candidates = await Signup.find({ waitlistId, refCode: { $in: refCodes }, verificationState: { $ne: "pending" } })
    .select("email refCode status referralCount basePosition priorityOffset").session(session).lean();
  if (!candidates.length) return [];
  const group = { _id: null };
  const orders = [];
  candidates.forEach((row, index) => {
    const order = { score: row.basePosition - (row.referralCount || 0) * 5 + (row.priorityOffset || 0), sequence: row.basePosition, id: row._id };
    orders.push(order);
    group[`rank${index}`] = { $sum: { $cond: [{ $lt: [{ $cmp: ["$queueOrder", { $literal: order }] }, 0] }, 1, 0] } };
  });
  const max = orders.reduce((a, b) => b.score > a.score || (b.score === a.score && (b.sequence > a.sequence || (b.sequence === a.sequence && b.id.toString() > a.id.toString()))) ? b : a);
  const [counts] = await Signup.aggregate([
    { $match: { waitlistId, verificationState: { $ne: "pending" } } },
    { $set: { queueScore: { $add: [{ $subtract: ["$basePosition", { $multiply: [{ $ifNull: ["$referralCount", 0] }, 5] }] }, { $ifNull: ["$priorityOffset", 0] }] } } },
    // Later keys cannot precede any candidate, so they need no per-target comparisons.
    { $match: { $expr: { $or: [
      { $lt: ["$queueScore", max.score] },
      { $and: [{ $eq: ["$queueScore", max.score] }, { $lt: ["$basePosition", max.sequence] }] },
      { $and: [{ $eq: ["$queueScore", max.score] }, { $eq: ["$basePosition", max.sequence] }, { $lt: ["$_id", max.id] }] },
    ] } } },
    { $project: { queueOrder: { score: "$queueScore", sequence: "$basePosition", id: "$_id" } } },
    { $group: group },
  ]).session(session);
  return candidates.map(({ basePosition: _base, priorityOffset: _offset, ...row }, index) => ({ ...row, currentPosition: (counts?.[`rank${index}`] || 0) + 1 }));
  }, { readConcern: { level: "snapshot" } });
}

module.exports = {
  rankPipeline,
  rankedSignups,
  signupState,
  pagePipeline,
  rankedPage,
  rankedReferrers,
};
