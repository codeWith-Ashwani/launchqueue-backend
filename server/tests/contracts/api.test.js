const request = require("supertest");
const app = require("../../index");
const Founder = require("../../models/Founder");
const Waitlist = require("../../models/Waitlist");
const Signup = require("../../models/Signup");
const token = require("../../utils/generateToken");
const { issueVerificationToken } = require("../../utils/verificationToken");
const { assertResponse } = require("./responseContract");
const { connectDb, closeDb, clearDb } = require("../setupDb");
jest.mock("../../utils/sendEmail", () => jest.fn().mockResolvedValue(true));
let owner, campaign, authorization;
beforeAll(connectDb); afterAll(closeDb);
beforeEach(async () => {
  await clearDb(); owner = await Founder.create({ email: "contract@example.com", plan: "pro", adminApproved: true });
  campaign = await Waitlist.create({ founderId: owner._id, name: "Contract", slug: "contract", discoverable: true }); authorization = `Bearer ${token(owner._id)}`;
  await Signup.insertMany([{ waitlistId: campaign._id, email: "leader@example.com", refCode: "LEADER", basePosition: 1, currentPosition: 1, referralCount: 1, verificationState: "verified" },
    { waitlistId: campaign._id, email: "referral@example.com", refCode: "REFERRAL", referredBy: "LEADER", basePosition: 2, currentPosition: 2, verificationState: "verified" }]);
});
it.each(["/api/auth/config", "/api/auth/me", "/api/auth/overview", "/api/waitlists", "/api/discover/leaderboard", "/api/admin/overview", "/api/admin/founders", "/api/admin/campaigns", "/api/admin/subscribers", "/api/admin/diagnostics", "/api/admin/monitoring", "/api/admin/traces"])("validates %s against the declared response", async (path) => {
  const res = await request(app).get(path).set("Authorization", authorization); expect(res.status).toBe(200); assertResponse("get", path, res);
});
it.each(["", "/stats", "/funnel", "/export"])("validates paginated analytics and campaign responses %s", async (suffix) => {
  const res = await request(app).get(`/api/waitlists/${campaign._id}${suffix}`).set("Authorization", authorization);
  expect(res.status).toBe(200); assertResponse("get", `/api/waitlists/{id}${suffix}`, res);
});
it.each(["", "/leaderboard", "/activity"])("validates public privacy contracts %s", async (suffix) => {
  const res = await request(app).get(`/api/w/contract${suffix}`); expect(res.status).toBe(200); assertResponse("get", `/api/w/{slug}${suffix}`, res);
});
it("validates the signup, verification and private-status lifecycle with accepted status codes", async () => {
  const joined = await request(app).post("/api/w/contract/signup").send({ email: "new@example.com" });
  expect(joined.status).toBe(202); assertResponse("post", "/api/w/{slug}/signup", joined);
  const signup = await Signup.findOne({ email: "new@example.com" });
  const verified = await request(app).post("/api/w/contract/verify").send({ token: issueVerificationToken(signup) });
  expect(verified.status).toBe(200); assertResponse("post", "/api/w/{slug}/verify", verified);
  const status = await request(app).get("/api/w/contract/position").set("X-Subscriber-Token", verified.body.statusToken);
  assertResponse("get", "/api/w/{slug}/position", status);
  const link = await request(app).post("/api/w/contract/status-link").send({ email: "new@example.com" });
  expect(link.status).toBe(202); assertResponse("post", "/api/w/{slug}/status-link", link);
});
it("validates account creation and founder mutations", async () => {
  const registered = await request(app).post("/api/auth/register").send({ email: "registered@example.com", password: "Password123!" });
  expect(registered.status).toBe(201); assertResponse("post", "/api/auth/register", registered);
  const loggedIn = await request(app).post("/api/auth/login").send({ email: "registered@example.com", password: "Password123!" });
  assertResponse("post", "/api/auth/login", loggedIn);
  const updated = await request(app).patch("/api/auth/profile").set("Authorization", authorization).send({ name: "Updated" });
  assertResponse("patch", "/api/auth/profile", updated);
  const created = await request(app).post("/api/waitlists").set("Authorization", authorization).send({ name: "New Campaign" });
  expect(created.status).toBe(201); assertResponse("post", "/api/waitlists", created);
  const edit = await request(app).patch(`/api/waitlists/${campaign._id}`).set("Authorization", authorization).send({ paused: true });
  assertResponse("patch", "/api/waitlists/{id}", edit);
});
it("rejects response field deletion, type changes and public identity leakage", async () => {
  const stats = await request(app).get(`/api/waitlists/${campaign._id}/stats`).set("Authorization", authorization);
  const missing = structuredClone(stats.body); delete missing.pagination;
  expect(() => assertResponse("get", "/api/waitlists/{id}/stats", { ...stats, body: missing })).toThrow("Response contract failed");
  const changed = structuredClone(stats.body); changed.totalSignups = "two";
  expect(() => assertResponse("get", "/api/waitlists/{id}/stats", { ...stats, body: changed })).toThrow("Response contract failed");
  const discovery = await request(app).get("/api/discover/leaderboard"); discovery.body.products[0].founderEmail = "private@example.com";
  expect(() => assertResponse("get", "/api/discover/leaderboard", discovery)).toThrow("Response contract failed");
});
it("checks unauthorized and invalid-input error responses", async () => {
  const unauthenticated = await request(app).get("/api/auth/me"); expect(unauthenticated.status).toBe(401); assertResponse("get", "/api/auth/me", unauthenticated);
  const invalid = await request(app).post("/api/w/contract/signup").send({ email: "invalid" }); expect(invalid.status).toBe(400); assertResponse("post", "/api/w/{slug}/signup", invalid);
});
it("validates readiness and the beacon's plain-text origin rejection", async () => {
  const ready = await request(app).get("/ready"); expect(ready.status).toBe(200); assertResponse("get", "/ready", ready);
  const blocked = await request(app).post("/api/telemetry/vitals").set("Content-Type", "text/plain").send('{}');
  expect(blocked.status).toBe(403); assertResponse("post", "/api/telemetry/vitals", blocked);
});
