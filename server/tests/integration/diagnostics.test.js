const request = require("supertest");
const app = require("../../index");
const Founder = require("../../models/Founder");
const EmailOutbox = require("../../models/EmailOutbox");
const generateToken = require("../../utils/generateToken");
const { connectDb, closeDb, clearDb } = require("../setupDb");
beforeAll(connectDb); afterAll(closeDb); beforeEach(clearDb);

it("restricts diagnostics to database-approved admins and immediately respects revocation", async () => {
  expect((await request(app).get("/api/admin/diagnostics")).status).toBe(401);
  const founder = await Founder.create({ email: "private@example.com", password: "hash" });
  const authorization = `Bearer ${generateToken(founder._id)}`;
  expect((await request(app).get("/api/admin/diagnostics").set("Authorization", authorization)).status).toBe(403);
  await Founder.updateOne({ _id: founder._id }, { $set: { adminApproved: true } });
  await EmailOutbox.create({ dedupeKey: "private-key", kind: "verification", encryptedPayload: "private-ciphertext", createdAt: new Date(Date.now() - 60000) });
  const res = await request(app).get("/api/admin/diagnostics").set("Authorization", authorization);
  expect(res.status).toBe(200); expect(res.headers["cache-control"]).toBe("no-store");
  expect(res.body.emailOutbox.states.pending).toBe(1); expect(res.body.emailOutbox.oldestUnsentAgeSeconds).toBeGreaterThanOrEqual(59);
  expect(JSON.stringify(res.body)).not.toMatch(/private@example|private-key|private-ciphertext/);
  await Founder.updateOne({ _id: founder._id }, { $set: { adminApproved: false } });
  expect((await request(app).get("/api/admin/diagnostics").set("Authorization", authorization)).status).toBe(403);
});
it("accepts a small anonymous beacon and rejects extra identifying fields or untrusted origins", async () => {
  const valid = { metrics: [{ name: "LCP", route: "/w/:slug", value: 1200 }] };
  const send = (payload, origin = "http://localhost:5173") => request(app).post("/api/telemetry/vitals").set("Origin", origin).set("Content-Type", "text/plain").send(JSON.stringify(payload));
  expect((await send(valid)).status).toBe(204);
  expect((await send(valid, "https://untrusted.example")).status).toBe(403);
  expect((await send({ metrics: [{ ...valid.metrics[0], email: "private@example.com" }] })).status).toBe(400);
  expect((await send({ metrics: [{ ...valid.metrics[0], route: "/w/private-product" }] })).status).toBe(400);
  expect((await send({ metrics: [{ ...valid.metrics[0], value: -1 }] })).status).toBe(400);
  expect((await send({ metrics: Array(4).fill(valid.metrics[0]) })).status).toBe(400);
});
it("retains security headers and exposes server duration without a preflight-only request header", async () => {
  const res = await request(app).get("/api/auth/config").set("Origin", "http://localhost:5173");
  expect(res.status).toBe(200); expect(res.headers["server-timing"]).toMatch(/^app;dur=\d+/);
  expect(res.headers["access-control-expose-headers"]).toContain("Server-Timing");
  expect(res.headers["x-request-id"]).toBeDefined();
});
