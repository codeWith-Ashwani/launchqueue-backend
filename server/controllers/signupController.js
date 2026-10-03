const Founder = require("../models/Founder");
const { limitsFor } = require("../services/entitlements");
const { issueVerificationToken, verifyVerificationToken } = require("../utils/verificationToken");
const verificationEmail = require("../templates/verificationEmail");
const { issueSubscriberToken, verifySubscriberToken } = require("../utils/subscriberToken");
const statusEmail = require("../templates/statusEmail");
const mongoose = require("mongoose");
const { rankedSignups, signupState } = require("../services/ranking");
const Waitlist = require("../models/Waitlist");
const Signup = require("../models/Signup");
const PageView = require("../models/PageView");
const generateRefCode = require("../utils/generateRefCode");
const calculatePosition = require("../utils/calculatePosition");
const { recordEmail, dispatchInline } = require("../services/emailOutbox");
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
      waitlistId: waitlist._id, verificationState: { $ne: "pending" },
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
      const owner = await Founder.findById(waitlist.founderId).session(session);
      if (await Signup.countDocuments({ waitlistId: waitlist._id }).session(session) >= limitsFor(owner).signups) {
        throw Object.assign(new Error("This waitlist has reached its signup capacity. Please contact the founder."), { status: 403 });
      }

      // Bootstrap existing campaigns using their largest historical sequence.
      const latest = await Signup.findOne({ waitlistId: waitlist._id }).sort({ basePosition: -1 }).session(session);
      await Waitlist.updateOne({ _id: waitlist._id }, { $max: { signupSequence: latest?.basePosition || 0 } }, { session });
      const allocated = await Waitlist.findOneAndUpdate(
        { _id: waitlist._id }, { $inc: { signupSequence: 1 } }, { session, returnDocument: "after" }
      );
      let referrer = ref ? await Signup.findOne({ waitlistId: waitlist._id, refCode: ref }).session(session) : null;
      if (referrer?.email === email || referrer?.verificationState === "pending") referrer = null;
      const [signup] = await Signup.create([{
        waitlistId: waitlist._id, email, refCode: generateRefCode(),
        referredBy: referrer?.refCode || null,
        basePosition: allocated.signupSequence, currentPosition: allocated.signupSequence, verificationState: "pending",
      }], { session });
      const emailJob = await verificationNotification(signup, waitlist, session);
      return { waitlist, signup, emails: [emailJob], alreadyJoined: false };
    });
    if (result.alreadyJoined) await emailStatusLink(result.signup, result.waitlist);
    else await dispatchInline(result.emails);
    return res.status(202).json({ statusLinkSent: true, message: STATUS_MESSAGE });
  } catch (err) {
    if (err.code === 11000) {
      const waitlist = await Waitlist.findOne({ slug: req.params.slug });
      const existing = waitlist && await Signup.findOne({ waitlistId: waitlist._id, email: req.body.email });
      if (existing) {
        await emailStatusLink(existing, waitlist);
        return res.status(202).json({ statusLinkSent: true, message: STATUS_MESSAGE });
      }
      return res.status(409).json({ error: "Please retry your signup" });
    }
    console.error("join waitlist error:", err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : "Unable to join waitlist" });
  }
}

// Subscriber recovery is generic; private signed links prove email ownership.
const STATUS_MESSAGE = "Check your inbox for a private verification or status link. If eligible, a link will be sent.";

async function verificationNotification(signup, waitlist, session = null) {
  return recordEmail({ dedupeKey: `verification-${signup._id}-${Math.floor(Date.now() / 300000)}`, kind: "verification",
    waitlistId: waitlist._id, signupId: signup._id, to: signup.email, subject: "Verify your LaunchQueue email",
    html: verificationEmail({ verificationUrl: `${process.env.CLIENT_URL}/w/${waitlist.slug}#verify=${issueVerificationToken(signup)}` }),
    expiresAt: new Date(Date.now() + 86400000) }, session);
}

