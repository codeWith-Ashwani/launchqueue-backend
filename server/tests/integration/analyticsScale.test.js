const request = require("supertest");
const app = require("../../index");
const Founder = require("../../models/Founder");
const Waitlist = require("../../models/Waitlist");
const Signup = require("../../models/Signup");
const PageView = require("../../models/PageView");
const generateToken = require("../../utils/generateToken");
const { connectDb, clearDb, closeDb } = require("../setupDb");
describe("Bounded analytics and export", () => {
  let owner; let waitlist; let token;
  beforeAll(connectDb, 30000); afterAll(closeDb);
  beforeEach(async () => {
    await clearDb(); owner = await Founder.create({ email: "scale@example.com", plan: "pro" }); token = generateToken(owner._id);
    waitlist = await Waitlist.create({ founderId: owner._id, name: "Scale", slug: "scale" });
  });
  const stats = (query = {}) => request(app).get(`/api/waitlists/${waitlist._id}/stats`).query(query).set("Authorization", `Bearer ${token}`);
  it("returns bounded pages with continuous ranks and rejects invalid pagination", async () => {
    await Signup.insertMany(Array.from({ length: 123 }, (_, i) => ({ waitlistId: waitlist._id, email: `user${i}@example.com`, refCode: `CODE${i}`, basePosition: i + 1, currentPosition: i + 1 })));
    const first = await stats(); const second = await stats({ page: 2, limit: 50 }); const last = await stats({ page: 3, limit: 50 });
    expect(first.body.signups).toHaveLength(50); expect(second.body.signups[0].currentPosition).toBe(51);
    expect(last.body.signups).toHaveLength(23);
    expect(last.body.pagination).toEqual({ page: 3, limit: 50, total: 123, totalPages: 3 });
    for (const query of [{ page: -1 }, { limit: 1001 }, { page: "invalid" }]) expect((await stats(query)).status).toBe(400);
    expect(first.body.chartData).toHaveLength(30); expect(first.body.timezone).toBe("UTC");
    expect(first.body.totalVisitors).toBe(0); expect(first.body.conversionRate).toBe(0);
  });
  it("deduplicates concurrent visitor events atomically and measures unique visitors", async () => {
    const responses = await Promise.all(Array.from({ length: 10 }, () => request(app).post("/api/w/scale/visit").send({ visitorId: "visitor-1" })));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(await PageView.countDocuments()).toBe(1);
    await PageView.create({ waitlistId: waitlist._id, visitorId: "visitor-1", createdAt: new Date(Date.now() - 3600000) });
    const result = await stats(); expect(result.body.totalVisitors).toBe(1);
  });
  it("includes older referrers whose credited signups occur within the requested range", async () => {
    await Signup.create([
      { waitlistId: waitlist._id, email: "old@example.com", refCode: "OLD", basePosition: 1, currentPosition: 1, referralCount: 2, createdAt: new Date(Date.now() - 20 * 86400000) },
      { waitlistId: waitlist._id, email: "new@example.com", refCode: "NEW", referredBy: "OLD", basePosition: 2, currentPosition: 2 },
      { waitlistId: waitlist._id, email: "older@example.com", refCode: "OLDER", referredBy: "OLD", basePosition: 3, currentPosition: 3, createdAt: new Date(Date.now() - 20 * 86400000) },
    ]);
    const result = await request(app).get(`/api/waitlists/${waitlist._id}/funnel?days=2`).set("Authorization", `Bearer ${token}`);
    expect(result.body.totalSignups).toBe(1); expect(result.body.topReferrers[0].email).toBe("old@example.com");
    expect(result.body.topReferrers[0].referralCount).toBe(1);
  });
  it("neutralizes spreadsheet formulas in exported subscriber fields", async () => {
    await Signup.create({ waitlistId: waitlist._id, email: "=formula@example.com", refCode: "FORMULA", referredBy: "+SUM(1,2)", basePosition: 1, currentPosition: 1 });
    const result = await request(app).get(`/api/waitlists/${waitlist._id}/export`).set("Authorization", `Bearer ${token}`);
    expect(result.status).toBe(200); expect(result.text).toContain("'=formula@example.com");
    expect(result.text).toContain('"\'+SUM(1,2)"');
  });
});
