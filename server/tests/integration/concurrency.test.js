const request = require("supertest");
const app = require("../../index");
const Founder = require("../../models/Founder");
const Signup = require("../../models/Signup");
const Waitlist = require("../../models/Waitlist");
const generateToken = require("../../utils/generateToken");
const { rankedSignups } = require("../../services/ranking");
const { connectDb, closeDb, clearDb } = require("../setupDb");
jest.mock("../../utils/sendEmail", () => jest.fn().mockResolvedValue(true));

describe("Concurrent referral queue", () => {
  let waitlist;
  let token;
  beforeAll(connectDb, 30000);
  afterAll(closeDb);
  beforeEach(async () => {
    await clearDb();
    const founder = await Founder.create({ email: "queue@example.com" });
    token = generateToken(founder._id);
    waitlist = await Waitlist.create({ founderId: founder._id, name: "Queue", slug: "queue" });
  });
  const join = (email, ref) => request(app).post("/api/w/queue/signup").send({ email, ref });

  it("allocates unique increasing sequences under concurrent joins", async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => join(`user${i}@example.com`)));
    expect(responses.every((r) => r.status === 201)).toBe(true);
    const rows = await Signup.find({ waitlistId: waitlist._id }).sort({ basePosition: 1 });
    expect(rows.map((r) => r.basePosition)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  }, 30000);

  it("credits every simultaneous referral and deduplicates concurrent retries", async () => {
    const original = await join("referrer@example.com");
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => join(`friend${i}@example.com`, original.body.refCode)));
    expect(responses.every((r) => r.status === 201)).toBe(true);
    const retries = await Promise.all(Array.from({ length: 5 }, () => join("retry@example.com", original.body.refCode)));
    expect(retries.filter((r) => r.status === 201)).toHaveLength(1);
    expect(retries.filter((r) => r.status === 202)).toHaveLength(4);
    const referrer = await Signup.findOne({ refCode: original.body.refCode });
    expect(referrer.referralCount).toBe(9);
    expect(await Signup.countDocuments({ waitlistId: waitlist._id })).toBe(10);
  }, 30000);

  it("derives contiguous ranks with deterministic tie breaking", async () => {
    await Signup.create([
      { waitlistId: waitlist._id, email: "first@example.com", refCode: "FIRST", basePosition: 1, currentPosition: 1 },
      { waitlistId: waitlist._id, email: "second@example.com", refCode: "SECOND", basePosition: 6, currentPosition: 1, referralCount: 1 },
      { waitlistId: waitlist._id, email: "third@example.com", refCode: "THIRD", basePosition: 7, currentPosition: 1, referralCount: 3 },
    ]);
    const ranked = await rankedSignups(waitlist._id);
    expect(ranked.map((r) => r.refCode)).toEqual(["THIRD", "FIRST", "SECOND"]);
    expect(ranked.map((r) => r.currentPosition)).toEqual([1, 2, 3]);
  });

  it("moves a subscriber and shifts neighbouring displayed ranks", async () => {
    await join("first@example.com");
    await join("second@example.com");
    await join("third@example.com");
    const third = await Signup.findOne({ email: "third@example.com" });
    const result = await request(app).patch(`/api/waitlists/${waitlist._id}/signups/${third._id}/position`)
      .set("Authorization", `Bearer ${token}`).send({ currentPosition: 1 });
    expect(result.status).toBe(200);
    const ranked = await rankedSignups(waitlist._id);
    expect(ranked.map((r) => r.email)).toEqual(["third@example.com", "first@example.com", "second@example.com"]);
    expect(ranked.map((r) => r.currentPosition)).toEqual([1, 2, 3]);
  });

  it("rolls back signup allocation when referral persistence fails", async () => {
    const original = await join("referrer@example.com");
    const failure = jest.spyOn(Signup, "updateOne").mockRejectedValueOnce(new Error("Simulated write failure"));
    const result = await join("friend@example.com", original.body.refCode);
    failure.mockRestore();
    expect(result.status).toBe(500);
    expect(await Signup.countDocuments({ waitlistId: waitlist._id })).toBe(1);
    expect((await Waitlist.findById(waitlist._id)).signupSequence).toBe(1);
    expect((await Signup.findOne({ refCode: original.body.refCode })).referralCount).toBe(0);
  });
});
