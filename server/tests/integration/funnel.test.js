const request = require("supertest");
const app = require("../../index");
const Founder = require("../../models/Founder");
const Waitlist = require("../../models/Waitlist");
const Signup = require("../../models/Signup");
const PageView = require("../../models/PageView");
const generateToken = require("../../utils/generateToken");
const { connectDb, closeDb, clearDb } = require("../setupDb");

describe("Conversion Funnel & Referral Analytics Integration Tests", () => {
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
      email: "analytics1@founder.com",
      password: "password123",
      plan: "pro",
    });
    token1 = generateToken(founder1._id);

    founder2 = await Founder.create({
      email: "analytics2@founder.com",
      password: "password123",
      plan: "pro",
    });
    token2 = generateToken(founder2._id);

    waitlist = await Waitlist.create({
      founderId: founder1._id,
      name: "Funnel Test Launch",
      slug: "funnel-test",
    });
  });

  it("computes accurate funnel metrics and referral split for active waitlist", async () => {
    // 4 page views
    await PageView.create([
      { waitlistId: waitlist._id, visitorId: "vis_1" },
      { waitlistId: waitlist._id, visitorId: "vis_2" },
      { waitlistId: waitlist._id, visitorId: "vis_3" },
      { waitlistId: waitlist._id, visitorId: "vis_4" },
    ]);

    // 2 signups: 1 direct, 1 referred
    await Signup.create([
      {
        waitlistId: waitlist._id,
        email: "direct@example.com",
        refCode: "REF_DIR",
        referredBy: null,
        referralCount: 1,
        basePosition: 1,
        currentPosition: 1,
      },
      {
        waitlistId: waitlist._id,
        email: "referred@example.com",
        refCode: "REF_REF",
        referredBy: "REF_DIR",
        referralCount: 0,
        basePosition: 2,
        currentPosition: 2,
      },
    ]);

    const res = await request(app)
      .get(`/api/waitlists/${waitlist._id}/funnel`)
      .set("Authorization", `Bearer ${token1}`);

    expect(res.status).toBe(200);
    expect(res.body.totalPageViews).toBe(4);
    expect(res.body.totalSignups).toBe(2);
    expect(res.body.conversionRate).toBe(50); // 2/4 = 50%
    expect(res.body.directSignups).toBe(1);
    expect(res.body.referredSignups).toBe(1);
    expect(res.body.topReferrers).toHaveLength(1);
    expect(res.body.topReferrers[0].email).toBe("direct@example.com");
  });

  it("handles zero page views without dividing by zero or throwing NaN", async () => {
    const res = await request(app)
      .get(`/api/waitlists/${waitlist._id}/funnel`)
      .set("Authorization", `Bearer ${token1}`);

    expect(res.status).toBe(200);
    expect(res.body.totalPageViews).toBe(0);
    expect(res.body.totalSignups).toBe(0);
    expect(res.body.conversionRate).toBe(0);
    expect(res.body.directSignups).toBe(0);
    expect(res.body.referredSignups).toBe(0);
    expect(res.body.topReferrers).toEqual([]);
  });

  it("handles zero signups with positive page views gracefully", async () => {
    await PageView.create([
      { waitlistId: waitlist._id, visitorId: "vis_1" },
      { waitlistId: waitlist._id, visitorId: "vis_2" },
    ]);

    const res = await request(app)
      .get(`/api/waitlists/${waitlist._id}/funnel`)
      .set("Authorization", `Bearer ${token1}`);

    expect(res.status).toBe(200);
    expect(res.body.totalPageViews).toBe(2);
    expect(res.body.totalSignups).toBe(0);
    expect(res.body.conversionRate).toBe(0);
    expect(res.body.directSignups).toBe(0);
    expect(res.body.referredSignups).toBe(0);
  });

  it("returns 404 when requesting funnel stats for an unowned waitlist", async () => {
    const res = await request(app)
      .get(`/api/waitlists/${waitlist._id}/funnel`)
      .set("Authorization", `Bearer ${token2}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "Waitlist not found");
  });
});
