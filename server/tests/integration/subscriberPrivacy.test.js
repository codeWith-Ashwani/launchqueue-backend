const request = require("supertest");
const app = require("../../index");
const Founder = require("../../models/Founder");
const Waitlist = require("../../models/Waitlist");
const sendEmail = require("../../utils/sendEmail");
const { issueSubscriberToken } = require("../../utils/subscriberToken");
const Signup = require("../../models/Signup");
const { connectDb, closeDb, clearDb } = require("../setupDb");
jest.mock("../../utils/sendEmail", () => jest.fn().mockResolvedValue(true));

describe("Private subscriber status", () => {
  let signup;
  beforeAll(connectDb, 30000);
  afterAll(closeDb);
  beforeEach(async () => {
    await clearDb();
    jest.clearAllMocks();
    const owner = await Founder.create({ email: "owner@example.com" });
    await Waitlist.create({ founderId: owner._id, name: "Private", slug: "private" });
    signup = (await request(app).post("/api/w/private/signup").send({ email: "subscriber@example.com" })).body;
  });

  it("rejects public referral codes and email lookups", async () => {
    for (const query of [{ ref: signup.refCode }, { email: "subscriber@example.com" }]) {
      const response = await request(app).get("/api/w/private/position").query(query);
      expect(response.status).toBe(401);
      expect(response.body.email).toBeUndefined();
    }
  });

  it("returns status with a valid private token and rejects wrong campaign scope", async () => {
    const response = await request(app).get("/api/w/private/position").set("X-Subscriber-Token", signup.statusToken);
    expect(response.status).toBe(200);
    expect(response.body.email).toBe("subscriber@example.com");
    const wrongScope = await request(app).get("/api/w/another/position").set("X-Subscriber-Token", signup.statusToken);
    expect(wrongScope.status).toBe(401);
  });

  it("does not disclose status or a private token on repeat signup", async () => {
    const response = await request(app).post("/api/w/private/signup").send({ email: "subscriber@example.com" });
    expect(response.status).toBe(202);
    expect(response.body.statusLinkSent).toBe(true);
    for (const field of ["email", "refCode", "position", "statusToken"]) expect(response.body[field]).toBeUndefined();
  });

  it("uses the same recovery response for known and unknown addresses", async () => {
    const known = await request(app).post("/api/w/private/status-link").send({ email: "subscriber@example.com" });
    const unknown = await request(app).post("/api/w/private/status-link").send({ email: "unknown@example.com" });
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "subscriber@example.com", html: expect.stringContaining("#status=") }));
  });

  it("rejects altered tokens and tokens for a deleted signup", async () => {
    const invalid = await request(app).get("/api/w/private/position").set("X-Subscriber-Token", signup.statusToken.slice(0, -8) + "tampered");
    expect(invalid.status).toBe(401);
    const record = await Signup.findOne({ email: "subscriber@example.com" });
    const token = issueSubscriberToken(record);
    await record.deleteOne();
    const deleted = await request(app).get("/api/w/private/position").set("X-Subscriber-Token", token);
    expect(deleted.status).toBe(401);
  });
});
