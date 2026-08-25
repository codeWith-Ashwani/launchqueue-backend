const express = require("express");
const router = express.Router();
const {
  create,
  list,
  getOne,
  update,
  exportSignups,
  updateSignupPosition,
  batchInvite,
} = require("../controllers/waitlistController");
const authMiddleware = require("../middleware/authMiddleware");
const { getStats, getFunnelStats } = require("../controllers/dashboardController");
const validate = require("../middleware/validate");
const {
  createWaitlistSchema,
  updateWaitlistSchema,
  updatePositionSchema,
  batchInviteSchema,
} = require("../validators/schemas");

router.use(authMiddleware); // every route below requires a valid founder

router.post("/", validate(createWaitlistSchema), create);
router.get("/", list);
router.get("/:id", getOne);
router.get("/:id/stats", getStats);
router.get("/:id/funnel", getFunnelStats);
router.get("/:id/export", exportSignups);
router.patch("/:id", validate(updateWaitlistSchema), update);
router.patch("/:id/signups/:signupId/position", validate(updatePositionSchema), updateSignupPosition);
router.post("/:id/signups/batch-invite", validate(batchInviteSchema), batchInvite);

module.exports = router;