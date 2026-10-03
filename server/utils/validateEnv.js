function validateEnv() {
  const { emailProvider, brevoConfig } = require("../config/email");
  if (emailProvider() === "brevo") brevoConfig();
  require("../config/redis").validateRedisUrl(process.env.REDIS_URL);
  if (process.env.EMAIL_DELIVERY_MODE && !["inline", "queue"].includes(process.env.EMAIL_DELIVERY_MODE)) {
    throw new Error("EMAIL_DELIVERY_MODE must be inline or queue");
  }
  if (process.env.TRUST_PROXY_HOPS && !/^[0-5]$/.test(process.env.TRUST_PROXY_HOPS)) {
    throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 5");
  }
  const requiredVars = [
    "MONGO_URI",
    "JWT_SECRET",
    "CLIENT_URL",
  ];

  const paymentVars = [
    "LEMONSQUEEZY_API_KEY",
    "LEMONSQUEEZY_STORE_ID",
    "LEMONSQUEEZY_WEBHOOK_SECRET",
    "LEMONSQUEEZY_STARTER_VARIANT_ID",
    "LEMONSQUEEZY_PRO_VARIANT_ID",
    "LEMONSQUEEZY_AGENCY_VARIANT_ID",
  ];

  // In test environment, set dummy fallbacks if not provided
  if (process.env.NODE_ENV === "test") {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_jwt_secret_key_32_characters_minimum_len";
    if (!process.env.CLIENT_URL) process.env.CLIENT_URL = "http://localhost:5173";
    return;
  }

  // Hard-required core variables
  const missingCore = [];
  for (const v of requiredVars) {
    if (!process.env[v]) {
      missingCore.push(v);
    }
  }

  if (missingCore.length > 0) {
    const errorMsg = `❌ Fatal Environment Error: Missing required environment variables:\n  - ${missingCore.join("\n  - ")}\nPlease verify your .env configuration before starting the server.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Soft check for optional payment variables
  const missingPayment = [];
  for (const v of paymentVars) {
    if (!process.env[v]) {
      missingPayment.push(v);
    }
  }

  if (missingPayment.length > 0) {
    console.warn(
      `⚠️ Payment features disabled: missing LEMONSQUEEZY_* env vars (${missingPayment.join(", ")}). Auth and waitlist features will still work.`
    );
  }
}

module.exports = validateEnv;
