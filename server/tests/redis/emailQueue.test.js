const crypto = require("crypto");
require("../../index");
const { Queue, Worker } = require("bullmq");
const { createRedis } = require("../../config/redis");
const { recordEmail, dispatchPending, deliverEmail } = require("../../services/emailOutbox");
const Outbox = require("../../models/EmailOutbox");
const sendEmail = require("../../utils/sendEmail");
const { connectDb, closeDb, clearDb } = require("../setupDb");
jest.mock("../../utils/sendEmail", () => jest.fn());
const suite = process.env.TEST_REDIS_URL ? describe : describe.skip;
suite("Real Redis email delivery", () => {
  let connection; let queue; let worker;
  const queueName = `lq-email-test-${crypto.randomUUID()}`;
  beforeAll(async () => {
    await connectDb();
    connection = createRedis("worker", process.env.TEST_REDIS_URL);
    await connection.connect();
    queue = new Queue(queueName, { connection });
  }, 30000);
  beforeEach(async () => { await clearDb(); sendEmail.mockReset(); });
  afterEach(async () => { if (worker) { await worker.close(); worker = null; } await queue.obliterate({ force: true }); });
  afterAll(async () => { await queue.close(); connection.disconnect(); await closeDb(); });

  it("retains queued work until a worker starts and retries transient failures", async () => {
    sendEmail.mockRejectedValueOnce(new Error("Temporary SMTP failure")).mockResolvedValue(true);
    const item = await recordEmail({ dedupeKey: "restart-retry", kind: "test", to: "test@example.com", subject: "Test", html: "Test" });
    await dispatchPending(queue);
    expect(sendEmail).not.toHaveBeenCalled();
    worker = new Worker(queueName, deliverEmail, { connection });
    const deadline = Date.now() + 15000;
    while ((await Outbox.findById(item._id)).state !== "sent") {
      if (Date.now() > deadline) throw new Error("Delivery did not recover");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect((await Outbox.findById(item._id)).attempts).toBe(2);
  });

  it("rebuilds a lost Redis job from the MongoDB outbox", async () => {
    sendEmail.mockResolvedValue(true);
    const item = await recordEmail({ dedupeKey: "recovery", kind: "test", to: "test@example.com", subject: "Test", html: "Test" });
    await dispatchPending(queue);
    const original = await queue.getJob(`${item._id}-0`);
    await original.remove();
    await Outbox.updateOne({ _id: item._id }, { $set: { nextDispatchAt: new Date(0) } });
    await dispatchPending(queue);
    expect(await queue.getJob(`${item._id}-0`)).not.toBeNull();
  });
});
