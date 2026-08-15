const express = require("express");
const router = express.Router();
const { createCheckout, handleWebhook } = require("../controllers/paymentController");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/checkout", authMiddleware, createCheckout);
router.post("/webhook", handleWebhook); // no authMiddleware — Lemon Squeezy calls this, not your app

module.exports = router;