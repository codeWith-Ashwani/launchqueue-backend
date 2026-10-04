const { isAdmin } = require("../services/adminAccess");
module.exports = (req, res, next) => {
  if (!isAdmin(req.founder)) return res.status(403).json({ error: "Administrator access required" });
  res.set("Cache-Control", "no-store");
  next();
};
