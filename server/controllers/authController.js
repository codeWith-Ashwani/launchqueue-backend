const bcrypt = require("bcryptjs");
const Founder = require("../models/Founder");
const generateToken = require("../utils/generateToken");

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
    const founder = await Founder.create({ email, password: hashedPassword });

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

module.exports = {
  register,
  login,
  logout,
  getMe,
  updateProfile,
  changePassword,
};