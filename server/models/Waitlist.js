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
    heroHeadline: { type: String, default: "" },
    heroSubheadline: { type: String, default: "" },
    heroImageUrl: { type: String, default: "" },
    accentColor: { type: String, default: "#111111" },
    ctaText: { type: String, default: "Join the waitlist" },
    features: [
      {
        icon: { type: String, default: "✨" },
        title: { type: String, required: true },
        description: { type: String, default: "" },
      },
    ],
    milestones: {
      type: [
        {
          referrals: { type: Number, required: true },
          reward: { type: String, required: true },
        },
      ],
      default: [
        { referrals: 1, reward: "🎉 Priority access unlocked" },
        { referrals: 3, reward: "🚀 Skip 15 spots instantly" },
        { referrals: 5, reward: "👑 Founding member badge" },
      ],
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Waitlist", waitlistSchema);
