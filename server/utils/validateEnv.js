function validateEnv() {
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

  const missing = [];
  for (const v of requiredVars) {
    if (!process.env[v]) {
      missing.push(v);
    }
  }

  for (const v of paymentVars) {
    if (!process.env[v]) {
      missing.push(v);
    }
  }

  if (missing.length > 0) {
    const errorMsg = `❌ Fatal Environment Error: Missing required environment variables:\n  - ${missing.join("\n  - ")}\nPlease verify your .env configuration before starting the server.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
}

module.exports = validateEnv;
