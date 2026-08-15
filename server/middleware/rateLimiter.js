const rateLimit = require("express-rate-limit");

const signupLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minute window
  max: 5,                   // max 5 signups per IP in that window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many signups from this device. Please try again in a few minutes." },
});

module.exports = { signupLimiter };