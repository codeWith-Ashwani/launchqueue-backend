const jwt = require("jsonwebtoken");
const Founder = require("../models/Founder");

async function authMiddleware(req, res, next) {
  try {
    let token = req.cookies?.token;

    const authHeader = req.headers.authorization;
    if (!token && authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const founder = await Founder.findById(decoded.id).select("-password");
    if (!founder) {
      return res.status(401).json({ error: "Founder no longer exists" });
    }

    req.founder = founder;
    next();
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("AuthMiddleware error:", err.message);
    }
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = authMiddleware;
