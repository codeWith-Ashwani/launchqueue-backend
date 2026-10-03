const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../../index");
const Founder = require("../../models/Founder");
const Waitlist = require("../../models/Waitlist");
const Signup = require("../../models/Signup");
const Outbox = require("../../models/EmailOutbox");
const generateToken = require("../../utils/generateToken");
const sendEmail = require("../../utils/sendEmail");
const { recordEmail, deliverEmail, dispatchPending } = require("../../services/emailOutbox");
const { connectDb, closeDb, clearDb } = require("../setupDb");
jest.mock("../../utils/sendEmail", () => jest.fn().mockResolvedValue(true));

describe("Durable email outbox", () => {
  let waitlist; let signup; let token;
  beforeAll(connectDb, 30000);
  afterAll(closeDb);
  beforeEach(async () => {
    await clearDb(); jest.clearAllMocks(); sendEmail.mockResolvedValue(true);
    const owner = await Founder.create({ email: "mail@example.com", plan: "pro" });
    token = generateToken(owner._id);
    waitlist = await Waitlist.create({ founderId: owner._id, name: "Mail", slug: "mail" });
    signup = await Signup.create({ waitlistId: waitlist._id, email: "subscriber@example.com", refCode: "MAIL", basePosition: 1, currentPosition: 1 });
    process.env.EMAIL_DELIVERY_MODE = "queue";
  });
  afterEach(() => { delete process.env.EMAIL_DELIVERY_MODE; });
  const invite = () => request(app).post(`/api/waitlists/${waitlist._id}/signups/batch-invite`)
    .set("Authorization", `Bearer ${token}`).send({ signupIds: [signup._id.toString()] });

  it("queues invitations without marking subscribers invited before delivery", async () => {
    const response = await invite();
    expect(response.body).toEqual({ invitedCount: 0, queuedCount: 1, failedCount: 0 });
    expect((await Signup.findById(signup._id)).status).toBe("waiting");
    expect(sendEmail).not.toHaveBeenCalled();
    const repeat = await invite();
    expect(repeat.body.queuedCount).toBe(0);
    expect(await Outbox.countDocuments()).toBe(1);
  });

  it("records a receipt, updates invitation state, and skips completed replays", async () => {
    await invite(); const item = await Outbox.findOne();
    const job = { data: { outboxId: item._id.toString(), generation: 0 }, opts: { attempts: 5 }, attemptsMade: 0 };
    await deliverEmail(job); await deliverEmail(job);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((await Outbox.findById(item._id)).state).toBe("sent");
    expect((await Signup.findById(signup._id)).status).toBe("invited");
  });

  it("tracks final failures and allows an explicit invitation retry", async () => {
    await invite(); const item = await Outbox.findOne();
    sendEmail.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(deliverEmail({ data: { outboxId: item._id.toString() }, opts: { attempts: 1 } })).rejects.toThrow();
    expect((await Signup.findById(signup._id)).invitationState).toBe("failed");
    expect((await Signup.findById(signup._id)).status).toBe("waiting");
    expect((await invite()).body.queuedCount).toBe(1);
    expect((await Outbox.findById(item._id)).generation).toBe(1);
    await deliverEmail({ data: { outboxId: item._id.toString(), generation: 1 }, opts: { attempts: 5 } });
    expect((await Signup.findById(signup._id)).status).toBe("invited");
  });

  it("retains the outbox when Redis is unavailable", async () => {
    await invite();
    await dispatchPending({ getJob: jest.fn().mockRejectedValue(new Error("Redis unavailable")) });
    expect((await Outbox.findOne()).state).toBe("pending");
    expect((await Signup.findById(signup._id)).status).toBe("waiting");
  });

  it("reports an inline provider failure without claiming delivery or queueing", async () => {
    process.env.EMAIL_DELIVERY_MODE = "inline";
    sendEmail.mockRejectedValueOnce(new Error("Provider unavailable"));
    expect((await invite()).body).toEqual({ invitedCount: 0, queuedCount: 0, failedCount: 1 });
    expect((await Signup.findById(signup._id)).invitationState).toBe("failed");
  });

  it("stores encrypted payloads and rolls them back with the business transaction", async () => {
    await invite();
    const stored = await Outbox.findOne().select("+encryptedPayload");
    expect(stored.encryptedPayload).not.toContain("subscriber@example.com");
    await expect(mongoose.connection.transaction(async (session) => {
      await recordEmail({ dedupeKey: "rolled-back", kind: "test", to: "secret@example.com", subject: "Private", html: "secret-token" }, session);
      throw new Error("Rollback");
    })).rejects.toThrow("Rollback");
    expect(await Outbox.exists({ dedupeKey: "rolled-back" })).toBeNull();
  });
});
