function browserRequest(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const allowed = [
    process.env.CLIENT_URL,
    ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:5173"]),
  ];
  const origin = req.get("Origin");
  if (origin && !allowed.includes(origin))
    return res.status(403).json({ error: "Untrusted request origin" });
  if (req.cookies?.token && req.get("X-LaunchQueue-Request") !== "1") {
    return res.status(403).json({ error: "Browser request header required" });
  }
  next();
}
module.exports = browserRequest;
