const jwt = require("jsonwebtoken");
const Founder = require("../models/Founder");

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const founder = await Founder.findById(decoded.id).select("-password");
    if (!founder) {
      return res.status(401).json({ error: "Founder no longer exists" });
    }

    req.founder = founder;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = authMiddleware;
