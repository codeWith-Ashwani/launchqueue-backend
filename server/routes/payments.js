const express = require("express");
const router = express.Router();
const {
  createCheckout,
  getCustomerPortal,
  handleWebhook,
} = require("../controllers/paymentController");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/checkout", authMiddleware, createCheckout);
router.get("/portal", authMiddleware, getCustomerPortal);
router.post("/webhook", handleWebhook); // no authMiddleware — Lemon Squeezy calls this, not your app

module.exports = router;