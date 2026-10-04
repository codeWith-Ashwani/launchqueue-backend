const { EventEmitter } = require("node:events");
const { NodeSDK } = require("@opentelemetry/sdk-node");
const { InMemorySpanExporter, SimpleSpanProcessor, AlwaysOnSampler } = require("@opentelemetry/sdk-trace-base");
const { observe, snapshot } = require("../../services/telemetry");
const traceRequest = require("../../middleware/requestTrace");
const exporter = new InMemorySpanExporter();
const sdk = new NodeSDK({ autoDetectResources: false, spanProcessors: [new SimpleSpanProcessor(exporter)], sampler: new AlwaysOnSampler(), logRecordProcessors: [], metricReaders: [] });
beforeAll(() => sdk.start());
afterAll(() => sdk.shutdown());
beforeEach(() => exporter.reset());

it("exports correlated operation spans without identities, URLs or raw errors", async () => {
  const req = { method: "GET", telemetryMount: "/api/waitlists", route: { path: "/:id/stats" }, originalUrl: "/api/waitlists/private-id/stats?token=private-token" };
  const res = new EventEmitter(); res.setHeader = jest.fn(); res.statusCode = 500;
  let operation;
  traceRequest(req, res, () => { operation = observe("mongo.analytics.summary", async () => { throw new Error("private@example.com secret-token"); }).catch(() => {}); });
  await operation; res.emit("finish"); res.emit("close");
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(2);
  const root = spans.find((s) => s.name === "GET /api/waitlists/:id/stats");
  const child = spans.find((s) => s.name === "mongo.analytics.summary");
  expect(child.spanContext().traceId).toBe(root.spanContext().traceId);
  expect(child.parentSpanContext.spanId).toBe(root.spanContext().spanId);
  expect(child.status.code).toBe(2);
  const serialized = JSON.stringify(spans.map((s) => ({ name: s.name, attributes: s.attributes, events: s.events, status: s.status })));
  expect(serialized).not.toMatch(/private-id|private-token|secret-token|private@example/);
  const requests = snapshot().requests.find((entry) => entry.label === "GET /api/waitlists/:id/stats");
  expect(requests.count).toBe(1); expect(requests.failures).toBe(1);
});
it("counts disconnects exactly once and groups unknown URLs", () => {
  const req = { method: "GET", originalUrl: "/secret-path" };
  const res = new EventEmitter(); res.setHeader = jest.fn(); res.statusCode = 200;
  traceRequest(req, res, () => {}); res.emit("close"); res.emit("finish");
  const root = exporter.getFinishedSpans()[0];
  expect(root.name).toBe("GET unmatched"); expect(root.attributes["http.response.status_code"]).toBe(499);
});
it("bounds retained samples under sustained traffic and rejects dynamic operation names", async () => {
  for (let i = 0; i < 200; i++) await observe("redis.cache.read", async () => true);
  const entry = snapshot().operations.find((row) => row.label === "redis.cache.read");
  expect(entry.count).toBe(200); expect(entry.sampled).toBe(128);
  await expect(observe("redis.key.private-email", async () => {})).rejects.toThrow("Unknown telemetry operation");
});
