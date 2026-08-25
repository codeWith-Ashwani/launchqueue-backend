const request = require("supertest");
const app = require("../../index");
const { connectDb, closeDb } = require("../setupDb");

describe("OpenAPI Documentation Route Tests", () => {
  beforeAll(async () => {
    await connectDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("serves the Swagger UI at /api/docs", async () => {
    const res = await request(app).get("/api/docs/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Swagger UI");
  });

  it("returns documentation URL in root endpoint response", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("documentation", "/api/docs");
  });
});
