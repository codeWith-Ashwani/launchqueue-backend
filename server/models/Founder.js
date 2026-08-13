const mongoose = require("mongoose");

const founderSchema = new mongoose.Schema(
  {
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
  },
  { timestamps: true }
);

module.exports = mongoose.model("Founder", founderSchema);