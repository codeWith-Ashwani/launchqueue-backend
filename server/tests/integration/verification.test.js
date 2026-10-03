const request = require("supertest");
const app = require("../../index");
const Founder = require("../../models/Founder");
const Waitlist = require("../../models/Waitlist");
const Signup = require("../../models/Signup");
const Outbox = require("../../models/EmailOutbox");
const sendEmail = require("../../utils/sendEmail");
const { issueVerificationToken } = require("../../utils/verificationToken");
const { issueSubscriberToken } = require("../../utils/subscriberToken");
const generateToken = require("../../utils/generateToken");
const { rankedSignups } = require("../../services/ranking");
const { connectDb, closeDb, clearDb } = require("../setupDb");
jest.mock("../../utils/sendEmail", () => jest.fn().mockResolvedValue(true));

describe("Subscriber email verification", () => {
  let waitlist; let owner;
  beforeAll(connectDb, 30000);
  afterAll(closeDb);
  beforeEach(async () => {
    await clearDb(); jest.clearAllMocks();
    owner = await Founder.create({ email: "owner@example.com" });
    waitlist = await Waitlist.create({ founderId: owner._id, name: "Verify", slug: "verify" });
  });
  const join = (email, ref) => request(app).post("/api/w/verify/signup").send({ email, ref });
  const verify = (token, slug = "verify") => request(app).post(`/api/w/${slug}/verify`).send({ token });

  it("sends proof only to the mailbox and returns no private identity before verification", async () => {
    const response = await join("subscriber@example.com");
    expect(response.status).toBe(202);
    expect(response.body).toEqual((await join("subscriber@example.com")).body);
    const message = sendEmail.mock.calls[0][0];
    const token = message.html.match(/#verify=([^"<]+)/)[1];
    const result = await verify(token);
    expect(result.status).toBe(200);
    expect(result.body.email).toBe("subscriber@example.com");
    expect(result.body.statusToken).toBeDefined();
    expect((await Signup.findOne()).verificationState).toBe("verified");
  });

  it("rejects wrong campaign, altered, expired and status tokens", async () => {
    await join("subscriber@example.com");
    const signup = await Signup.findOne();
    const token = issueVerificationToken(signup);
    for (const [value, slug] of [[token, "another"], [token + "x", "verify"],
      [issueVerificationToken(signup, -1), "verify"], [issueSubscriberToken(signup), "verify"]]) {
      expect((await verify(value, slug)).status).toBe(401);
    }
    expect((await Signup.findById(signup._id)).verificationState).toBe("pending");
  });

  it("prevents pending accounts from ranking, sharing credited referrals or receiving invitations", async () => {
    await join("pending@example.com");
    const pending = await Signup.findOne();
    await join("friend@example.com", pending.refCode);
    expect((await Signup.findOne({ email: "friend@example.com" })).referredBy).toBeNull();
    const legacy = await Signup.create({ waitlistId: waitlist._id, email: "legacy@example.com", refCode: "OLD", basePosition: 3, currentPosition: 3 });
    const ranked = await rankedSignups(waitlist._id);
    expect(ranked[0]._id.toString()).toBe(legacy._id.toString());
    expect(ranked[0].currentPosition).toBe(1);
    expect(ranked.slice(1).every((s) => s.currentPosition === null)).toBe(true);
    expect((await request(app).get("/api/w/verify")).body.totalSignups).toBe(1);
    expect((await request(app).get("/api/w/verify/activity")).body.activities).toHaveLength(1);
    const invite = await request(app).post(`/api/waitlists/${waitlist._id}/signups/batch-invite`)
      .set("Authorization", `Bearer ${generateToken(owner._id)}`).send({ signupIds: [pending._id.toString()] });
    expect(invite.body).toEqual({ invitedCount: 0, queuedCount: 0, failedCount: 0 });
    expect((await request(app).get("/api/w/verify/position").set("X-Subscriber-Token", issueSubscriberToken(pending))).status).toBe(401);
  });

  it("deduplicates resend requests and sends verification instead of status for pending subscribers", async () => {
    await join("pending@example.com");
    const known = await request(app).post("/api/w/verify/status-link").send({ email: "pending@example.com" });
    const unknown = await request(app).post("/api/w/verify/status-link").send({ email: "unknown@example.com" });
    expect(known.body).toEqual(unknown.body);
    expect(await Outbox.countDocuments({ kind: "verification" })).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
