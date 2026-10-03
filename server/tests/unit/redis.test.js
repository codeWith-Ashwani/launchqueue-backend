const { validateRedisUrl, createRedis, closeRedis, redisHealth } = require("../../config/redis");
describe("Redis configuration", () => {
  afterEach(closeRedis);
  it("accepts TCP and TLS URLs and rejects unsupported protocols", () => {
    expect(() => validateRedisUrl("redis://localhost:6379")).not.toThrow();
    expect(() => validateRedisUrl("rediss://example.com:6379")).not.toThrow();
    expect(() => validateRedisUrl("https://example.com")).toThrow(/redis/);
    expect(() => validateRedisUrl("broken")).toThrow(/valid/);
  });
  it("uses bounded request retries and persistent worker retries", () => {
    const producer = createRedis("request", "redis://localhost:6379");
    const worker = createRedis("worker", "redis://localhost:6379");
    expect(producer.options.maxRetriesPerRequest).toBe(1);
    expect(producer.options.enableOfflineQueue).toBe(false);
    expect(worker.options.maxRetriesPerRequest).toBeNull();
    producer.disconnect(); worker.disconnect();
  });
  it("reports Redis as optional when not configured", async () => {
    const previous = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    expect(await redisHealth()).toBe("not-configured");
    if (previous) process.env.REDIS_URL = previous;
  });
});
