// Runs the actual BullMQ worker against test-only Mongo/Redis and a loopback provider.
const mongoose = require("mongoose");
const { createRedis } = require("../../config/redis");
if (process.env.NODE_ENV !== "test" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.TEST_PROVIDER_URL || "")) throw new Error("Crash fixture requires isolated test infrastructure");
const pause = async (stage) => {
  if (process.env.CRASH_AT !== stage) return;
  process.send({ stage });
  await new Promise(() => {});
};
require.cache[require.resolve("../../utils/sendEmail")] = { exports: async ({ deliveryKey, messageId }) => {
  await pause("before-send");
  const response = await fetch(process.env.TEST_PROVIDER_URL, { method: "POST", body: JSON.stringify({ deliveryKey, messageId }) });
  if (!response.ok) throw new Error("Fixture provider rejected message");
  await pause("after-acceptance");
} };
const outbox = require("../../services/emailOutbox");
const originalDeliver = outbox.deliverEmail;
outbox.deliverEmail = async (job) => {
  await originalDeliver(job, { leaseMs: 800 });
  await pause("after-commit");
};
async function main() {
  await mongoose.connect(process.env.TEST_MONGO_URI);
  const connection = createRedis("worker", process.env.TEST_REDIS_URL);
  await connection.connect();
  await require("../../workers/emailWorker").runEmailWorker(connection, {
    queueName: process.env.TEST_QUEUE_NAME, redisUrl: process.env.TEST_REDIS_URL, pollMs: 100, redispatchMs: 200,
    workerOptions: { concurrency: 1, lockDuration: 1000, stalledInterval: 500 },
  });
  process.send({ stage: "ready" });
}
main().catch(() => { process.send?.({ stage: "failed" }); process.exitCode = 1; });
