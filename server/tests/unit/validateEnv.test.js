const validateEnv = require("../../utils/validateEnv");

describe("Environment Validation Unit Tests", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
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
});
