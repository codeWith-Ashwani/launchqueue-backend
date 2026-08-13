const express = require("express");
const router = express.Router();
const { getWaitlistInfo, join, checkPosition } = require("../controllers/signupController");

// all public — no authMiddleware here
router.get("/:slug", getWaitlistInfo);
router.post("/:slug/signup", join);
router.get("/:slug/position", checkPosition);

module.exports = router;