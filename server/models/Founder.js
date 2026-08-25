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
      required: true,
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
  },
  { timestamps: true }
);

module.exports = mongoose.model("Founder", founderSchema);