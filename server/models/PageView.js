const mongoose = require("mongoose");

const pageViewSchema = new mongoose.Schema(
  {
    waitlistId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Waitlist",
      required: true,
      index: true,
    },
    visitorId: {
      type: String,
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

// Index to find recent visits quickly for deduplication
pageViewSchema.index({ waitlistId: 1, visitorId: 1, createdAt: -1 });

module.exports = mongoose.model("PageView", pageViewSchema);
