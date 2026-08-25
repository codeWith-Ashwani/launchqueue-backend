const request = require("supertest");
const app = require("../../index");
const Founder = require("../../models/Founder");
const Waitlist = require("../../models/Waitlist");
const generateToken = require("../../utils/generateToken");
const { connectDb, closeDb, clearDb } = require("../setupDb");

describe("Zod Input Validation Integration Tests", () => {
  let founder;
  let token;
  let waitlist;

  beforeAll(async () => {
    await connectDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await clearDb();

    founder = await Founder.create({
      email: "validator@example.com",
      password: "password123",
    });
    token = generateToken(founder._id);

    waitlist = await Waitlist.create({
      founderId: founder._id,
      name: "Validator Waitlist",
      slug: "val-waitlist",
    });
  });

  describe("Auth Validation", () => {
    it("returns 400 with field errors on invalid registration payload", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          email: "not-an-email",
          password: "123", // too short
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body).toHaveProperty("details");
      expect(res.body.details).toHaveProperty("email");
      expect(res.body.details).toHaveProperty("password");
    });

    it("returns 400 with field errors on empty login payload", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body).toHaveProperty("details");
      expect(res.body.details).toHaveProperty("email");
      expect(res.body.details).toHaveProperty("password");
    });
  });

  describe("Waitlist Validation", () => {
    it("returns 400 when creating a waitlist without a name", async () => {
      const res = await request(app)
        .post("/api/waitlists")
        .set("Authorization", `Bearer ${token}`)
        .send({ description: "No name provided" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.details).toHaveProperty("name");
    });

    it("returns 400 when updating a waitlist with invalid milestone numbers", async () => {
      const res = await request(app)
        .patch(`/api/waitlists/${waitlist._id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          milestones: [
            { referrals: -5, reward: "Invalid negative" },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.details["milestones.0.referrals"]).toBeDefined();
    });
  });

  describe("Signup Validation", () => {
    it("returns 400 when joining a waitlist with an invalid email address", async () => {
      const res = await request(app)
        .post("/api/w/val-waitlist/signup")
        .send({ email: "invalid-email-format" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.details).toHaveProperty("email");
    });
  });
});
