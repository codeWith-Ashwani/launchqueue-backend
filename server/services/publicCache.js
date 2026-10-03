const { getRedis } = require("../config/redis");
async function publicCache(key, compute, ttl = 10, client = getRedis()) {
  if (client?.status === "ready") {
    try { const cached = await client.get(key); if (cached) return JSON.parse(cached); }
    catch { /* The public API remains available when its cache is unavailable. */ }
  }
  const result = await compute();
  if (client?.status === "ready") {
    try { await client.set(key, JSON.stringify(result), "EX", ttl); } catch { /* Cache is optional. */ }
  }
  return result;
}
module.exports = publicCache;
