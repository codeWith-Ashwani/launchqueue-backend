const { Queue, Worker } = require("bullmq");
const { startWorker } = require("./runtime");
const { dispatchPending, deliverEmail } = require("../services/emailOutbox");
const { createRedis } = require("../config/redis");

async function runEmailWorker(connection, { queueName = "launchqueue-email", pollMs = 1000, redisUrl = process.env.REDIS_URL } = {}) {
  const producer = createRedis("request", redisUrl);
  try { await producer.connect(); }
  catch (err) { producer.disconnect(); throw err; }
  const queue = new Queue(queueName, { connection: producer });
  const worker = new Worker(queueName, deliverEmail, { connection, concurrency: 5 });
  queue.on("error", () => console.error("Email queue unavailable"));
  worker.on("error", () => console.error("Email worker unavailable"));
  worker.on("failed", (job) => console.error("Email delivery attempt failed", { jobId: job?.id }));
  let active;
  const poll = () => {
    if (active) return;
    active = dispatchPending(queue).catch(() => console.error("Outbox dispatch failed")).finally(() => { active = null; });
  };
  poll();
  const timer = setInterval(poll, pollMs);
  return async () => { clearInterval(timer); if (active) await active; await worker.close(); await queue.close(); producer.disconnect(); };
}
if (require.main === module) startWorker(runEmailWorker).catch(() => {
  console.error("Email worker startup failed; verify configuration and dependency availability"); process.exitCode = 1;
});
module.exports = { runEmailWorker };
