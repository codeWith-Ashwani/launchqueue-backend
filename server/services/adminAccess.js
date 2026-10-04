// authMiddleware loads the current database record on every request, including revocations.
function isAdmin(founder) {
  return founder?.adminApproved === true;
}
module.exports = { isAdmin };