async function verifyEmail(req, res) {
  let identity;
  try { identity = verifyVerificationToken(req.body.token); }
  catch { return res.status(401).json({ error: "Verification link is invalid or expired. Request a new link." }); }
  try {
    const result = await mongoose.connection.transaction(async (session) => {
      const waitlist = await Waitlist.findOne({ slug: req.params.slug, _id: identity.waitlistId }).session(session);
      if (!waitlist) throw Object.assign(new Error("Invalid verification link"), { status: 401 });
      // Serialize queue and referral changes, including repeated clicks on a verification link.
      await Waitlist.updateOne({ _id: waitlist._id }, { $inc: { queueVersion: 1 } }, { session });
      const signup = await Signup.findOne({ _id: identity.signupId, waitlistId: waitlist._id }).session(session);
      if (!signup) throw Object.assign(new Error("Invalid verification link"), { status: 401 });
      const emails = [];
      if (signup.verificationState === "pending") {
        signup.verificationState = "verified";
        signup.verifiedAt = new Date();
        await signup.save({ session });
        const referrer = signup.referredBy ? await Signup.findOne({ waitlistId: waitlist._id, refCode: signup.referredBy,
          verificationState: { $ne: "pending" }, _id: { $ne: signup._id } }).session(session) : null;
        if (referrer) {
          const [before] = await rankedSignups(waitlist._id, [{ $match: { _id: referrer._id } }], session);
          await Signup.updateOne({ _id: referrer._id }, { $inc: { referralCount: 1 } }, { session });
          referrer.referralCount += 1;
          referrer.currentPosition = calculatePosition(referrer.basePosition, referrer.referralCount);
          await referrer.save({ session });
          const [after] = await rankedSignups(waitlist._id, [{ $match: { _id: referrer._id } }], session);
          emails.push(await recordEmail({ dedupeKey: `referral-${signup._id}`, kind: "referral", waitlistId: waitlist._id, signupId: referrer._id,
            to: referrer.email, subject: `Your ${waitlist.name} referral was verified`,
            html: rankUpEmail({ waitlistName: waitlist.name, oldPosition: before.currentPosition, newPosition: after.currentPosition,
              shareUrl: `${process.env.CLIENT_URL}/w/${waitlist.slug}?ref=${referrer.refCode}` }) }, session));
        }
        const [ranked] = await rankedSignups(waitlist._id, [{ $match: { _id: signup._id } }], session);
        emails.push(await recordEmail({ dedupeKey: `confirmation-${signup._id}`, kind: "confirmation", waitlistId: waitlist._id, signupId: signup._id,
          to: signup.email, subject: `You joined the ${waitlist.name} waitlist`,
          html: confirmationEmail({ waitlistName: waitlist.name, position: ranked.currentPosition,
            shareUrl: `${process.env.CLIENT_URL}/w/${waitlist.slug}?ref=${signup.refCode}` }) }, session));
      }
      return { signup, waitlist, emails };
    });
    await dispatchInline(result.emails);
    res.json({ ...await signupState(result.signup, result.waitlist), statusToken: issueSubscriberToken(result.signup) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Unable to verify email. Please try again." });
  }
}

async function emailStatusLink(signup, waitlist) {
  if (signup.verificationState === "pending") {
    await dispatchInline([await verificationNotification(signup, waitlist)]);
    return;
  }
  const statusUrl = `${process.env.CLIENT_URL}/w/${waitlist.slug}#status=${issueSubscriberToken(signup)}`;
  const email = await recordEmail({ dedupeKey: `status-${signup._id}-${Math.floor(Date.now() / 300000)}`, kind: "status", waitlistId: waitlist._id,
    signupId: signup._id, to: signup.email, subject: "Your private LaunchQueue status link", html: statusEmail({ statusUrl }), expiresAt: new Date(Date.now() + 7 * 86400000) });
  await dispatchInline([email]);
}

async function requestStatusLink(req, res) {
  try {
    const waitlist = await Waitlist.findOne({ slug: req.params.slug });
    const signup = waitlist && await Signup.findOne({ waitlistId: waitlist._id, email: req.body.email });
    if (signup) await emailStatusLink(signup, waitlist);
    res.status(202).json({ message: STATUS_MESSAGE, statusLinkSent: true });
  } catch (err) {
    console.error("Status link delivery failed:", err.message);
    res.status(503).json({ error: "Unable to request a status link. Please try again." });
  }
}

async function checkPosition(req, res) {
  let identity;
  try { identity = verifySubscriberToken(req.get("X-Subscriber-Token") || ""); }
  catch { return res.status(401).json({ error: "A valid private status link is required" }); }
  try {
    const waitlist = await Waitlist.findOne({ slug: req.params.slug });
    if (!waitlist || waitlist._id.toString() !== identity.waitlistId) {
      return res.status(401).json({ error: "A valid private status link is required" });
    }
    const signup = await Signup.findOne({ _id: identity.signupId, waitlistId: waitlist._id });
    if (!signup || signup.verificationState === "pending") return res.status(401).json({ error: "A valid private status link is required" });
    res.json({ ...await signupState(signup, waitlist), statusToken: req.get("X-Subscriber-Token") });
  } catch {
    res.status(500).json({ error: "Unable to retrieve status" });
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
      { $match: { referralCount: { $gt: 0 }, verificationState: { $ne: "pending" } } },
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
      { $match: { verificationState: { $ne: "pending" } } },
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
  requestStatusLink,
  verifyEmail,
  getLeaderboard,
  recordVisit,
  getRecentActivity,
  maskEmail,
};