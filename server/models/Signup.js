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
    referralCount: {
      type: Number,
      default: 0,
    },
    currentPosition: {
      type: Number,
      required: true,
    },
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

module.exports = mongoose.model("Signup", signupSchema);