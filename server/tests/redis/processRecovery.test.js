const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const mongoose = require("mongoose");
const { Queue } = require("bullmq");
const { createRedis } = require("../../config/redis");
const { recordEmail } = require("../../services/emailOutbox");
const Outbox = require("../../models/EmailOutbox");
const Signup = require("../../models/Signup");
const { connectDb, closeDb, clearDb, getDbUri } = require("../setupDb");
const suite = process.env.TEST_REDIS_URL ? describe : describe.skip;
suite("Real process crash and recovery", () => {
  let queue, connection, provider, children, accepted, submissions;
  const originalSecret = process.env.JWT_SECRET;
  const queueName = `lq-crash-${crypto.randomUUID()}`;
  beforeAll(async () => {
    process.env.JWT_SECRET = "isolated-crash-test-signing-key";
    await connectDb();
    connection = createRedis("worker", process.env.TEST_REDIS_URL); await connection.connect();
    queue = new Queue(queueName, { connection });
    provider = http.createServer((req, res) => {
      const chunks = []; req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks)); submissions++;
        accepted.set(body.deliveryKey, body.messageId);
        res.writeHead(200); res.end("{}");
      });
    });
    await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  });
  beforeEach(async () => { await clearDb(); children = []; accepted = new Map(); submissions = 0; });
  const kill = async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
  };
  afterEach(async () => { await Promise.all(children.map(kill)); await queue.obliterate({ force: true }); });
  afterAll(async () => { await queue.close(); connection.disconnect(); provider.closeAllConnections(); await new Promise((resolve) => provider.close(resolve)); await closeDb(); if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; });
  const waitUntil = async (condition) => {
    const deadline = Date.now() + 12000;
    while (!await condition()) { if (Date.now() > deadline) throw new Error("Worker recovery timed out"); await new Promise((resolve) => setTimeout(resolve, 50)); }
  };
  const launch = (stage) => {
    const env = { ...process.env, NODE_ENV: "test", JWT_SECRET: "isolated-crash-test-signing-key", OTEL_ENABLED: "false", MONITORING_ENABLED: "false",
      TEST_MONGO_URI: getDbUri(), TEST_QUEUE_NAME: queueName,
      TEST_PROVIDER_URL: `http://127.0.0.1:${provider.address().port}`, CRASH_AT: stage || "" };
    const child = fork(path.join(__dirname, "../fixtures/crashWorker.cjs"), { env, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const stages = new Set(); child.on("message", ({ stage }) => stages.add(stage)); child.stages = stages;
    children.push(child); return child;
  };
  it.each(["before-send", "after-acceptance", "after-commit"])("recovers after SIGKILL at %s with one accepted delivery and an atomic invitation receipt", async (stage) => {
    const waitlistId = new mongoose.Types.ObjectId();
    const signup = await Signup.create({ waitlistId, email: "crash@example.com", refCode: "CRASH", basePosition: 1, currentPosition: 1, invitationState: "queued" });
    const item = await recordEmail({ dedupeKey: "crash-invite", kind: "invitation", waitlistId, signupId: signup._id, to: signup.email, subject: "Test", html: "Test" });
    const first = launch(stage); await waitUntil(() => first.stages.has(stage));
    await kill(first);
    const before = await Outbox.findById(item._id);
    expect(before.state).toBe(stage === "after-commit" ? "sent" : "processing");
    expect((await Signup.findById(signup._id)).status).toBe(stage === "after-commit" ? "invited" : "waiting");
    launch();
    await waitUntil(async () => (await Outbox.findById(item._id)).state === "sent" && (await (await queue.getJob(`${item._id}-0`)).getState()) === "completed");
    expect(accepted.size).toBe(1);
    expect(submissions).toBe(stage === "after-acceptance" ? 2 : 1);
    expect(accepted.has(item.deliveryKey)).toBe(true);
    expect((await Signup.findById(signup._id)).invitationState).toBe("sent");
    expect((await Outbox.findById(item._id)).deliveryKey).toBe(item.deliveryKey);
  }, 25000);
});
