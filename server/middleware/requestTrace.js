const crypto = require("crypto");
module.exports = (req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  const started = performance.now();
  res.once("finish", () => {
    if (process.env.NODE_ENV === "test") return;
    console.log(JSON.stringify({ type: "request", requestId: req.requestId, method: req.method,
      route: req.route?.path || "unmatched", status: res.statusCode, durationMs: Math.round(performance.now() - started) }));
  });
  next();
};
