const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../../index");
const Founder = require("../../models/Founder");
const Waitlist = require("../../models/Waitlist");
const Signup = require("../../models/Signup");
const generateToken = require("../../utils/generateToken");
const { connectDb, closeDb, clearDb } = require("../setupDb");

describe("CSV Export Integration Tests", () => {
  let founder1;
  let token1;
  let founder2;
  let token2;
  let waitlist;

  beforeAll(async () => {
    await connectDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await clearDb();

    founder1 = await Founder.create({
      email: "founder1@example.com",
      password: "password123",
      plan: "free",
    });
    token1 = generateToken(founder1._id);

    founder2 = await Founder.create({
      email: "founder2@example.com",
      password: "password123",
      plan: "pro",
    });
    token2 = generateToken(founder2._id);

    waitlist = await Waitlist.create({
      founderId: founder1._id,
      name: "SaaS Launch",
      slug: "saas-launch",
    });
  });

  it("exports CSV for a waitlist with signups sorted by position", async () => {
    await Signup.create([
      {
        waitlistId: waitlist._id,
        email: "alice@example.com",
        refCode: "REF_ALICE",
        basePosition: 1,
        referralCount: 2,
        currentPosition: 1,
      },
      {
        waitlistId: waitlist._id,
        email: "bob@example.com",
        refCode: "REF_BOB",
        referredBy: "REF_ALICE",
        basePosition: 2,
        referralCount: 0,
        currentPosition: 2,
      },
    ]);

    const res = await request(app)
      .get(`/api/waitlists/${waitlist._id}/export`)
      .set("Authorization", `Bearer ${token1}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="saas-launch-signups.csv"');

    const lines = res.text.trim().split("\n");
    expect(lines[0]).toBe("email,currentPosition,referralCount,referredBy,joinedAt");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("alice@example.com,1,2,,");
    expect(lines[2]).toContain("bob@example.com,2,0,REF_ALICE,");
  });

  it("exports header-only CSV when waitlist has zero signups", async () => {
    const res = await request(app)
      .get(`/api/waitlists/${waitlist._id}/export`)
      .set("Authorization", `Bearer ${token1}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text.trim()).toBe("email,currentPosition,referralCount,referredBy,joinedAt");
  });

  it("returns 404 when exporting a waitlist owned by another founder (no resource existence leak)", async () => {
    const res = await request(app)
      .get(`/api/waitlists/${waitlist._id}/export`)
      .set("Authorization", `Bearer ${token2}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "Waitlist not found");
  });

  it("returns 404 when exporting a non-existent waitlist ID", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/waitlists/${fakeId}/export`)
      .set("Authorization", `Bearer ${token1}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "Waitlist not found");
  });

  it("escapes fields with commas or quotes properly according to RFC 4180", async () => {
    // Unusual email or ref code containing quotes/commas
    await Signup.create({
      waitlistId: waitlist._id,
      email: 'user"with"quotes@example.com',
      refCode: "REF_SPECIAL",
      referredBy: "REF,WITH,COMMAS",
      basePosition: 1,
      referralCount: 0,
      currentPosition: 1,
    });

    const res = await request(app)
      .get(`/api/waitlists/${waitlist._id}/export`)
      .set("Authorization", `Bearer ${token1}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('"user""with""quotes@example.com"');
    expect(res.text).toContain('"REF,WITH,COMMAS"');
  });
});
