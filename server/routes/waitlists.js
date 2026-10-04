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

for (const name of ["id", "signupId"]) router.param(name, (req, res, next, value) => {
  if (!/^[a-fA-F0-9]{24}$/.test(value)) return res.status(400).json({ error: "Invalid resource ID" });
  next();
});
router.use(authMiddleware); // every route below requires a valid founder
router.post("/design", require("../middleware/rateLimiter").createLimiter("campaign-design", 300000, 3), validate(require("../validators/campaignDesign").generateDesignSchema), require("../controllers/campaignDesignController").generate);

router.post("/", validate(createWaitlistSchema), create);
router.get("/", list);
router.get("/:id", getOne);
router.get("/:id/stats", require("../middleware/validateQuery")(require("../validators/schemas").paginationSchema), getStats);
router.get("/:id/funnel", require("../middleware/validateQuery")(require("../validators/schemas").funnelQuerySchema), getFunnelStats);
router.get("/:id/export", exportSignups);
router.patch("/:id", validate(updateWaitlistSchema), update);
router.patch("/:id/signups/:signupId/position", validate(updatePositionSchema), updateSignupPosition);
router.post("/:id/signups/batch-invite", validate(batchInviteSchema), batchInvite);

module.exports = router;
