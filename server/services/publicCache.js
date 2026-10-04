const { getRedis } = require("../config/redis");
const { observe } = require("./telemetry");
async function publicCache(key, compute, ttl = 10, client = getRedis()) {
  if (client?.status === "ready") {
    try {
      const cached = await observe("redis.cache.read", () => client.get(key));
      if (cached) return JSON.parse(cached);
    } catch {
      /* The public API remains available when its cache is unavailable. */
    }
  }
  const result = await compute();
  if (client?.status === "ready") {
    try {
      await observe("redis.cache.write", () =>
        client.set(key, JSON.stringify(result), "EX", ttl),
      );
    } catch {
      /* Cache is optional. */
    }
  }
  return result;
}
module.exports = publicCache;
