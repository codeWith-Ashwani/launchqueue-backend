const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  _id: String, traceId: String, spanId: String, parentSpanId: { type: String, default: null },
  name: String, serviceName: String, startedAt: Date, durationMs: Number, status: Number,
  route: String, method: String, responseStatus: Number, expiresAt: Date,
}, { versionKey: false });
schema.index({ traceId: 1, startedAt: 1 });
schema.index({ parentSpanId: 1, startedAt: -1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model("TraceSpan", schema);
