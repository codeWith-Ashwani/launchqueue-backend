const request = require("supertest");
const app = require("../../index");
const Founder = require("../../models/Founder");
const Waitlist = require("../../models/Waitlist");
const Signup = require("../../models/Signup");
const AdminAudit = require("../../models/AdminAudit");
const tokenFor = require("../../utils/generateToken");
const { connectDb, closeDb, clearDb } = require("../setupDb");
describe("Product discovery and platform administration", () => {
  let admin, founder, product, adminToken, founderToken;
  const previousIds = process.env.ADMIN_FOUNDER_IDS;
  beforeAll(connectDb);
  afterAll(async () => { if (previousIds === undefined) delete process.env.ADMIN_FOUNDER_IDS; else process.env.ADMIN_FOUNDER_IDS = previousIds; await closeDb(); });
  beforeEach(async () => {
    await clearDb();
    admin = await Founder.create({ email: "admin@example.com", name: "Admin", password: "private hash", adminApproved: true });
    founder = await Founder.create({ email: "founder@example.com", name: "Founder", resetPasswordTokenHash: "private-reset", customerPortalUrl: "https://private.example.com", plan: "pro" });
    // The old environment allowlist must not bypass database approval.
    process.env.ADMIN_FOUNDER_IDS = String(founder._id);
    adminToken = tokenFor(admin._id); founderToken = tokenFor(founder._id);
    product = await Waitlist.create({ founderId: founder._id, name: "Listed product", slug: "listed-product", discoverable: true });
    await Signup.create({ waitlistId: product._id, email: "private-subscriber@example.com", refCode: "private-ref", basePosition: 1, currentPosition: 1, verificationState: "verified", verifiedAt: new Date() });
  });
  it.each(["overview", "founders", "campaigns", "subscribers"])("protects the admin %s endpoint from anonymous and ordinary founders", async (path) => {
    expect((await request(app).get(`/api/admin/${path}`)).status).toBe(401);
    expect((await request(app).get(`/api/admin/${path}`).set("Authorization", `Bearer ${founderToken}`)).status).toBe(403);
    expect((await request(app).get(`/api/admin/${path}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
  });
  it("does not allow an editable email or profile payload to grant admin access", async () => {
    const res = await request(app).patch("/api/auth/profile").set("Authorization", `Bearer ${founderToken}`).send({ email: "owner@example.com", isAdmin: true, role: "admin", adminApproved: true });
    expect(res.status).toBe(200); expect(res.body.founder.isAdmin).toBe(false);
    expect((await Founder.findById(founder._id)).adminApproved).toBe(false);
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${adminToken}`);
    expect(me.body.founder.isAdmin).toBe(true); expect(JSON.stringify(me.body)).not.toMatch(/private hash/);
  });
  it("requires explicit database approval at signup and honors approval and revocation with the same session", async () => {
    const signup = await request(app).post("/api/auth/register").send({ email: "new-admin@example.com", password: "StrongPassword123!", adminApproved: true, isAdmin: true });
    expect(signup.status).toBe(201);
    expect(signup.body.founder.isAdmin).toBe(false);
    expect((await Founder.findOne({ email: "new-admin@example.com" })).adminApproved).toBe(false);
    const access = () => request(app).get("/api/admin/overview").set("Authorization", `Bearer ${founderToken}`);
    expect((await access()).status).toBe(403);
    await Founder.updateOne({ _id: founder._id }, { $set: { adminApproved: true } });
    expect((await access()).status).toBe(200);
    await Founder.updateOne({ _id: founder._id }, { $set: { adminApproved: false } });
    expect((await access()).status).toBe(403);
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${founderToken}`)).body.founder.isAdmin).toBe(false);
  });
  it("excludes pending joins, opted-out, paused, hidden, and ownerless campaigns from discovery", async () => {
    await Signup.create({ waitlistId: product._id, email: "pending@example.com", refCode: "pending-ref", basePosition: 2, currentPosition: 2, verificationState: "pending" });
    await Waitlist.create([
      { founderId: founder._id, name: "Private", slug: "private" },
      { founderId: founder._id, name: "Paused", slug: "paused", discoverable: true, paused: true },
      { founderId: founder._id, name: "Hidden", slug: "hidden", discoverable: true, discoveryHidden: true },
      { founderId: "111111111111111111111111", name: "Orphan", slug: "orphan", discoverable: true },
    ]);
    const res = await request(app).get("/api/discover/leaderboard");
    expect(res.status).toBe(200); expect(res.body.products).toHaveLength(1);
    expect(res.body.products[0]).toMatchObject({ slug: "listed-product", members: 1, weeklyMembers: 1, rank: 1 });
    expect(JSON.stringify(res.body)).not.toMatch(/private-subscriber|private-ref|founderId|founder@example/);
  });
  it("ranks by verified activity in the selected period with deterministic ties", async () => {
    const other = await Waitlist.create({ founderId: founder._id, name: "Earlier", slug: "earlier", discoverable: true });
    const old = new Date(Date.now() - 30 * 86400000);
    await Signup.create([1, 2].map((i) => ({ waitlistId: other._id, email: `old${i}@example.com`, refCode: `OLD${i}`, basePosition: i, currentPosition: i, verificationState: "verified", verifiedAt: old, createdAt: old })));
    expect((await request(app).get("/api/discover/leaderboard?period=week")).body.products[0].slug).toBe("listed-product");
    expect((await request(app).get("/api/discover/leaderboard?period=all")).body.products[0].slug).toBe("earlier");
    expect((await request(app).get("/api/discover/leaderboard?limit=1000")).status).toBe(400);
  });
  it("only returns scoped subscriber details to an admin and omits tokens and password hashes", async () => {
    const res = await request(app).get(`/api/admin/subscribers?waitlistId=${product._id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.items[0].email).toBe("private-subscriber@example.com");
    expect(res.body.items[0].waitlistId.name).toBe(product.name);
    const people = await request(app).get("/api/admin/founders").set("Authorization", `Bearer ${adminToken}`);
    expect(JSON.stringify(people.body)).not.toMatch(/private-reset|private hash|customerPortalUrl|googleId|sessionVersion/);
    expect((await request(app).get("/api/admin/founders?search=%5B").set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).get("/api/admin/subscribers?waitlistId=bad").set("Authorization", `Bearer ${adminToken}`)).status).toBe(400);
  });
  it("paginates without leaking campaigns owned by unrelated founders in the profile overview", async () => {
    await Waitlist.create({ founderId: admin._id, name: "Admin campaign", slug: "admin-campaign" });
    const res = await request(app).get("/api/auth/overview").set("Authorization", `Bearer ${founderToken}`);
    expect(res.body.campaigns).toHaveLength(1); expect(res.body.usage).toEqual({ campaigns: 1, signups: 1, confirmed: 1 });
    expect(res.body.limits).toEqual({ campaigns: 10, signups: 25000 });
    const people = await request(app).get("/api/admin/founders?limit=1&page=2").set("Authorization", `Bearer ${adminToken}`);
    expect(people.body.items).toHaveLength(1); expect(people.body.pagination).toMatchObject({ total: 2, pages: 2, page: 2 });
  });
  it("audits admin moderation and prevents a founder bypassing the hidden state", async () => {
    const path = `/api/admin/campaigns/${product._id}/discovery`;
    expect((await request(app).patch(path).set("Authorization", `Bearer ${founderToken}`).send({ discoveryHidden: true })).status).toBe(403);
    expect((await request(app).patch(path).set("Authorization", `Bearer ${adminToken}`).send({ discoveryHidden: true })).status).toBe(200);
    expect(await AdminAudit.countDocuments({ actorId: admin._id, action: "hide-discovery" })).toBe(1);
    await request(app).patch(`/api/waitlists/${product._id}`).set("Authorization", `Bearer ${founderToken}`).send({ discoverable: true, discoveryHidden: false });
    expect((await request(app).get("/api/discover/leaderboard")).body.products).toHaveLength(0);
    expect((await request(app).patch(path).set("Authorization", `Bearer ${adminToken}`).send({ discoveryHidden: false })).status).toBe(200);
    expect((await request(app).get("/api/discover/leaderboard")).body.products).toHaveLength(1);
  });
  it("lets founders explicitly opt their own campaign into or out of discovery", async () => {
    const path = `/api/waitlists/${product._id}`;
    expect((await request(app).patch(path).set("Authorization", `Bearer ${adminToken}`).send({ discoverable: false })).status).toBe(404);
    expect((await request(app).patch(path).set("Authorization", `Bearer ${founderToken}`).send({ discoverable: false })).status).toBe(200);
    expect((await request(app).get("/api/discover/leaderboard")).body.products).toHaveLength(0);
  });
  it("provides only the public Google client ID and no private credentials in auth config", async () => {
    const original = process.env.GOOGLE_CLIENT_ID;
    try {
      process.env.GOOGLE_CLIENT_ID = "public-test.apps.googleusercontent.com";
      expect((await request(app).get("/api/auth/config")).body).toEqual({ googleClientId: "public-test.apps.googleusercontent.com" });
      delete process.env.GOOGLE_CLIENT_ID;
      expect((await request(app).post("/api/auth/google").send({ credential: "token" })).status).toBe(503);
    } finally { if (original === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = original; }
  });
});
