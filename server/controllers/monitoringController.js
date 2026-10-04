const monitoring = require("../services/monitoring");
const Span = require("../models/TraceSpan");
exports.metrics = async (req, res, next) => {
  try { res.set("Cache-Control", "no-store").json(await monitoring.report(req.validatedQuery.hours)); } catch (error) { next(error); }
};
exports.traces = async (req, res, next) => {
  try {
    const { hours, errorsOnly } = req.validatedQuery;
    const match = { parentSpanId: null, startedAt: { $gte: new Date(Date.now() - hours * 3600000) } };
    if (errorsOnly) match.status = 2;
    const traces = await Span.find(match).sort({ startedAt: -1, _id: -1 }).limit(20).select("-_id -expiresAt").lean();
    res.set("Cache-Control", "no-store").json({ traces, limit: 20 });
  } catch (error) { next(error); }
};
exports.trace = async (req, res, next) => {
  try {
    if (!/^[a-f\d]{32}$/.test(req.params.traceId)) return res.status(400).json({ error: "Invalid trace ID" });
    const spans = await Span.find({ traceId: req.params.traceId }).sort({ startedAt: 1 }).limit(101).select("-_id -expiresAt").lean();
    if (!spans.length) return res.status(404).json({ error: "Trace not found" });
    res.set("Cache-Control", "no-store").json({ traceId: req.params.traceId, spans: spans.slice(0, 100), truncated: spans.length > 100 });
  } catch (error) { next(error); }
};
