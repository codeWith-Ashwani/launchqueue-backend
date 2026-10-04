const request = require("supertest");
const path = require("node:path");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");
const app = require("../../index");
const Founder = require("../../models/Founder");
const Batch = require("../../models/MonitoringBatch");
const Span = require("../../models/TraceSpan");
const monitoring = require("../../services/monitoring");
const token = require("../../utils/generateToken");
const { connectDb, closeDb, clearDb, getDbUri } = require("../setupDb");
let authorization;
const original = process.env.MONITORING_ENABLED;
beforeAll(async () => { await connectDb(); process.env.MONITORING_ENABLED = "true"; });
beforeEach(async () => { await monitoring.flush(); await clearDb(); const admin = await Founder.create({ email: "admin-monitor@example.com", adminApproved: true }); authorization = `Bearer ${token(admin._id)}`; });
afterEach(async () => { jest.restoreAllMocks(); await monitoring.flush(); });
afterAll(async () => { await monitoring.stop(); await closeDb(); if (original === undefined) delete process.env.MONITORING_ENABLED; else process.env.MONITORING_ENABLED = original; });

it("persists SLO observations with explicit units, warmup and approximate percentiles", async () => {
  for (let i = 0; i < 20; i++) { monitoring.capture("LCP", "/", i < 15 ? 1200 : 3000); monitoring.capture("http", "GET /health", i === 0 ? 2500 : 50, i === 0); }
  const res = await request(app).get("/api/admin/monitoring").set("Authorization", authorization);
  expect(res.status).toBe(200); expect(res.headers["cache-control"]).toBe("no-store");
  const lcp = res.body.series.find((row) => row.name === "LCP");
  expect(lcp).toMatchObject({ count: 20, goodRate: 0.75, status: "met", threshold: 2500, p75UpperBound: 2000 });
  const http = res.body.series.find((row) => row.label === "GET /health");
  expect(http).toMatchObject({ availability: 0.95, status: "breached" });
  expect(await Batch.countDocuments()).toBeGreaterThan(0);
  expect((await Batch.collection.indexes()).some((index) => index.expireAfterSeconds === 0)).toBe(true);
});
it("retries a lost write acknowledgement without duplicating metric counts", async () => {
  const update = Batch.updateOne.bind(Batch);
  jest.spyOn(Batch, "updateOne").mockImplementationOnce(async (...args) => { await update(...args); throw new Error("Acknowledgement lost"); });
  for (let i = 0; i < 10; i++) monitoring.capture("INP", "/", 30);
  await monitoring.flush(); expect(monitoring.status().pendingBatches).toBe(1);
  await monitoring.flush(); expect(monitoring.status().pendingBatches).toBe(0);
  expect((await monitoring.report(24)).series.find((row) => row.name === "INP").count).toBe(10);
  expect(await Batch.countDocuments()).toBe(1);
});
it("enforces database approval, query bounds and trace ID validation", async () => {
  expect((await request(app).get("/api/admin/monitoring")).status).toBe(401);
  const founder = await Founder.create({ email: "founder-monitor@example.com" });
  expect((await request(app).get("/api/admin/traces").set("Authorization", `Bearer ${token(founder._id)}`)).status).toBe(403);
  expect((await request(app).get("/api/admin/monitoring?hours=9999").set("Authorization", authorization)).status).toBe(400);
  expect((await request(app).get("/api/admin/traces/not-valid").set("Authorization", authorization)).status).toBe(400);
  expect((await request(app).get(`/api/admin/traces/${"a".repeat(32)}`).set("Authorization", authorization)).status).toBe(404);
});
it("stores real correlated spans across process shutdown while discarding raw errors and private attributes", async () => {
  await promisify(execFile)(process.execPath, ["-e", `
    (async () => {
      const mongoose = require('mongoose'); await mongoose.connect(process.env.TEST_MONGO_URI);
      const telemetry = require('./services/telemetry'); telemetry.startTelemetry();
      const { EventEmitter } = require('node:events'); const res = new EventEmitter(); res.setHeader = () => {}; res.statusCode = 500;
      let operation; require('./middleware/requestTrace')({ method: 'GET', route: { path: '/:id/stats' }, telemetryMount: '/api/waitlists', originalUrl: '/private-id?token=private-token' }, res,
        () => { operation = telemetry.observe('mongo.analytics.ranking', async () => { throw new Error('private@example.com secret-token'); }).catch(() => {}); });
      await operation; res.emit('finish'); await telemetry.stopTelemetry(); await mongoose.disconnect();
    })().catch(() => { process.exitCode = 1; });
  `], { cwd: path.resolve(__dirname, "../.."), env: { ...process.env, NODE_ENV: "test", MONITORING_ENABLED: "true", OTEL_ENABLED: "false", OTEL_TRACE_SAMPLE_RATE: "1", TEST_MONGO_URI: getDbUri() }, timeout: 15000 });
  const roots = await request(app).get("/api/admin/traces?errorsOnly=true").set("Authorization", authorization);
  expect(roots.status).toBe(200); expect(roots.body.traces).toHaveLength(1);
  const root = roots.body.traces[0];
  const detail = await request(app).get(`/api/admin/traces/${root.traceId}`).set("Authorization", authorization);
  expect(detail.body.spans).toHaveLength(2);
  expect(detail.body.spans.find((row) => row.name === "mongo.analytics.ranking").parentSpanId).toBe(root.spanId);
  expect(JSON.stringify(detail.body)).not.toMatch(/private-id|private-token|private@example|secret-token/);
  expect((await Span.collection.indexes()).some((index) => index.expireAfterSeconds === 0)).toBe(true);
});
