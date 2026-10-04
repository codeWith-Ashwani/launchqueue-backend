// Account IDs stay stable when a founder edits their email. Clients cannot assign this role.
function isAdmin(founder) {
  const ids = (process.env.ADMIN_FOUNDER_IDS || "").split(",").map((id) => id.trim()).filter((id) => /^[a-f\d]{24}$/i.test(id));
  return Boolean(founder && ids.includes(String(founder._id)));
}
module.exports = { isAdmin };
