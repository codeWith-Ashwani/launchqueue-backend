const mongoose = require("mongoose");
const BillingEvent = require("../models/BillingEvent");
const crypto = require("crypto");
const Founder = require("../models/Founder");

function isCheckoutConfigured() {
  return Boolean(
    process.env.LEMONSQUEEZY_API_KEY &&
    process.env.LEMONSQUEEZY_STORE_ID &&
    process.env.LEMONSQUEEZY_STARTER_VARIANT_ID &&
    process.env.LEMONSQUEEZY_PRO_VARIANT_ID &&
    process.env.LEMONSQUEEZY_AGENCY_VARIANT_ID
  );
}

function isWebhookConfigured() {
  return Boolean(process.env.LEMONSQUEEZY_WEBHOOK_SECRET);
}

function getVariantToPlan() {
  return {
    [process.env.LEMONSQUEEZY_STARTER_VARIANT_ID]: "starter",
    [process.env.LEMONSQUEEZY_PRO_VARIANT_ID]: "pro",
    [process.env.LEMONSQUEEZY_AGENCY_VARIANT_ID]: "agency",
  };
}

function getPlanToVariant() {
  return {
    starter: process.env.LEMONSQUEEZY_STARTER_VARIANT_ID,
    pro: process.env.LEMONSQUEEZY_PRO_VARIANT_ID,
    agency: process.env.LEMONSQUEEZY_AGENCY_VARIANT_ID,
  };
}

