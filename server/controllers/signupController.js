const mongoose = require("mongoose");
const { rankedSignups, signupState } = require("../services/ranking");
const Waitlist = require("../models/Waitlist");
const Signup = require("../models/Signup");
const PageView = require("../models/PageView");
const generateRefCode = require("../utils/generateRefCode");
const calculatePosition = require("../utils/calculatePosition");
const sendEmail = require("../utils/sendEmail");
const confirmationEmail = require("../templates/confirmationEmail");
const rankUpEmail = require("../templates/rankUpEmail");
const isDisposableEmail = require("../utils/disposableEmailCheck");

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
      heroHeadline: waitlist.heroHeadline,
      heroSubheadline: waitlist.heroSubheadline,
      heroImageUrl: waitlist.heroImageUrl,
      accentColor: waitlist.accentColor,
      ctaText: waitlist.ctaText,
      features: waitlist.features,
      milestones: waitlist.milestones,
    });
  } catch (err) {
    console.error("getWaitlistInfo error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// POST /api/w/:slug/signup  (public) — join a waitlist
async function join(req, res) {
  try {
    const { email, ref } = req.body;
    if (isDisposableEmail(email)) {
      return res.status(400).json({ error: "Please use a real, non-disposable email address" });
    }
    const result = await mongoose.connection.transaction(async (session) => {
      const waitlist = await Waitlist.findOne({ slug: req.params.slug }).session(session);
      if (!waitlist) throw Object.assign(new Error("Waitlist not found"), { status: 404 });
      if (waitlist.paused) throw Object.assign(new Error("This waitlist is not accepting new signups"), { status: 403 });
      const existing = await Signup.findOne({ waitlistId: waitlist._id, email }).session(session);
      if (existing) return { waitlist, signup: existing, alreadyJoined: true };

      // Bootstrap existing campaigns using their largest historical sequence.
      const latest = await Signup.findOne({ waitlistId: waitlist._id }).sort({ basePosition: -1 }).session(session);
      await Waitlist.updateOne({ _id: waitlist._id }, { $max: { signupSequence: latest?.basePosition || 0 } }, { session });
      const allocated = await Waitlist.findOneAndUpdate(
        { _id: waitlist._id }, { $inc: { signupSequence: 1 } }, { session, returnDocument: "after" }
      );
      let referrer = ref ? await Signup.findOne({ waitlistId: waitlist._id, refCode: ref }).session(session) : null;
      if (referrer?.email === email) referrer = null;
      const [signup] = await Signup.create([{
        waitlistId: waitlist._id, email, refCode: generateRefCode(),
        referredBy: referrer?.refCode || null,
        basePosition: allocated.signupSequence, currentPosition: allocated.signupSequence,
      }], { session });
      if (referrer) {
        await Signup.updateOne({ _id: referrer._id }, { $inc: { referralCount: 1 } }, { session });
        referrer = await Signup.findById(referrer._id).session(session);
        // Retain the legacy score field for old clients; all new reads derive rank.
        referrer.currentPosition = calculatePosition(referrer.basePosition, referrer.referralCount);
        await referrer.save({ session });
      }
      return { waitlist, signup, referrer, alreadyJoined: false };
    });
    const data = await signupState(result.signup, result.waitlist, result.alreadyJoined);
    if (!result.alreadyJoined) {
      const shareUrl = `${process.env.CLIENT_URL}/w/${result.waitlist.slug}?ref=${result.signup.refCode}`;
      void sendEmail({ to: result.signup.email, subject: `You're #${data.position} on the ${result.waitlist.name} waitlist`,
        html: confirmationEmail({ waitlistName: result.waitlist.name, position: data.position, shareUrl }) });
      if (result.referrer) {
        const state = await signupState(result.referrer, result.waitlist);
        void sendEmail({ to: result.referrer.email, subject: `Your ${result.waitlist.name} referral was credited`,
          html: rankUpEmail({ waitlistName: result.waitlist.name, oldPosition: result.referrer.basePosition,
            newPosition: state.position, shareUrl: `${process.env.CLIENT_URL}/w/${result.waitlist.slug}?ref=${result.referrer.refCode}` }) });
      }
    }
    return res.status(result.alreadyJoined ? 200 : 201).json(data);
  } catch (err) {
    if (err.code === 11000) {
      const waitlist = await Waitlist.findOne({ slug: req.params.slug });
      const existing = waitlist && await Signup.findOne({ waitlistId: waitlist._id, email: req.body.email });
      if (existing) return res.json(await signupState(existing, waitlist, true));
      return res.status(409).json({ error: "Please retry your signup" });
    }
    console.error("join waitlist error:", err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : "Unable to join waitlist" });
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

    res.json(await signupState(signup, waitlist));
  } catch (err) {
    console.error("checkPosition error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// Safe email masking utility for public endpoints
function maskEmail(email) {
  if (!email || typeof email !== "string") return "Anonymous";
  const [user, domain] = email.split("@");
  if (!domain) return user.slice(0, 2) + "***";
  const maskedUser =
    user.length <= 2 ? user[0] + "***" : user[0] + "***" + user[user.length - 1];
  const domainParts = domain.split(".");
  const domainName = domainParts[0];
  const ext = domainParts.slice(1).join(".");
  const maskedDomain =
    domainName.length <= 2
      ? domainName[0] + "***"
      : domainName[0] + "***" + domainName[domainName.length - 1];
  return `${maskedUser}@${maskedDomain}${ext ? "." + ext : ""}`;
}

// GET /api/w/:slug/leaderboard (public) — Top 10 referrers with anonymized emails
async function getLeaderboard(req, res) {
  try {
    const waitlist = await Waitlist.findOne({ slug: req.params.slug });
    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }

    const topReferrers = await rankedSignups(waitlist._id, [
      { $match: { referralCount: { $gt: 0 } } },
      { $sort: { referralCount: -1, currentPosition: 1 } }, { $limit: 10 },
      { $project: { email: 1, referralCount: 1, currentPosition: 1 } },
    ]);

    const leaderboard = topReferrers.map((r, index) => ({
      _id: r._id,
      rank: index + 1,
      anonymizedEmail: maskEmail(r.email),
      email: maskEmail(r.email),
      referralCount: r.referralCount,
      currentPosition: r.currentPosition,
    }));

    res.json({ leaderboard });
  } catch (err) {
    console.error("getLeaderboard error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// POST /api/w/:slug/visit (public) — Track unique page views with deduplication
async function recordVisit(req, res) {
  try {
    const { visitorId } = req.body;
    if (!visitorId || typeof visitorId !== "string") {
      return res.status(400).json({ error: "visitorId required" });
    }

    const waitlist = await Waitlist.findOne({ slug: req.params.slug });
    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }

    // Deduplicate: ignore rapid refreshes from the same visitor within 30 minutes
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const recentVisit = await PageView.findOne({
      waitlistId: waitlist._id,
      visitorId: visitorId.trim(),
      createdAt: { $gte: thirtyMinutesAgo },
    });

    if (!recentVisit) {
      await PageView.create({
        waitlistId: waitlist._id,
        visitorId: visitorId.trim(),
      });
    }

    res.json({ recorded: true });
  } catch (err) {
    console.error("recordVisit error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// GET /api/w/:slug/activity (public) — Recent anonymized signup activity
async function getRecentActivity(req, res) {
  try {
    const waitlist = await Waitlist.findOne({ slug: req.params.slug });
    if (!waitlist) {
      return res.status(404).json({ error: "Waitlist not found" });
    }

    const recentSignups = await rankedSignups(waitlist._id, [
      { $sort: { createdAt: -1, _id: -1 } }, { $limit: 8 },
      { $project: { email: 1, currentPosition: 1, createdAt: 1 } },
    ]);

    const activities = recentSignups.map((s) => ({
      id: s._id,
      userMasked: maskEmail(s.email),
      position: s.currentPosition,
      createdAt: s.createdAt,
    }));

    res.json({ activities });
  } catch (err) {
    console.error("getRecentActivity error:", err);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

module.exports = {
  getWaitlistInfo,
  join,
  checkPosition,
  getLeaderboard,
  recordVisit,
  getRecentActivity,
  maskEmail,
};