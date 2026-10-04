const { effectivePlan } = require("./entitlements");
const { isAdmin } = require("./adminAccess");
function founderProfile(founder) {
  return {
    id: founder._id, name: founder.name, email: founder.email,
    plan: effectivePlan(founder), customerPortalUrl: founder.customerPortalUrl,
    authProvider: founder.authProvider, createdAt: founder.createdAt,
    subscriptionStatus: founder.subscriptionStatus || (founder.plan === "free" ? "free" : "untracked"),
    subscriptionEndsAt: founder.subscriptionEndsAt || null,
    isAdmin: isAdmin(founder),
  };
}
module.exports = { founderProfile };
