const crypto = require("crypto");
const { createRedis } = require("../../config/redis");
const suite = process.env.TEST_REDIS_URL ? describe : describe.skip;
suite("Real Redis infrastructure", () => {
  let first; let second;
  const key = `lq-test-${crypto.randomUUID()}`;
  beforeAll(async () => {
    first = createRedis("request", process.env.TEST_REDIS_URL);
    second = createRedis("request", process.env.TEST_REDIS_URL);
    await Promise.all([first.connect(), second.connect()]);
  });
  afterAll(async () => {
    if (first?.status === "ready") await first.del(key);
    first?.disconnect(); second?.disconnect();
  });
  it("shares atomic counters between independent connections", async () => {
    expect(await first.ping()).toBe("PONG");
    const values = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).incr(key)));
    expect(new Set(values).size).toBe(20);
    expect(await second.get(key)).toBe("20");
  });
});
