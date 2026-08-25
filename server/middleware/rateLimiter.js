const rateLimit = require("express-rate-limit");

// Public signup rate limiter: max 5 requests per 5 minutes per IP
const signupLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many signups from this device. Please try again in a few minutes." },
  skip: () => process.env.NODE_ENV === "test",
});

// Auth brute-force protection limiter: max 20 requests per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please try again in a few minutes." },
  skip: () => process.env.NODE_ENV === "test",
});

module.exports = { signupLimiter, authLimiter };