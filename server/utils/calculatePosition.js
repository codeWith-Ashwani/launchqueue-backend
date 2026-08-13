const WEIGHT_PER_REFERRAL = 5;

function calculatePosition(basePosition, referralCount) {
  const position = basePosition - referralCount * WEIGHT_PER_REFERRAL;
  return Math.max(1, position); // position can never go below 1
}

module.exports = calculatePosition;