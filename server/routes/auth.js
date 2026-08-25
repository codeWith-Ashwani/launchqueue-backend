const express = require("express");
const router = express.Router();
const {
  register,
  login,
  googleLogin,
  logout,
  getMe,
  updateProfile,
  changePassword,
  requestPasswordReset,
  resetPassword,
} = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const { authLimiter } = require("../middleware/rateLimiter");
const validate = require("../middleware/validate");
const {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
} = require("../validators/schemas");

router.post("/register", authLimiter, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/google", authLimiter, googleLogin);
router.post("/logout", logout);
router.get("/me", authMiddleware, getMe);
router.patch("/profile", authMiddleware, validate(updateProfileSchema), updateProfile);
router.patch("/password", authMiddleware, validate(changePasswordSchema), changePassword);
router.post("/forgot-password", authLimiter, validate(requestPasswordResetSchema), requestPasswordReset);
router.post("/reset-password", authLimiter, validate(resetPasswordSchema), resetPassword);

module.exports = router;