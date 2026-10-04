const crypto = require("crypto");
const { getRedis } = require("../config/redis");
const COUNT = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}`;
class RedisRateStore {
  constructor(prefix, client = null) {
    this.prefix = `launchqueue:limits:${prefix}:`;
    this.client = client;
    this.localKeys = false;
  }
  init(options) {
    this.windowMs = options.windowMs;
  }
  key(value) {
    return (
      this.prefix +
      crypto
        .createHmac("sha256", process.env.JWT_SECRET)
        .update(value)
        .digest("hex")
    );
  }
  async increment(value) {
    try {
      const client = this.client || getRedis();
      if (client?.status !== "ready") throw new Error("Unavailable");
      const [totalHits, ttl] = await client.eval(
        COUNT,
        1,
        this.key(value),
        this.windowMs,
      );
      return { totalHits, resetTime: new Date(Date.now() + Math.max(0, ttl)) };
    } catch {
      throw Object.assign(
        new Error(
          "Request protection is temporarily unavailable. Please try again.",
        ),
        { status: 503 },
      );
    }
  }
  async decrement(value) {
    await (this.client || getRedis()).decr(this.key(value));
  }
  async resetKey(value) {
    await (this.client || getRedis()).del(this.key(value));
  }
}
module.exports = RedisRateStore;
