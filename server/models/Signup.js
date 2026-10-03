const mongoose = require("mongoose");

const signupSchema = new mongoose.Schema(
  {
    waitlistId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Waitlist",
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    refCode: {
      type: String,
      required: true,
      unique: true,
    },
    referredBy: {
      type: String,
      default: null, // refCode of whoever referred them
    },
    basePosition: {
      type: Number,
      required: true,
    },
    priorityOffset: { type: Number, default: 0 },
    referralCount: {
      type: Number,
      default: 0,
    },
    currentPosition: {
      type: Number,
      required: true,
    },
    invitationState: { type: String, enum: ["none", "queued", "sent", "failed"], default: "none" },
    status: {
      type: String,
      enum: ["waiting", "invited"],
      default: "waiting",
    },
  },
  { timestamps: true }
);

// One email can only join a given waitlist once
signupSchema.index({ waitlistId: 1, email: 1 }, { unique: true });
signupSchema.index({ waitlistId: 1, basePosition: -1 });

module.exports = mongoose.model("Signup", signupSchema);
