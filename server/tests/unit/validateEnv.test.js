const validateEnv = require("../../utils/validateEnv");

describe("Environment Validation Unit Tests", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AI_PROVIDER; delete process.env.GROQ_MODEL; delete process.env.GEMINI_MODEL;
    process.env.EMAIL_PROVIDER = "smtp";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("does not throw when payment env vars are missing in development", () => {
    process.env.NODE_ENV = "development";
    process.env.MONGO_URI = "mongodb://localhost:27017/test";
    process.env.JWT_SECRET = "secret_jwt_32_chars_long_for_test";
    process.env.CLIENT_URL = "http://localhost:5173";

    delete process.env.LEMONSQUEEZY_API_KEY;
    delete process.env.LEMONSQUEEZY_STORE_ID;
    delete process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

    expect(() => validateEnv()).not.toThrow();
  });

  it("throws when MONGO_URI is missing", () => {
    process.env.NODE_ENV = "development";
    delete process.env.MONGO_URI;
    process.env.JWT_SECRET = "secret_jwt_32_chars_long_for_test";
    process.env.CLIENT_URL = "http://localhost:5173";

    expect(() => validateEnv()).toThrow(/Missing required environment variables/i);
  });

  it("rejects unsupported email providers", () => {
    process.env.EMAIL_PROVIDER = "unknown";
    expect(() => validateEnv()).toThrow("EMAIL_PROVIDER must be smtp or brevo");
  });
  it("fails fast for an unsupported AI provider", () => {
    process.env.AI_PROVIDER = "unknown";
    expect(() => validateEnv()).toThrow("AI_PROVIDER must be groq or gemini");
  });
  it("accepts a namespaced Groq model in the configured provider", () => {
    process.env.NODE_ENV = "test"; process.env.AI_PROVIDER = "groq"; process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    expect(() => validateEnv()).not.toThrow();
  });

  it("requires the Brevo API key", () => {
    process.env.EMAIL_PROVIDER = "brevo"; delete process.env.BREVO_API_KEY;
    expect(() => validateEnv()).toThrow("Brevo requires BREVO_API_KEY");
  });

  it.each(["", "LaunchQueue <sender@example.com>", "invalid"])("rejects an invalid Brevo sender: %s", (sender) => {
    process.env.EMAIL_PROVIDER = "brevo"; process.env.BREVO_API_KEY = "synthetic-key";
    process.env.EMAIL_FROM = sender;
    expect(() => validateEnv()).toThrow("Brevo requires EMAIL_FROM");
  });

  it("accepts HTTPS delivery without SMTP credentials", () => {
    process.env.NODE_ENV = "test"; process.env.EMAIL_PROVIDER = "brevo";
    process.env.BREVO_API_KEY = "synthetic-key"; process.env.EMAIL_FROM = "sender@example.com";
    delete process.env.EMAIL_USER; delete process.env.EMAIL_PASS;
    expect(() => validateEnv()).not.toThrow();
  });
});
