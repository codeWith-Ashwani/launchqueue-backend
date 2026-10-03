const request = require("supertest");
const app = require("../../index");
const { connectDb, closeDb } = require("../setupDb");
describe("API health endpoints", () => {
  it("reports liveness without a database connection", async () => {
    expect((await request(app).get("/health")).body.status).toBe("alive");
    expect((await request(app).get("/ready")).status).toBe(503);
  });
  it("reports database readiness and optional Redis state", async () => {
    await connectDb();
    try {
      const response = await request(app).get("/ready");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "ready", database: true, redis: "not-configured" });
    } finally { await closeDb(); }
  }, 30000);
});
