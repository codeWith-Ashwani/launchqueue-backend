const Waitlist = require("../models/Waitlist");
const Signup = require("../models/Signup");
const generateRefCode = require("../utils/generateRefCode");
const calculatePosition = require("../utils/calculatePosition");
const sendEmail = require("../utils/sendEmail");
const confirmationEmail = require("../templates/confirmationEmail");
const rankUpEmail = require("../templates/rankUpEmail");

// GET /api/w/:slug  (public) — basic waitlist info for the public page
async function getWaitlistInfo(req, res) {
  try {
    const waitlist = await Waitlist.findOne({ slug: req.params.slug });
    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }

    const totalSignups = await Signup.countDocuments({
      waitlistId: waitlist._id,
    });

    res.json({
      name: waitlist.name,
      description: waitlist.description,
      slug: waitlist.slug,
      paused: waitlist.paused,
      totalSignups,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/w/:slug/signup  (public) — join a waitlist
async function join(req, res) {
  try {
    const { email, ref } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const waitlist = await Waitlist.findOne({ slug: req.params.slug });
    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }
    if (waitlist.paused) {
      return res
        .status(403)
        .json({ error: "This waitlist is not accepting new signups" });
    }

    const existing = await Signup.findOne({
      waitlistId: waitlist._id,
      email: email.toLowerCase(),
    });
    if (existing) {
      return res.status(200).json({
        position: existing.currentPosition,
        refCode: existing.refCode,
        alreadyJoined: true,
      });
    }

    const basePosition =
      (await Signup.countDocuments({ waitlistId: waitlist._id })) + 1;

    const newSignup = await Signup.create({
      waitlistId: waitlist._id,
      email,
      refCode: generateRefCode(),
      referredBy: ref || null,
      basePosition,
      currentPosition: basePosition,
    });

    // --- NEW: send confirmation email to the person who just joined ---
    const newSignupShareUrl = `${process.env.CLIENT_URL}/w/${waitlist.slug}?ref=${newSignup.refCode}`;
    sendEmail({
      to: newSignup.email,
      subject: `You're #${newSignup.currentPosition} on the ${waitlist.name} waitlist`,
      html: confirmationEmail({
        waitlistName: waitlist.name,
        position: newSignup.currentPosition,
        shareUrl: newSignupShareUrl,
      }),
    });

    if (ref) {
      const referrer = await Signup.findOne({
        waitlistId: waitlist._id,
        refCode: ref,
      });
      if (referrer) {
        const oldPosition = referrer.currentPosition; // capture before it changes

        referrer.referralCount += 1;
        referrer.currentPosition = calculatePosition(
          referrer.basePosition,
          referrer.referralCount,
        );
        await referrer.save();

        // --- NEW: notify the referrer only if their position actually improved ---
        if (referrer.currentPosition < oldPosition) {
          const referrerShareUrl = `${process.env.CLIENT_URL}/w/${waitlist.slug}?ref=${referrer.refCode}`;
          sendEmail({
            to: referrer.email,
            subject: `You moved up to #${referrer.currentPosition}!`,
            html: rankUpEmail({
              waitlistName: waitlist.name,
              oldPosition,
              newPosition: referrer.currentPosition,
              shareUrl: referrerShareUrl,
            }),
          });
        }
      }
    }

    res.status(201).json({
      position: newSignup.currentPosition,
      refCode: newSignup.refCode,
      alreadyJoined: false,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "This email has already joined" });
    }
    res.status(500).json({ error: err.message });
  }
}

// GET /api/w/:slug/position?ref=xxxx  (public) — look up your current position
async function checkPosition(req, res) {
  try {
    const { ref } = req.query;
    const waitlist = await Waitlist.findOne({ slug: req.params.slug });
    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }

    const signup = await Signup.findOne({
      waitlistId: waitlist._id,
      refCode: ref,
    });
    if (!signup) {
      return res.status(404).json({ error: "Signup not found" });
    }

    res.json({
      position: signup.currentPosition,
      referralCount: signup.referralCount,
      refCode: signup.refCode,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getWaitlistInfo, join, checkPosition };
