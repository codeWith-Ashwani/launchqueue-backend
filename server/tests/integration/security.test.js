const request = require("supertest");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const app = require("../../index");
const Founder = require("../../models/Founder");
const generateToken = require("../../utils/generateToken");
const { connectDb, clearDb, closeDb } = require("../setupDb");
describe("Founder session and browser request protection", () => {
  let owner; let token;
  beforeAll(connectDb, 30000); afterAll(closeDb);
  beforeEach(async () => {
    await clearDb();
    owner = await Founder.create({ email: "secure@example.com", password: await bcrypt.hash("oldpassword", 10) });
    token = generateToken(owner._id);
  });
  const me = (value) => request(app).get("/api/auth/me").set("Authorization", `Bearer ${value}`);
  it("revokes old sessions on password change and refreshes the changing browser's session", async () => {
    const changed = await request(app).patch("/api/auth/password").set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "oldpassword", newPassword: "newpassword" });
    expect(changed.status).toBe(200);
    expect((await me(token)).status).toBe(401);
    const cookie = changed.headers["set-cookie"][0].split(";")[0];
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
  });
  it("consumes a reset token once under concurrent submissions and revokes earlier sessions", async () => {
    const proof = "reset-proof";
    await Founder.updateOne({ _id: owner._id }, { $set: { resetPasswordTokenHash: crypto.createHash("sha256").update(proof).digest("hex"),
      resetPasswordExpires: new Date(Date.now() + 60000) } });
    const replies = await Promise.all(Array.from({ length: 4 }, () => request(app).post("/api/auth/reset-password")
      .send({ token: proof, newPassword: "newpassword" })));
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1);
    expect(replies.filter((r) => r.status === 400)).toHaveLength(3);
    expect((await me(token)).status).toBe(401);
  });
  it("revokes the logged-out token", async () => {
    expect((await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await me(token)).status).toBe(401);
  });
  it("requires the browser header for cookie mutations and rejects untrusted origins", async () => {
    const call = () => request(app).patch("/api/auth/profile").set("Cookie", `token=${token}`);
    expect((await call().send({ name: "Blocked" })).status).toBe(403);
    expect((await call().set("Origin", "https://attacker.example").set("X-LaunchQueue-Request", "1").send({ name: "Blocked" })).status).toBe(403);
    expect((await call().set("Origin", process.env.CLIENT_URL).set("X-LaunchQueue-Request", "1").send({ name: "Allowed" })).status).toBe(200);
    expect((await request(app).post("/api/auth/login").set("Origin", "https://attacker.example").send({ email: owner.email, password: "oldpassword" })).status).toBe(403);
  });
  it("rejects passwords beyond bcrypt's byte boundary and malformed resource IDs", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "oversized@example.com", password: "界".repeat(25) });
    expect(res.status).toBe(400);
    expect(await Founder.findOne({ email: "oversized@example.com" })).toBeNull();
    expect((await request(app).get("/api/waitlists/not-an-id").set("Authorization", `Bearer ${token}`)).status).toBe(400);
  });
});
