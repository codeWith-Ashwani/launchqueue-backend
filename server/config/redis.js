const Redis = require("ioredis");

function validateRedisUrl(value) {
  if (!value) return;
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error("REDIS_URL must be a valid Redis connection URL"); }
  if (!["redis:", "rediss:"].includes(parsed.protocol)) throw new Error("REDIS_URL must use redis:// or rediss://");
}

function createRedis(role = "request", url = process.env.REDIS_URL) {
  if (!url) return null;
  validateRedisUrl(url);
  const worker = role === "worker";
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 2000,
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    ...(worker ? {} : { commandTimeout: 2000 }),
    retryStrategy: (attempt) => Math.min(attempt * 250, 3000),
  });
  // Never log connection strings or credentials.
  client.on("error", () => {});
  return client;
}

let requestClient;
function getRedis() {
  if (requestClient === undefined) {
    requestClient = createRedis();
    if (requestClient) void requestClient.connect().catch(() => {});
  }
  return requestClient;
}
async function closeRedis() {
  if (requestClient) requestClient.disconnect();
  requestClient = undefined;
}
async function redisHealth() {
  const client = getRedis();
  if (!client) return "not-configured";
  if (client.status !== "ready") return "unavailable";
  try { return await client.ping() === "PONG" ? "available" : "unavailable"; }
  catch { return "unavailable"; }
}
module.exports = { validateRedisUrl, createRedis, getRedis, closeRedis, redisHealth };
