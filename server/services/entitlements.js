const PLAN_LIMITS = Object.freeze({
  free: { campaigns: 1, signups: 500, csv: false },
  starter: { campaigns: 3, signups: 5000, csv: true },
  pro: { campaigns: 10, signups: 25000, csv: true },
  agency: { campaigns: Infinity, signups: Infinity, csv: true },
});
function effectivePlan(founder, now = new Date()) {
  if (!founder) return "free";
  const status = founder.subscriptionStatus;
  if (["expired", "unpaid"].includes(status)) return "free";
  if (status === "cancelled" && (!founder.subscriptionEndsAt || founder.subscriptionEndsAt <= now)) return "free";
  return PLAN_LIMITS[founder.plan] ? founder.plan : "free";
}
function limitsFor(founder) { return PLAN_LIMITS[effectivePlan(founder)]; }
function quotaError(message) { return Object.assign(new Error(message), { status: 403, upgradeRequired: true }); }
module.exports = { PLAN_LIMITS, effectivePlan, limitsFor, quotaError };
