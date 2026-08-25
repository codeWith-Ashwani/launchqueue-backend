const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const Founder = require("../models/Founder");
const generateToken = require("../utils/generateToken");
const sendEmail = require("../utils/sendEmail");
const passwordResetEmail = require("../templates/passwordResetEmail");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function getCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  };
}

// POST /api/auth/register
async function register(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const existing = await Founder.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const founder = await Founder.create({
      email,
      password: hashedPassword,
      authProvider: "local",
    });

    const token = generateToken(founder._id);

    res.cookie("token", token, getCookieOptions());

    res.status(201).json({
      token,
      founder: {
        id: founder._id,
        name: founder.name,
        email: founder.email,
        plan: founder.plan,
        customerPortalUrl: founder.customerPortalUrl,
      },
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// POST /api/auth/login
async function login(req, res) {
  try {
    const { email, password } = req.body;

    const founder = await Founder.findOne({ email: email?.toLowerCase() });
    if (!founder) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (!founder.password) {
      return res.status(400).json({
        error: "This account uses Google Sign-In. Please log in with Google instead.",
      });
    }

    const match = await bcrypt.compare(password, founder.password);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = generateToken(founder._id);

    res.cookie("token", token, getCookieOptions());

    res.json({
      token,
      founder: {
        id: founder._id,
        name: founder.name,
        email: founder.email,
        plan: founder.plan,
        customerPortalUrl: founder.customerPortalUrl,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// POST /api/auth/google  (public, rate-limited)
async function googleLogin(req, res) {
  try {
    const { credential } = req.body;

    if (!credential || typeof credential !== "string") {
      return res.status(400).json({ error: "Credential token is required" });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email_verified) {
      return res.status(400).json({ error: "Google email is not verified" });
    }

    const { sub: googleId, email, name } = payload;
    const normalizedEmail = email.toLowerCase().trim();

    let founder = await Founder.findOne({ googleId });

    if (!founder) {
      founder = await Founder.findOne({ email: normalizedEmail });
      if (founder) {
        // Link existing local account to Google ID without modifying password or local authProvider
        founder.googleId = googleId;
        if (!founder.name && name) founder.name = name;
        await founder.save();
      } else {
        // Create new Google-authenticated founder
        founder = await Founder.create({
          email: normalizedEmail,
          name: name || "",
          googleId,
          authProvider: "google",
          plan: "free",
        });
      }
    }

    const token = generateToken(founder._id);
    res.cookie("token", token, getCookieOptions());

    res.json({
      token,
      founder: {
        id: founder._id,
        name: founder.name,
        email: founder.email,
        plan: founder.plan,
        customerPortalUrl: founder.customerPortalUrl,
      },
    });
  } catch (err) {
    console.error("Google login error:", err.message);
    res.status(401).json({
      error: "Invalid or expired Google credential",
    });
  }
}

// POST /api/auth/logout
async function logout(req, res) {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
  });
  res.json({ message: "Logged out successfully" });
}

// GET /api/auth/me  (protected)
async function getMe(req, res) {
  res.json({
    founder: {
      id: req.founder._id,
      name: req.founder.name,
      email: req.founder.email,
      plan: req.founder.plan,
      customerPortalUrl: req.founder.customerPortalUrl,
    },
  });
}

// PATCH /api/auth/profile  (protected)
async function updateProfile(req, res) {
  try {
    const { name, email } = req.body;
    const founderId = req.founder._id;

    if (email && email.toLowerCase() !== req.founder.email.toLowerCase()) {
      const existing = await Founder.findOne({ email: email.toLowerCase() });
      if (existing && existing._id.toString() !== founderId.toString()) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email.toLowerCase();

    const updatedFounder = await Founder.findByIdAndUpdate(
      founderId,
      { $set: updates },
      { new: true, runValidators: true }
    ).select("-password");

    res.json({
      founder: {
        id: updatedFounder._id,
        name: updatedFounder.name,
        email: updatedFounder.email,
        plan: updatedFounder.plan,
        customerPortalUrl: updatedFounder.customerPortalUrl,
      },
    });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// PATCH /api/auth/password  (protected)
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    const founderId = req.founder._id;

    const founder = await Founder.findById(founderId);
    if (!founder) {
      return res.status(404).json({ error: "Founder not found" });
    }

    if (!founder.password) {
      return res.status(400).json({
        error: "This account was registered using Google Sign-In and does not have a local password set.",
      });
    }

    const match = await bcrypt.compare(currentPassword, founder.password);
    if (!match) {
      return res.status(401).json({ error: "Incorrect current password" });
    }

    founder.password = await bcrypt.hash(newPassword, 10);
    await founder.save();

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// POST /api/auth/forgot-password  (public, rate-limited)
async function requestPasswordReset(req, res) {
  try {
    const { email } = req.body;
    const genericResponse = {
      message: "If an account exists for this email, a reset link has been sent.",
    };

    if (!email) {
      return res.status(200).json(genericResponse);
    }

    const founder = await Founder.findOne({ email: email.toLowerCase() });
    if (!founder) {
      return res.status(200).json(genericResponse);
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    founder.resetPasswordTokenHash = tokenHash;
    founder.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await founder.save();

    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const resetUrl = `${clientUrl}/reset-password?token=${rawToken}`;

    await sendEmail({
      to: founder.email,
      subject: "Reset your LaunchQueue password",
      html: passwordResetEmail({ resetUrl }),
    });

    res.status(200).json(genericResponse);
  } catch (err) {
    console.error("RequestPasswordReset error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// POST /api/auth/reset-password  (public, rate-limited)
async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required." });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const founder = await Founder.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!founder) {
      return res.status(400).json({ error: "Invalid or expired reset link." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    founder.password = hashedPassword;
    founder.resetPasswordTokenHash = null;
    founder.resetPasswordExpires = null;
    await founder.save();

    res.status(200).json({
      message: "Password has been successfully reset. You can now log in.",
    });
  } catch (err) {
    console.error("ResetPassword error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

module.exports = {
  register,
  login,
  googleLogin,
  logout,
  getMe,
  updateProfile,
  changePassword,
  requestPasswordReset,
  resetPassword,
};