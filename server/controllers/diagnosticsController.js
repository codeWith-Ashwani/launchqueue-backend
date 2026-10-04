const EmailOutbox = require("../models/EmailOutbox");
const { snapshot } = require("../services/telemetry");
exports.diagnostics = async (_req, res) => {
  try {
    const [states, oldest] = await Promise.all([
      EmailOutbox.aggregate([
        { $group: { _id: "$state", count: { $sum: 1 } } },
      ]),
      EmailOutbox.findOne({
        state: { $in: ["pending", "queued", "processing"] },
      })
        .sort({ createdAt: 1 })
        .select("createdAt -_id")
        .lean(),
    ]);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ...snapshot(),
      emailOutbox: {
        states: Object.fromEntries(states.map((s) => [s._id, s.count])),
        oldestUnsentAgeSeconds: oldest
          ? Math.max(
              0,
              Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000),
            )
          : 0,
      },
    });
  } catch {
    res.status(503).json({ error: "Diagnostics temporarily unavailable" });
  }
};
