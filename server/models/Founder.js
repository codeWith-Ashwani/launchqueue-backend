const mongoose = require("mongoose");

const founderSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: false,
      default: null,
    },
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    plan: {
      type: String,
      enum: ["free", "starter", "pro", "agency"],
      default: "free",
    },
    lemonSqueezySubscriptionId: {
      type: String,
      default: null,
    },
    customerPortalUrl: {
      type: String,
      default: null,
    },
    resetPasswordTokenHash: {
      type: String,
      default: null,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
    },
    sessionVersion: { type: Number, default: 0 },
    usageVersion: { type: Number, default: 0 },
    // Only a trusted database operator can approve admin access; never accept this from account forms.
    adminApproved: { type: Boolean, default: false },
    subscriptionStatus: String,
    subscriptionEndsAt: Date,
    billingUpdatedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Founder", founderSchema);
