const request = require("supertest");
const app = require("../../index");
const Founder = require("../../models/Founder");
const Waitlist = require("../../models/Waitlist");
const Signup = require("../../models/Signup");
const generateToken = require("../../utils/generateToken");
const { connectDb, clearDb, closeDb } = require("../setupDb");
jest.mock("../../utils/sendEmail", () => jest.fn().mockResolvedValue(true));
describe("Server plan entitlements", () => {
  let owner; let waitlist; let token;
  beforeAll(connectDb, 30000); afterAll(closeDb);
  beforeEach(async () => {
    await clearDb(); owner = await Founder.create({ email: "quota@example.com" }); token = generateToken(owner._id);
    waitlist = await Waitlist.create({ founderId: owner._id, name: "Quota", slug: "quota" });
  });
  it("enforces free campaign capacity under concurrent creation", async () => {
    await Waitlist.deleteMany({});
    const replies = await Promise.all(Array.from({ length: 4 }, (_, i) => request(app).post("/api/waitlists")
      .set("Authorization", `Bearer ${token}`).send({ name: `Campaign ${i}` })));
    expect(replies.filter((r) => r.status === 201)).toHaveLength(1);
    expect(replies.filter((r) => r.status === 403 && r.body.upgradeRequired)).toHaveLength(3);
    expect(await Waitlist.countDocuments({ founderId: owner._id })).toBe(1);
  });
  it("gates the actual CSV route and preserves ownership checks", async () => {
    const url = `/api/waitlists/${waitlist._id}/export`;
    expect((await request(app).get(url).set("Authorization", `Bearer ${token}`)).status).toBe(403);
    await Founder.updateOne({ _id: owner._id }, { $set: { plan: "starter" } });
    expect((await request(app).get(url).set("Authorization", `Bearer ${token}`)).status).toBe(200);
    await Founder.updateOne({ _id: owner._id }, { $set: { subscriptionStatus: "cancelled", subscriptionEndsAt: new Date(Date.now() - 1000) } });
    expect((await request(app).get(url).set("Authorization", `Bearer ${token}`)).status).toBe(403);
  });
  it("bounds campaign signups atomically, including pending records", async () => {
    await Signup.insertMany(Array.from({ length: 498 }, (_, i) => ({ waitlistId: waitlist._id, email: `seed${i}@example.com`, refCode: `SEED${i}`, basePosition: i + 1, currentPosition: i + 1 })));
    const replies = await Promise.all(Array.from({ length: 5 }, (_, i) => request(app).post("/api/w/quota/signup").send({ email: `new${i}@example.com` })));
    expect(replies.filter((r) => r.status === 202)).toHaveLength(2);
    expect(replies.filter((r) => r.status === 403)).toHaveLength(3);
    expect(await Signup.countDocuments({ waitlistId: waitlist._id })).toBe(500);
  }, 30000);
});
