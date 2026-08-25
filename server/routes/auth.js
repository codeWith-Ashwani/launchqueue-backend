const express = require("express");
const router = express.Router();
const {
  register,
  login,
  logout,
  getMe,
  updateProfile,
  changePassword,
} = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const { authLimiter } = require("../middleware/rateLimiter");
const validate = require("../middleware/validate");
const {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
} = require("../validators/schemas");

router.post("/register", authLimiter, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/logout", logout);
router.get("/me", authMiddleware, getMe);
router.patch("/profile", authMiddleware, validate(updateProfileSchema), updateProfile);
router.patch("/password", authMiddleware, validate(changePasswordSchema), changePassword);

module.exports = router;