// POST /api/payments/checkout  (protected)
async function createCheckout(req, res) {
  try {
    if (!isCheckoutConfigured()) {
      return res.status(503).json({
        error: "Payments are not configured on this server.",
      });
    }

    const { plan } = req.body;
    const planToVariant = getPlanToVariant();
    const variantId = ["starter", "pro", "agency"].includes(plan) ? planToVariant[plan] : null;

    if (!variantId) {
      return res.status(400).json({ error: "Invalid plan selected" });
    }

    const response = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
      },
      body: JSON.stringify({
        data: {
          type: "checkouts",
          attributes: {
            checkout_data: {
              email: req.founder.email,
              custom: { founder_id: req.founder._id.toString() },
            },
          },
          relationships: {
            store: { data: { type: "stores", id: process.env.LEMONSQUEEZY_STORE_ID } },
            variant: { data: { type: "variants", id: variantId } },
          },
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: "Failed to create checkout" });
    }

    res.json({ checkoutUrl: data.data.attributes.url });
  } catch (err) {
    console.error("CreateCheckout error:", { requestId: req.requestId, code: err.code || "INTERNAL" });
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// GET /api/payments/portal  (protected)
async function getCustomerPortal(req, res) {
  try {
    const founder = await Founder.findById(req.founder._id);
    if (!founder || (!founder.customerPortalUrl && !founder.lemonSqueezySubscriptionId)) {
      return res.status(404).json({
        error: "No active customer portal found. Please subscribe to a paid plan first.",
      });
    }

    if (founder.lemonSqueezySubscriptionId) {
      if (!process.env.LEMONSQUEEZY_API_KEY) return res.status(503).json({ error: "Billing portal is temporarily unavailable" });
      const response = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${encodeURIComponent(founder.lemonSqueezySubscriptionId)}`, {
        headers: { Accept: "application/vnd.api+json", Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      const data = await response.json();
      const portalUrl = data.data?.attributes?.urls?.customer_portal;
      if (!response.ok || !portalUrl) return res.status(502).json({ error: "Unable to load billing portal" });
      return res.json({ portalUrl });
    }
    res.json({ portalUrl: founder.customerPortalUrl });
  } catch (err) {
    console.error("GetCustomerPortal error:", { requestId: req.requestId, code: err.code || "INTERNAL" });
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

// POST /api/payments/webhook  (public, signature-verified)
async function handleWebhook(req, res) {
  try {
    if (!isWebhookConfigured()) {
      return res.status(503).json({
        error: "Payments are not configured on this server.",
      });
    }

    const signature = req.get("x-signature") || "";
    const digest = crypto.createHmac("sha256", process.env.LEMONSQUEEZY_WEBHOOK_SECRET).update(req.body).digest();
    if (!/^[a-fA-F0-9]{64}$/.test(signature) || !crypto.timingSafeEqual(Buffer.from(signature, "hex"), digest)) {
      return res.status(401).json({ error: "Invalid signature" });
    }
    let event;
    try { event = JSON.parse(req.body.toString()); }
    catch { return res.status(400).json({ error: "Invalid webhook payload" }); }
    const eventName = event.meta?.event_name;
    const supported = ["subscription_created", "subscription_updated", "subscription_cancelled", "subscription_resumed",
      "subscription_expired", "subscription_paused", "subscription_unpaused"];
    if (!supported.includes(eventName)) return res.json({ received: true });
    const attributes = event.data?.attributes;
    const updatedAt = new Date(attributes?.updated_at);
    const subscriptionId = String(event.data?.id || "");
    const statuses = ["on_trial", "active", "paused", "past_due", "unpaid", "cancelled", "expired"];
    if (event.data?.type !== "subscriptions" || !subscriptionId || !statuses.includes(attributes?.status) || !Number.isFinite(updatedAt.getTime())) {
      return res.status(400).json({ error: "Invalid subscription payload" });
    }
    if (process.env.LEMONSQUEEZY_STORE_ID && String(attributes.store_id) !== process.env.LEMONSQUEEZY_STORE_ID) return res.json({ received: true });
    if (Boolean(attributes.test_mode) !== (process.env.LEMONSQUEEZY_TEST_MODE === "true")) return res.json({ received: true });
    const endsAt = attributes.ends_at ? new Date(attributes.ends_at) : null;
    if ((endsAt && !Number.isFinite(endsAt.getTime())) || (attributes.status === "cancelled" && !endsAt)) {
      return res.status(400).json({ error: "Invalid subscription end date" });
    }
    const fingerprint = crypto.createHash("sha256").update(req.body).digest("hex");
    await mongoose.connection.transaction(async (session) => {
      if (await BillingEvent.findOne({ fingerprint }).session(session)) return;
      const [receipt] = await BillingEvent.create([{ fingerprint, eventName, subscriptionId, providerUpdatedAt: updatedAt }], { session });
      const founderId = event.meta.custom_data?.founder_id;
      const founder = /^[a-fA-F0-9]{24}$/.test(founderId || "") ? await Founder.findById(founderId).session(session) :
        await Founder.findOne({ lemonSqueezySubscriptionId: subscriptionId }).session(session);
      if (!founder) return;
      const severity = { active: 0, on_trial: 0, paused: 1, past_due: 2, cancelled: 3, unpaid: 4, expired: 5 };
      const oldSubscription = founder.lemonSqueezySubscriptionId && founder.lemonSqueezySubscriptionId !== subscriptionId && eventName !== "subscription_created";
      const older = founder.billingUpdatedAt && (updatedAt < founder.billingUpdatedAt ||
        (updatedAt.getTime() === founder.billingUpdatedAt.getTime() && severity[attributes.status] <= (severity[founder.subscriptionStatus] || 0)));
      if (oldSubscription || older) { receipt.outcome = "stale"; await receipt.save({ session }); return; }
      const plan = getVariantToPlan()[String(attributes.variant_id)] || "free";
      const hasAccess = !["expired", "unpaid"].includes(attributes.status) &&
        (attributes.status !== "cancelled" || endsAt > new Date());
      await Founder.updateOne({ _id: founder._id }, { $set: {
        plan: hasAccess ? plan : "free", subscriptionStatus: attributes.status, subscriptionEndsAt: endsAt,
        billingUpdatedAt: updatedAt, lemonSqueezySubscriptionId: subscriptionId,
        customerPortalUrl: attributes.urls?.customer_portal || founder.customerPortalUrl,
      } }, { session });
      receipt.outcome = "applied"; await receipt.save({ session });
    });
    res.status(200).json({ received: true });
  } catch (err) {
    if (err.code === 11000) return res.json({ received: true });
    console.error("Webhook processing failed");
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  }
}

module.exports = { createCheckout, getCustomerPortal, handleWebhook };
