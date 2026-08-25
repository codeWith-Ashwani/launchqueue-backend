const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../../index");
const Founder = require("../../models/Founder");
const generateToken = require("../../utils/generateToken");
const { connectDb, closeDb, clearDb } = require("../setupDb");

describe("Founder Profile & Password Integration Tests", () => {
  let founder;
  let token;

  beforeAll(async () => {
    await connectDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await clearDb();

    const hashedPassword = await bcrypt.hash("oldpassword123", 10);
    founder = await Founder.create({
      name: "Original Founder",
      email: "founder@launchqueue.com",
      password: hashedPassword,
      plan: "free",
    });

    token = generateToken(founder._id);
  });

  describe("PATCH /api/auth/profile", () => {
    it("successfully updates founder name and email", async () => {
      const res = await request(app)
        .patch("/api/auth/profile")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Updated Founder",
          email: "newemail@launchqueue.com",
        });

      expect(res.status).toBe(200);
      expect(res.body.founder).toHaveProperty("id", founder._id.toString());
      expect(res.body.founder).toHaveProperty("name", "Updated Founder");
      expect(res.body.founder).toHaveProperty("email", "newemail@launchqueue.com");
      expect(res.body.founder).not.toHaveProperty("password");

      const dbFounder = await Founder.findById(founder._id);
      expect(dbFounder.name).toBe("Updated Founder");
      expect(dbFounder.email).toBe("newemail@launchqueue.com");
    });

    it("returns 409 when updating to an email already taken by another founder", async () => {
      await Founder.create({
        email: "other@launchqueue.com",
        password: "password123",
      });

      const res = await request(app)
        .patch("/api/auth/profile")
        .set("Authorization", `Bearer ${token}`)
        .send({
          email: "other@launchqueue.com",
        });

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/already exists/i);
    });

    it("returns 400 when submitting an empty update payload", async () => {
      const res = await request(app)
        .patch("/api/auth/profile")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/At least one field/i);
    });
  });

  describe("PATCH /api/auth/password", () => {
    it("successfully changes the password with valid current password", async () => {
      const res = await request(app)
        .patch("/api/auth/password")
        .set("Authorization", `Bearer ${token}`)
        .send({
          currentPassword: "oldpassword123",
          newPassword: "newsecretpassword123",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("message");
      expect(res.body.message).toMatch(/Password updated successfully/i);

      // Verify login with new password succeeds
      const loginRes = await request(app)
        .post("/api/auth/login")
        .send({
          email: "founder@launchqueue.com",
          password: "newsecretpassword123",
        });

      expect(loginRes.status).toBe(200);
    });

    it("returns 401 when current password is wrong", async () => {
      const res = await request(app)
        .patch("/api/auth/password")
        .set("Authorization", `Bearer ${token}`)
        .send({
          currentPassword: "incorrectpassword",
          newPassword: "newsecretpassword123",
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/Incorrect current password/i);
    });

    it("returns 400 when new password is too short (< 6 chars)", async () => {
      const res = await request(app)
        .patch("/api/auth/password")
        .set("Authorization", `Bearer ${token}`)
        .send({
          currentPassword: "oldpassword123",
          newPassword: "123",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 400 when new password is identical to current password", async () => {
      const res = await request(app)
        .patch("/api/auth/password")
        .set("Authorization", `Bearer ${token}`)
        .send({
          currentPassword: "oldpassword123",
          newPassword: "oldpassword123",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/different/i);
    });
  });

  describe("GET /api/payments/portal", () => {
    it("returns 404 if founder has no active customer portal URL", async () => {
      const res = await request(app)
        .get("/api/payments/portal")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/No active customer portal found/i);
    });

    it("returns portal URL when founder has customerPortalUrl set", async () => {
      await Founder.findByIdAndUpdate(founder._id, {
        customerPortalUrl: "https://launchqueue.lemonsqueezy.com/billing",
      });

      const res = await request(app)
        .get("/api/payments/portal")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("portalUrl", "https://launchqueue.lemonsqueezy.com/billing");
    });
  });
});
