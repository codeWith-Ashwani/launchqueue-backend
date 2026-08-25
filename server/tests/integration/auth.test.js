const request = require("supertest");
const app = require("../../index");
const { connectDb, closeDb, clearDb } = require("../setupDb");

describe("Auth Controller Integration Tests", () => {
  beforeAll(async () => {
    await connectDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await clearDb();
  });

  it("registers a new founder account successfully and sets httpOnly cookie", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: "founder@launchqueue.com",
        password: "password123",
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("token");
    expect(res.body).toHaveProperty("founder");
    expect(res.body.founder.email).toBe("founder@launchqueue.com");
    expect(res.body.founder.plan).toBe("free");

    // Verify httpOnly cookie was set
    const cookies = res.headers["set-cookie"];
    expect(cookies).toBeDefined();
    expect(cookies.some((c) => c.includes("token=") && c.includes("HttpOnly"))).toBe(true);
  });

  it("returns 409 when registering with a duplicate email", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({
        email: "duplicate@launchqueue.com",
        password: "password123",
      });

    const duplicateRes = await request(app)
      .post("/api/auth/register")
      .send({
        email: "duplicate@launchqueue.com",
        password: "password123",
      });

    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body).toHaveProperty("error");
    expect(duplicateRes.body.error).toMatch(/already exists/i);
  });

  it("returns 401 when logging in with an incorrect password", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({
        email: "user@launchqueue.com",
        password: "correctpassword",
      });

    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: "user@launchqueue.com",
        password: "wrongpassword",
      });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/Invalid email or password/i);
  });

  it("returns 200 with token, founder profile and httpOnly cookie on successful login", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({
        email: "valid@launchqueue.com",
        password: "securepassword",
      });

    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: "valid@launchqueue.com",
        password: "securepassword",
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(res.body).toHaveProperty("founder");
    expect(res.body.founder.email).toBe("valid@launchqueue.com");

    const cookies = res.headers["set-cookie"];
    expect(cookies).toBeDefined();
    expect(cookies.some((c) => c.includes("token=") && c.includes("HttpOnly"))).toBe(true);

    // Authenticate /api/auth/me using the cookie
    const tokenCookie = cookies.find((c) => c.startsWith("token="));
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Cookie", [tokenCookie]);

    expect(meRes.status).toBe(200);
    expect(meRes.body.founder.email).toBe("valid@launchqueue.com");
  });

  it("logs out and clears the token cookie", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Logged out successfully/i);

    const cookies = res.headers["set-cookie"];
    expect(cookies).toBeDefined();
    expect(cookies.some((c) => c.includes("token=;"))).toBe(true);
  });
});
