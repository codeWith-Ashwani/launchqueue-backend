const express = require("express");
const router = express.Router();
const {
  getWaitlistInfo,
  join,
  checkPosition,
  getLeaderboard,
  recordVisit,
  getRecentActivity,
} = require("../controllers/signupController");
const { signupLimiter } = require("../middleware/rateLimiter");
const validate = require("../middleware/validate");
const { signupJoinSchema } = require("../validators/schemas");

// all public — no authMiddleware here
router.get("/:slug", getWaitlistInfo);
router.post("/:slug/signup", signupLimiter, validate(signupJoinSchema), join);
router.get("/:slug/position", checkPosition);
router.get("/:slug/leaderboard", getLeaderboard);
router.post("/:slug/visit", recordVisit);
router.get("/:slug/activity", getRecentActivity);

module.exports = router;