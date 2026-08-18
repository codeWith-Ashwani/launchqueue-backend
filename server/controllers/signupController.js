const Waitlist = require("../models/Waitlist");
const Signup = require("../models/Signup");
const generateRefCode = require("../utils/generateRefCode");
const calculatePosition = require("../utils/calculatePosition");
const sendEmail = require("../utils/sendEmail");
const confirmationEmail = require("../templates/confirmationEmail");
const rankUpEmail = require("../templates/rankUpEmail");
const isDisposableEmail = require("../utils/disposableEmailCheck");

// GET /api/w/:slug  (public) — basic waitlist info for the public page
async function getWaitlistInfo(req, res) {
  try {
    let waitlist = await Waitlist.findOne({ slug: req.params.slug });
    
    // Auto-create default launchqueue waitlist if it doesn't exist yet
    if (!waitlist && req.params.slug === "launchqueue") {
      const Founder = require("../models/Founder");
      let founder = await Founder.findOne();
      if (!founder) {
        founder = await Founder.create({
          email: "founder@launchqueue.com",
          password: "password123",
          plan: "starter",
        });
      }
      waitlist = await Waitlist.create({
        founderId: founder._id,
        name: "LaunchQueue",
        slug: "launchqueue",
        description: "The viral waitlist engine built for high-velocity product launches.",
        heroHeadline: "Waitlists that grow themselves",
        heroSubheadline: "Give your launch audience a live queue position they can climb by referring friends. Embeds on any site in 60 seconds with zero backend code.",
        accentColor: "#2563eb",
        ctaText: "Join LaunchQueue Early Access",
        milestones: [
          { referrals: 1, reward: "🎉 VIP Early Beta Access" },
          { referrals: 3, reward: "🚀 Skip 15 spots instantly" },
          { referrals: 5, reward: "👑 Lifetime Pro Badge + Swag" },
          { referrals: 10, reward: "💎 VIP Founder Lounge Access" },
        ],
        features: [
          { icon: "⚡", title: "Gamified Referral Queue", description: "Every signup receives a personal share link that moves them up in real time." },
          { icon: "🔗", title: "One-Line Embed SDK", description: "Drop into any website, React app, or Webflow page in seconds." },
          { icon: "🛡️", title: "Anti-Fraud & Bot Shield", description: "Automatic disposable email filtering and referral verification." },
        ],
      });
    }

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
      heroHeadline: waitlist.heroHeadline,
      heroSubheadline: waitlist.heroSubheadline,
      heroImageUrl: waitlist.heroImageUrl,
      accentColor: waitlist.accentColor,
      ctaText: waitlist.ctaText,
      features: waitlist.features,
      milestones: waitlist.milestones,
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

    if (isDisposableEmail(email)) {
      return res
        .status(400)
        .json({ error: "Please use a real, non-disposable email address" });
    }

    let waitlist = await Waitlist.findOne({ slug: req.params.slug });
    
    // Auto-create default launchqueue waitlist if it doesn't exist yet
    if (!waitlist && req.params.slug === "launchqueue") {
      const Founder = require("../models/Founder");
      let founder = await Founder.findOne();
      if (!founder) {
        founder = await Founder.create({
          email: "founder@launchqueue.com",
          password: "password123",
          plan: "starter",
        });
      }
      waitlist = await Waitlist.create({
        founderId: founder._id,
        name: "LaunchQueue",
        slug: "launchqueue",
        description: "The viral waitlist engine built for high-velocity product launches.",
        heroHeadline: "Waitlists that grow themselves",
        heroSubheadline: "Give your launch audience a live queue position they can climb by referring friends.",
        accentColor: "#2563eb",
        ctaText: "Join LaunchQueue Early Access",
        milestones: [
          { referrals: 1, reward: "🎉 VIP Early Beta Access" },
          { referrals: 3, reward: "🚀 Skip 15 spots instantly" },
          { referrals: 5, reward: "👑 Lifetime Pro Badge + Swag" },
          { referrals: 10, reward: "💎 VIP Founder Lounge Access" },
        ],
      });
    }

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
      const positionsGained = Math.max(0, (existing.basePosition || existing.currentPosition) - existing.currentPosition);
      return res.status(200).json({
        position: existing.currentPosition,
        basePosition: existing.basePosition || existing.currentPosition,
        referralCount: existing.referralCount || 0,
        positionsGained: positionsGained || (existing.referralCount || 0) * 5,
        refCode: existing.refCode,
        email: existing.email,
        waitlistName: waitlist.name,
        milestones: waitlist.milestones,
        alreadyJoined: true,
      });
    }

    // Determine valid referral code (prevent self-referrals and check existence)
    let validReferrer = null;
    if (ref && typeof ref === "string") {
      const trimmedRef = ref.trim();
      const foundReferrer = await Signup.findOne({
        waitlistId: waitlist._id,
        refCode: trimmedRef,
      });

      // Valid referrer only if found and email doesn't match the new signup email
      if (foundReferrer && foundReferrer.email.toLowerCase() !== email.toLowerCase()) {
        validReferrer = foundReferrer;
      }
    }

    const basePosition =
      (await Signup.countDocuments({ waitlistId: waitlist._id })) + 1;

    const newSignup = await Signup.create({
      waitlistId: waitlist._id,
      email: email.toLowerCase(),
      refCode: generateRefCode(),
      referredBy: validReferrer ? validReferrer.refCode : null,
      basePosition,
      currentPosition: basePosition,
    });

    // --- send confirmation email to the person who just joined ---
    const newSignupShareUrl = `${process.env.CLIENT_URL || "http://localhost:5173"}/w/${waitlist.slug}?ref=${newSignup.refCode}`;
    sendEmail({
      to: newSignup.email,
      subject: `You're #${newSignup.currentPosition} on the ${waitlist.name} waitlist`,
      html: confirmationEmail({
        waitlistName: waitlist.name,
        position: newSignup.currentPosition,
        shareUrl: newSignupShareUrl,
      }),
    });

    // Attribute referral credit to valid referrer
    if (validReferrer) {
      const oldPosition = validReferrer.currentPosition;
      validReferrer.referralCount += 1;
      validReferrer.currentPosition = calculatePosition(
        validReferrer.basePosition,
        validReferrer.referralCount,
      );
      await validReferrer.save();

      if (validReferrer.currentPosition < oldPosition) {
        const referrerShareUrl = `${process.env.CLIENT_URL || "http://localhost:5173"}/w/${waitlist.slug}?ref=${validReferrer.refCode}`;
        sendEmail({
          to: validReferrer.email,
          subject: `You moved up to #${validReferrer.currentPosition}!`,
          html: rankUpEmail({
            waitlistName: waitlist.name,
            oldPosition,
            newPosition: validReferrer.currentPosition,
            shareUrl: referrerShareUrl,
          }),
        });
      }
    }

    res.status(201).json({
      position: newSignup.currentPosition,
      basePosition: newSignup.basePosition,
      referralCount: newSignup.referralCount || 0,
      positionsGained: 0,
      refCode: newSignup.refCode,
      email: newSignup.email,
      waitlistName: waitlist.name,
      milestones: waitlist.milestones,
      alreadyJoined: false,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "This email has already joined" });
    }
    res.status(500).json({ error: err.message });
  }
}

// GET /api/w/:slug/position?ref=xxxx or ?email=xxxx  (public) — look up current position
async function checkPosition(req, res) {
  try {
    const { ref, email } = req.query;
    const waitlist = await Waitlist.findOne({ slug: req.params.slug });
    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }

    const query = { waitlistId: waitlist._id };
    if (ref) {
      query.refCode = ref;
    } else if (email) {
      query.email = email.toLowerCase().trim();
    } else {
      return res.status(400).json({ error: "Ref code or email is required" });
    }

    const signup = await Signup.findOne(query);
    if (!signup) {
      return res.status(404).json({ error: "Signup not found" });
    }

    const positionsGained = Math.max(0, (signup.basePosition || signup.currentPosition) - signup.currentPosition);

    res.json({
      position: signup.currentPosition,
      basePosition: signup.basePosition || signup.currentPosition,
      referralCount: signup.referralCount || 0,
      positionsGained: positionsGained || (signup.referralCount || 0) * 5,
      refCode: signup.refCode,
      email: signup.email,
      waitlistName: waitlist.name,
      milestones: waitlist.milestones,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getWaitlistInfo, join, checkPosition };
