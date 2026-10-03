const Signup = require("../models/Signup");

// Scores order the queue; displayed positions are contiguous ranks, not scores.
function rankPipeline(waitlistId) {
  return [
    { $match: { waitlistId } },
    { $set: { queueScore: { $add: [
      { $subtract: ["$basePosition", { $multiply: [{ $ifNull: ["$referralCount", 0] }, 5] }] },
      { $ifNull: ["$priorityOffset", 0] },
    ] } } },
    { $set: { queueOrder: { score: "$queueScore", sequence: "$basePosition", id: "$_id" } } },
    { $set: { queueEligible: { $ne: [{ $ifNull: ["$verificationState", "legacy"] }, "pending"] } } },
    { $setWindowFields: {
      partitionBy: "$queueEligible",
      sortBy: { queueOrder: 1 },
      output: { currentPosition: { $documentNumber: {} } },
    } },
    { $set: { currentPosition: { $cond: ["$queueEligible", "$currentPosition", null] } } },
    { $sort: { queueEligible: -1, currentPosition: 1, basePosition: 1 } },
  ];
}

function rankedSignups(waitlistId, stages = [], session = null) {
  const query = Signup.aggregate([...rankPipeline(waitlistId), ...stages]).allowDiskUse(true);
  return session ? query.session(session) : query;
}

async function signupState(signup, waitlist, alreadyJoined = false) {
  const [ranked] = await rankedSignups(waitlist._id, [{ $match: { _id: signup._id } }]);
  return {
    position: ranked.currentPosition,
    basePosition: signup.basePosition,
    referralCount: signup.referralCount || 0,
    positionsGained: Math.max(0, signup.basePosition - ranked.currentPosition),
    refCode: signup.refCode,
    email: signup.email,
    waitlistName: waitlist.name,
    milestones: waitlist.milestones,
    alreadyJoined,
  };
}

module.exports = { rankPipeline, rankedSignups, signupState };
