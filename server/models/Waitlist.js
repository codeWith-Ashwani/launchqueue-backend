const mongoose = require("mongoose");

const waitlistSchema = new mongoose.Schema(
  {
    founderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Founder",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    thankYouMessage: {
      type: String,
      default: "Thanks for joining! Share your link to move up the list.",
    },
    paused: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Waitlist", waitlistSchema);