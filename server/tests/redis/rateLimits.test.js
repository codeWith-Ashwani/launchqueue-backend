const crypto = require("crypto");
const express = require("express");
const request = require("supertest");
const { createRedis } = require("../../config/redis");
const { createLimiter } = require("../../middleware/rateLimiter");
const RedisRateStore = require("../../services/redisRateStore");
process.env.JWT_SECRET = "rate-limit-test-key-at-least-32-characters";
const describeRedis = process.env.TEST_REDIS_URL ? describe : describe.skip;
describeRedis("Shared Redis request protection", () => {
  let first; let second;
  const prefix = `test-${crypto.randomUUID()}`;
  beforeAll(async () => {
    first = createRedis("request", process.env.TEST_REDIS_URL); second = createRedis("request", process.env.TEST_REDIS_URL);
    await Promise.all([first.connect(), second.connect()]);
  });
  afterAll(async () => {
    let cursor = "0";
    do {
      const [next, keys] = await first.scan(cursor, "MATCH", `launchqueue:limits:${prefix}*`, "COUNT", 100);
      cursor = next; if (keys.length) await first.del(...keys);
    } while (cursor !== "0");
    first.disconnect(); second.disconnect();
  });
  function api(client) {
    const app = express();
    app.get("/", createLimiter(prefix, 1000, 3, { client, skipTests: false }), (_req, res) => res.json({ ok: true }));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    return app;
  }
  it("enforces one budget across independent API processes", async () => {
    const apps = [api(first), api(second)];
    const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => request(apps[i % 2]).get("/")));
    expect(replies.filter((r) => r.status === 200)).toHaveLength(3);
    expect(replies.filter((r) => r.status === 429)).toHaveLength(5);
    expect(replies.find((r) => r.status === 429).headers["retry-after"]).toBeDefined();
  });
  it("expires counters and stores a hashed identity", async () => {
    const store = new RedisRateStore(`${prefix}-expiry`, first); store.init({ windowMs: 100 });
    expect(store.key("raw-ip")).not.toContain("raw-ip");
    expect((await store.increment("raw-ip")).totalHits).toBe(1);
    expect((await store.increment("raw-ip")).totalHits).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await store.increment("raw-ip")).totalHits).toBe(1);
  });
  it("returns a bounded temporary error when Redis is disconnected", async () => {
    expect((await request(api({ status: "end" })).get("/")).status).toBe(503);
  });
});
