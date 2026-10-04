const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "Founder", required: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Waitlist", required: true },
  action: { type: String, enum: ["hide-discovery", "restore-discovery"], required: true },
}, { timestamps: true });
schema.index({ createdAt: -1 });
module.exports = mongoose.model("AdminAudit", schema);
