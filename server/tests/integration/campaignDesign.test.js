jest.mock("../../services/campaignDesign", () => ({ ...jest.requireActual("../../services/campaignDesign"), generateDesign: jest.fn() }));
const request = require("supertest");
const app = require("../../index");
const Founder = require("../../models/Founder");
const Waitlist = require("../../models/Waitlist");
const Usage = require("../../models/AIGenerationUsage");
const generateToken = require("../../utils/generateToken");
const { generateDesign } = require("../../services/campaignDesign");
const { connectDb, closeDb, clearDb } = require("../setupDb");
const draft = require("../fixtures/campaignDesign");
const input = { name: "Maker Studio", description: "A focused workspace", preferences: { brief: "Editorial design in olive and cream" } };
describe("Founder campaign design and publishing", () => {
  let token, otherToken, original;
  beforeAll(connectDb); afterAll(closeDb);
  beforeEach(async () => {
    await clearDb(); original = { ...process.env }; process.env.GEMINI_API_KEY = "synthetic-key"; process.env.AI_DAILY_LIMIT = "20";
    generateDesign.mockReset().mockResolvedValue(draft);
    const founder = await Founder.create({ email: "designer@example.com", plan: "pro" });
    const other = await Founder.create({ email: "other@example.com", plan: "pro" });
    token = generateToken(founder._id); otherToken = generateToken(other._id);
  });
  afterEach(() => { process.env = original; });
  const generate = () => request(app).post("/api/waitlists/design").set("Authorization", `Bearer ${token}`).send(input);
  it("requires founder authentication before calling AI", async () => {
    expect((await request(app).post("/api/waitlists/design").send(input)).status).toBe(401);
    expect(generateDesign).not.toHaveBeenCalled();
  });
  it("generates a draft without creating or modifying a public campaign", async () => {
    const res = await generate(); expect(res.status).toBe(200); expect(res.body.design).toEqual(draft);
    expect(await Waitlist.countDocuments()).toBe(0);
  });
  it("publishes a design on creation and exposes only public fields", async () => {
    const created = await request(app).post("/api/waitlists").set("Authorization", `Bearer ${token}`).send({ name: "Maker Studio", ...draft });
    expect(created.status).toBe(201);
    const page = await request(app).get(`/api/w/${created.body.waitlist.slug}`);
    expect(page.body.pageDesign).toEqual(draft.pageDesign); expect(page.body.accentColor).toBe(draft.accentColor);
    expect(page.body).not.toHaveProperty("founderId"); expect(page.body).not.toHaveProperty("GEMINI_API_KEY");
    const denied = await request(app).patch(`/api/waitlists/${created.body.waitlist._id}`).set("Authorization", `Bearer ${otherToken}`).send({ pageDesign: { ...draft.pageDesign, layout: "split" } });
    expect(denied.status).toBe(404);
    const updated = await request(app).patch(`/api/waitlists/${created.body.waitlist._id}`).set("Authorization", `Bearer ${token}`).send({ pageDesign: { ...draft.pageDesign, layout: "split" } });
    expect(updated.body.waitlist.pageDesign.layout).toBe("split");
  });
  it("rejects invalid image URLs and arbitrary executable design fields", async () => {
    for (const body of [{ heroImageUrl: "javascript:alert(1)" }, { pageDesign: { ...draft.pageDesign, html: "<script>bad()</script>" } }]) {
      expect((await request(app).post("/api/waitlists").set("Authorization", `Bearer ${token}`).send({ name: "Invalid", ...body })).status).toBe(400);
    }
    expect(await Waitlist.countDocuments()).toBe(0);
  });
  it("rejects invalid briefs before consuming an allowance", async () => {
    expect((await request(app).post("/api/waitlists/design").set("Authorization", `Bearer ${token}`).send({ ...input, preferences: { brief: "short" } })).status).toBe(400);
    expect(await Usage.countDocuments()).toBe(0);
  });
  it("keeps manual publishing available when AI is unconfigured", async () => {
    delete process.env.GEMINI_API_KEY;
    expect((await generate()).status).toBe(503); expect(generateDesign).not.toHaveBeenCalled();
    expect((await request(app).post("/api/waitlists").set("Authorization", `Bearer ${token}`).send({ name: "Manual", ...draft })).status).toBe(201);
  });
  it("enforces the daily founder limit under simultaneous requests", async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, generate));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(5);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(1);
    expect(generateDesign).toHaveBeenCalledTimes(5);
    expect((await Usage.findById(`global:${new Date().toISOString().slice(0, 10)}`)).count).toBe(5);
  });
  it("enforces the shared API-key daily allowance", async () => {
    process.env.AI_DAILY_LIMIT = "1";
    expect((await generate()).status).toBe(200);
    expect((await request(app).post("/api/waitlists/design").set("Authorization", `Bearer ${otherToken}`).send(input)).status).toBe(429);
    expect(generateDesign).toHaveBeenCalledTimes(1);
  });
});
