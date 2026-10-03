const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  fingerprint: { type: String, required: true, unique: true },
  eventName: String,
  subscriptionId: String,
  providerUpdatedAt: Date,
  outcome: { type: String, enum: ["applied", "stale", "ignored"], default: "ignored" },
}, { timestamps: true });
module.exports = mongoose.model("BillingEvent", schema);
