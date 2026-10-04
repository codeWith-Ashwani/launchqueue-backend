const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    dedupeKey: { type: String, required: true, unique: true },
    kind: { type: String, required: true },
    waitlistId: { type: mongoose.Schema.Types.ObjectId, ref: "Waitlist" },
    signupId: { type: mongoose.Schema.Types.ObjectId, ref: "Signup" },
    encryptedPayload: { type: String, required: true, select: false },
    deliveryKey: String,
    state: {
      type: String,
      enum: ["pending", "queued", "processing", "sent", "failed"],
      default: "pending",
    },
    attempts: { type: Number, default: 0 },
    generation: { type: Number, default: 0 },
    nextDispatchAt: { type: Date, default: Date.now },
    leaseUntil: { type: Date, default: null },
    leaseToken: String,
    lastError: String,
    expiresAt: Date,
    sentAt: Date,
  },
  { timestamps: true },
);
schema.index({ state: 1, nextDispatchAt: 1 });
schema.index({ state: 1, createdAt: 1 });
module.exports = mongoose.model("EmailOutbox", schema);
