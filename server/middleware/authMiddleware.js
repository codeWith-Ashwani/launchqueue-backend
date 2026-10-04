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

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    const founder = await Founder.findById(decoded.id).select("-password");
    if (
      !founder ||
      (decoded.sessionVersion || 0) !== (founder.sessionVersion || 0)
    ) {
      return res.status(401).json({ error: "Founder no longer exists" });
    }

    req.founder = founder;
    next();
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("AuthMiddleware error:", err.message);
    }
    const invalid =
      err instanceof jwt.JsonWebTokenError || err.name === "CastError";
    res
      .status(invalid ? 401 : 503)
      .json({
        error: invalid
          ? "Invalid or expired token"
          : "Authentication temporarily unavailable",
      });
  }
}

module.exports = authMiddleware;
