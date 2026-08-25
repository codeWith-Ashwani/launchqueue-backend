const crypto = require("crypto");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../../index");
const Founder = require("../../models/Founder");
const { connectDb, closeDb, clearDb } = require("../setupDb");

describe("Password Reset Flow Integration Tests", () => {
  let founder;

  beforeAll(async () => {
    await connectDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await clearDb();

    const hashedPassword = await bcrypt.hash("initialpassword123", 10);
    founder = await Founder.create({
      email: "registered@example.com",
      password: hashedPassword,
    });
  });

  describe("POST /api/auth/forgot-password", () => {
    it("returns generic 200 message and stores token hash + future expiry for existing email", async () => {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: "registered@example.com" });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/If an account exists for this email/i);

      const dbFounder = await Founder.findById(founder._id);
      expect(dbFounder.resetPasswordTokenHash).toBeTruthy();
      expect(dbFounder.resetPasswordExpires).toBeDefined();
      expect(new Date(dbFounder.resetPasswordExpires).getTime()).toBeGreaterThan(Date.now());
    });

    it("returns same generic 200 message for non-existent email (no user enumeration)", async () => {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: "unregistered@example.com" });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/If an account exists for this email/i);
    });

    it("returns 400 when email format is invalid", async () => {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: "not-an-email" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("POST /api/auth/reset-password", () => {
    it("resets password successfully with valid unexpired token and allows login with new password", async () => {
      const rawToken = "mysecretresettoken1234567890abcdef";
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

      founder.resetPasswordTokenHash = tokenHash;
      founder.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
      await founder.save();

      const resetRes = await request(app)
        .post("/api/auth/reset-password")
        .send({
          token: rawToken,
          newPassword: "brandnewpassword123",
        });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.message).toMatch(/successfully reset/i);

      // Verify token is cleared (single use)
      const updatedFounder = await Founder.findById(founder._id);
      expect(updatedFounder.resetPasswordTokenHash).toBeNull();
      expect(updatedFounder.resetPasswordExpires).toBeNull();

      // Verify login with new password succeeds
      const loginRes = await request(app)
        .post("/api/auth/login")
        .send({
          email: "registered@example.com",
          password: "brandnewpassword123",
        });

      expect(loginRes.status).toBe(200);
    });

    it("returns 400 on invalid/made-up token", async () => {
      const res = await request(app)
        .post("/api/auth/reset-password")
        .send({
          token: "invalid-token-12345",
          newPassword: "brandnewpassword123",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid or expired reset link/i);
    });

    it("returns 400 when token is expired", async () => {
      const rawToken = "expiredtoken1234567890abcdef";
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

      founder.resetPasswordTokenHash = tokenHash;
      founder.resetPasswordExpires = new Date(Date.now() - 1000); // 1 sec in past
      await founder.save();

      const res = await request(app)
        .post("/api/auth/reset-password")
        .send({
          token: rawToken,
          newPassword: "brandnewpassword123",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid or expired reset link/i);
    });

    it("fails on second attempt with same token (single-use constraint)", async () => {
      const rawToken = "singleusetoken1234567890abcdef";
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

      founder.resetPasswordTokenHash = tokenHash;
      founder.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
      await founder.save();

      // First use
      const firstRes = await request(app)
        .post("/api/auth/reset-password")
        .send({
          token: rawToken,
          newPassword: "firstnewpassword123",
        });
      expect(firstRes.status).toBe(200);

      // Second use
      const secondRes = await request(app)
        .post("/api/auth/reset-password")
        .send({
          token: rawToken,
          newPassword: "secondnewpassword123",
        });
      expect(secondRes.status).toBe(400);
      expect(secondRes.body.error).toMatch(/Invalid or expired reset link/i);
    });
  });
});
