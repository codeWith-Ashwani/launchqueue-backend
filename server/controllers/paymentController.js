const crypto = require("crypto");
const Founder = require("../models/Founder");

const VARIANT_TO_PLAN = {
  [process.env.LEMONSQUEEZY_STARTER_VARIANT_ID]: "starter",
  [process.env.LEMONSQUEEZY_PRO_VARIANT_ID]: "pro",
  [process.env.LEMONSQUEEZY_AGENCY_VARIANT_ID]: "agency",
};

const PLAN_TO_VARIANT = {
  starter: process.env.LEMONSQUEEZY_STARTER_VARIANT_ID,
  pro: process.env.LEMONSQUEEZY_PRO_VARIANT_ID,
  agency: process.env.LEMONSQUEEZY_AGENCY_VARIANT_ID,
};

// POST /api/payments/checkout  (protected)
async function createCheckout(req, res) {
  try {
    const { plan } = req.body;
    const variantId = PLAN_TO_VARIANT[plan];

    if (!variantId) {
      return res.status(400).json({ error: "Invalid plan selected" });
    }

    const response = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
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
    res.status(500).json({ error: err.message });
  }
}

// POST /api/payments/webhook  (public, signature-verified)
async function handleWebhook(req, res) {
  try {
    const signature = req.headers["x-signature"];
    const hmac = crypto.createHmac("sha256", process.env.LEMONSQUEEZY_WEBHOOK_SECRET);
    const digest = hmac.update(req.body).digest("hex"); // req.body is the raw Buffer here

    if (signature !== digest) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(req.body.toString());
    const eventName = event.meta.event_name;
    const founderId = event.meta.custom_data?.founder_id;

    if (!founderId) {
      return res.status(200).json({ received: true }); // nothing to do, but acknowledge receipt
    }

    if (eventName === "subscription_created" || eventName === "subscription_updated") {
      const status = event.data.attributes.status; // "active", "cancelled", "expired", etc.
      const variantId = String(event.data.attributes.variant_id);

      if (status === "active") {
        const plan = VARIANT_TO_PLAN[variantId] || "free";
        await Founder.findByIdAndUpdate(founderId, { plan });
      } else if (status === "cancelled" || status === "expired") {
        await Founder.findByIdAndUpdate(founderId, { plan: "free" });
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { createCheckout, handleWebhook };