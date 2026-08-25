const request = require("supertest");
const app = require("../../index");
const Waitlist = require("../../models/Waitlist");
const Signup = require("../../models/Signup");
const Founder = require("../../models/Founder");
const { connectDb, closeDb, clearDb } = require("../setupDb");

// Mock sendEmail to prevent outbound network calls during tests
jest.mock("../../utils/sendEmail", () => jest.fn().mockResolvedValue(true));

describe("Signup Flow Integration Tests", () => {
  let testFounder;

  beforeAll(async () => {
    await connectDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await clearDb();

    testFounder = await Founder.create({
      email: "founder@example.com",
      password: "password123",
    });

    await Waitlist.create({
      founderId: testFounder._id,
      name: "Early Beta Access",
      slug: "early-beta",
      ctaText: "Join Queue",
    });
  });

  it("handles a fresh signup successfully", async () => {
    const res = await request(app)
      .post("/api/w/early-beta/signup")
      .send({ email: "newuser@example.com" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("position", 1);
    expect(res.body).toHaveProperty("refCode");
    expect(res.body.alreadyJoined).toBe(false);

    const saved = await Signup.findOne({ email: "newuser@example.com" });
    expect(saved).not.toBeNull();
    expect(saved.basePosition).toBe(1);
    expect(saved.currentPosition).toBe(1);
  });

  it("returns alreadyJoined: true on duplicate signup", async () => {
    await request(app)
      .post("/api/w/early-beta/signup")
      .send({ email: "duplicate@example.com" });

    const duplicateRes = await request(app)
      .post("/api/w/early-beta/signup")
      .send({ email: "duplicate@example.com" });

    expect(duplicateRes.status).toBe(200);
    expect(duplicateRes.body.alreadyJoined).toBe(true);
    expect(duplicateRes.body.email).toBe("duplicate@example.com");
  });

  it("improves referrer position when joining with a valid referral code", async () => {
    // 1. First user signs up (Referrer)
    const user1Res = await request(app)
      .post("/api/w/early-beta/signup")
      .send({ email: "user1@example.com" });

    const referrerRefCode = user1Res.body.refCode;

    // Simulate referrer starting at basePosition 10 for clarity
    await Signup.updateOne(
      { email: "user1@example.com" },
      { basePosition: 10, currentPosition: 10, referralCount: 0 }
    );

    // 2. Second user signs up with user1's referral code
    const user2Res = await request(app)
      .post("/api/w/early-beta/signup")
      .send({
        email: "user2@example.com",
        ref: referrerRefCode,
      });

    expect(user2Res.status).toBe(201);

    // 3. Verify user1's referralCount and currentPosition improved
    const updatedReferrer = await Signup.findOne({ email: "user1@example.com" });
    expect(updatedReferrer.referralCount).toBe(1);
    // base 10 - 1*5 = 5
    expect(updatedReferrer.currentPosition).toBe(5);
  });

  it("ignores self-referral attempts per business logic", async () => {
    const res1 = await request(app)
      .post("/api/w/early-beta/signup")
      .send({ email: "selfref@example.com" });

    const ownRefCode = res1.body.refCode;

    // Attempt to signup again with same email using own refCode
    const res2 = await request(app)
      .post("/api/w/early-beta/signup")
      .send({
        email: "selfref@example.com",
        ref: ownRefCode,
      });

    expect(res2.status).toBe(200);
    expect(res2.body.alreadyJoined).toBe(true);

    const referrer = await Signup.findOne({ email: "selfref@example.com" });
    expect(referrer.referralCount).toBe(0);
    expect(referrer.currentPosition).toBe(1);
  });

  it("rejects disposable email signups with 400 Bad Request", async () => {
    const res = await request(app)
      .post("/api/w/early-beta/signup")
      .send({ email: "spammer@mailinator.com" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/disposable email/i);

    const saved = await Signup.findOne({ email: "spammer@mailinator.com" });
    expect(saved).toBeNull();
  });
});
