const bcrypt = require("bcryptjs");
const Founder = require("../models/Founder");
const generateToken = require("../utils/generateToken");

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

    res.status(201).json({
      token,
      founder: { id: founder._id, email: founder.email, plan: founder.plan },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    res.json({
      token,
      founder: { id: founder._id, email: founder.email, plan: founder.plan },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/auth/me  (protected)
async function getMe(req, res) {
  res.json({ founder: req.founder });
}

module.exports = { register, login, getMe };