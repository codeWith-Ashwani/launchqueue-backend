const request = require("supertest");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const app = require("../../index");
const Founder = require("../../models/Founder");
const { connectDb, closeDb, clearDb } = require("../setupDb");

describe("Google OAuth Integration Tests", () => {
  beforeAll(async () => {
    await connectDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await clearDb();
    viResetMocks();
  });

  function viResetMocks() {
    jest.restoreAllMocks();
  }

  it("creates a new founder with authProvider: google and returns JWT cookie on new Google sign-in", async () => {
    jest.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValueOnce({
      getPayload: () => ({
        sub: "google_123456789",
        email: "googleuser@example.com",
        name: "Google User",
        email_verified: true,
      }),
    });

    const res = await request(app)
      .post("/api/auth/google")
      .send({ credential: "valid_mock_google_id_token" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(res.body.founder).toHaveProperty("email", "googleuser@example.com");
    expect(res.body.founder).toHaveProperty("name", "Google User");
    expect(res.headers["set-cookie"]).toBeDefined();

    const dbFounder = await Founder.findOne({ email: "googleuser@example.com" });
    expect(dbFounder).toBeTruthy();
    expect(dbFounder.googleId).toBe("google_123456789");
    expect(dbFounder.authProvider).toBe("google");
    expect(dbFounder.password).toBeNull();
  });

  it("links googleId to existing local-password account without creating a duplicate", async () => {
    const hashedPassword = await bcrypt.hash("localpassword123", 10);
    await Founder.create({
      email: "existing@example.com",
      password: hashedPassword,
      name: "Existing Founder",
      authProvider: "local",
    });

    jest.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValueOnce({
      getPayload: () => ({
        sub: "google_987654321",
        email: "existing@example.com",
        name: "Existing Founder",
        email_verified: true,
      }),
    });

    const res = await request(app)
      .post("/api/auth/google")
      .send({ credential: "valid_mock_google_id_token" });

    expect(res.status).toBe(200);

    const totalFounders = await Founder.countDocuments();
    expect(totalFounders).toBe(1);

    const updatedFounder = await Founder.findOne({ email: "existing@example.com" });
    expect(updatedFounder.googleId).toBe("google_987654321");
    expect(updatedFounder.password).toBe(hashedPassword); // password preserved
  });

  it("logs in existing googleId founder without creating duplicate", async () => {
    await Founder.create({
      email: "returning@example.com",
      name: "Returning User",
      googleId: "google_returning_111",
      authProvider: "google",
    });

    jest.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValueOnce({
      getPayload: () => ({
        sub: "google_returning_111",
        email: "returning@example.com",
        name: "Returning User",
        email_verified: true,
      }),
    });

    const res = await request(app)
      .post("/api/auth/google")
      .send({ credential: "valid_mock_google_id_token" });

    expect(res.status).toBe(200);

    const count = await Founder.countDocuments();
    expect(count).toBe(1);
  });

  it("rejects unverified Google email with 400", async () => {
    jest.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValueOnce({
      getPayload: () => ({
        sub: "google_unverified_999",
        email: "unverified@example.com",
        name: "Unverified User",
        email_verified: false,
      }),
    });

    const res = await request(app)
      .post("/api/auth/google")
      .send({ credential: "mock_unverified_token" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "Google email is not verified");

    const exists = await Founder.findOne({ email: "unverified@example.com" });
    expect(exists).toBeNull();
  });

  it("allows existing local-password founder without googleId to log in via standard /auth/login", async () => {
    const hashedPassword = await bcrypt.hash("standardpass123", 10);
    await Founder.create({
      email: "standard@example.com",
      password: hashedPassword,
      authProvider: "local",
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: "standard@example.com",
        password: "standardpass123",
      });

    expect(res.status).toBe(200);
    expect(res.body.founder.email).toBe("standard@example.com");
  });

  it("returns clear message when a Google-only founder attempts to log in via password /auth/login", async () => {
    await Founder.create({
      email: "googleonly@example.com",
      name: "Google Only",
      googleId: "google_only_000",
      authProvider: "google",
      password: null,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: "googleonly@example.com",
        password: "someattemptedpassword",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uses Google Sign-In\. Please log in with Google instead/i);
  });
});
