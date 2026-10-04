const express = require("express");
const router = express.Router();
const {
  getWaitlistInfo,
  join,
  checkPosition,
  requestStatusLink,
  verifyEmail,
  getLeaderboard,
  recordVisit,
  getRecentActivity,
} = require("../controllers/signupController");
const {
  signupLimiter,
  recoveryLimiter,
  verificationLimiter,
  statusLimiter,
  visitLimiter,
} = require("../middleware/rateLimiter");
const validate = require("../middleware/validate");
const {
  signupJoinSchema,
  requestPasswordResetSchema,
  verificationSchema,
} = require("../validators/schemas");

// all public — no authMiddleware here
router.get("/:slug", getWaitlistInfo);
router.post("/:slug/signup", signupLimiter, validate(signupJoinSchema), join);
router.get("/:slug/position", statusLimiter, checkPosition);
router.post(
  "/:slug/status-link",
  recoveryLimiter,
  validate(requestPasswordResetSchema),
  requestStatusLink,
);
router.post(
  "/:slug/verify",
  verificationLimiter,
  validate(verificationSchema),
  verifyEmail,
);
router.get("/:slug/leaderboard", getLeaderboard);
router.post(
  "/:slug/visit",
  visitLimiter,
  validate(require("../validators/schemas").visitSchema),
  recordVisit,
);
router.get("/:slug/activity", getRecentActivity);

module.exports = router;
