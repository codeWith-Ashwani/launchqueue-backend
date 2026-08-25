const express = require("express");
const router = express.Router();
const { create, list, getOne, update } = require("../controllers/waitlistController");
const authMiddleware = require("../middleware/authMiddleware");
const { getStats, exportCsv } = require("../controllers/dashboardController");
const validate = require("../middleware/validate");
const { createWaitlistSchema, updateWaitlistSchema } = require("../validators/schemas");

router.use(authMiddleware); // every route below requires a valid founder

router.post("/", validate(createWaitlistSchema), create);
router.get("/", list);
router.get("/:id", getOne);
router.get("/:id/stats", getStats);
router.get("/:id/export", exportCsv);
router.patch("/:id", validate(updateWaitlistSchema), update);

module.exports = router;