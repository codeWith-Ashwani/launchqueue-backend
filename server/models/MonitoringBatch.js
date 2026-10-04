const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  _id: String, capturedAt: { type: Date, required: true, index: true }, expiresAt: { type: Date, required: true },
  entries: [{ _id: false, name: String, label: String, count: Number, failed: Number, good: Number, total: Number, buckets: [Number] }],
}, { versionKey: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model("MonitoringBatch", schema);
