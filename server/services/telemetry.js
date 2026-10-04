const { trace, SpanStatusCode } = require("@opentelemetry/api");
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");

// Fixed labels and bounded reservoirs: never store URLs, IDs, payloads or errors.
const routes = new Map();
const operations = new Map();
const vitals = new Map();
const started = Date.now();
let sdk;
const loop = monitorEventLoopDelay({ resolution: 20 });
if (process.env.NODE_ENV !== "test") loop.enable();
const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const operationNames = new Set(["mongo.analytics.summary", "mongo.analytics.visitors", "mongo.analytics.ranking", "mongo.analytics.referrers", "redis.cache.read", "redis.cache.write", "email.deliver", "ai.design"]);
function methodLabel(method) { return methods.has(method) ? method : "OTHER"; }
function record(map, key, value, failed = false) {
  if (!map.has(key)) {
    if (map.size >= 128) key = "other";
    if (!map.has(key)) map.set(key, { count: 0, failures: 0, total: 0, samples: [] });
  }
  const entry = map.get(key);
  entry.count++; entry.failures += Number(failed); entry.total += value;
  entry.samples.push(value);
  if (entry.samples.length > 128) entry.samples.shift();
}
function summarize(map) {
  return Array.from(map, ([label, entry]) => {
    const sorted = [...entry.samples].sort((a, b) => a - b);
    const percentile = (p) => Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 100) / 100;
    return { label, count: entry.count, failures: entry.failures, mean: Math.round(entry.total / entry.count * 100) / 100,
      p50: percentile(0.5), p95: percentile(0.95), sampled: sorted.length };
  });
}
function startTelemetry() {
  if (sdk || process.env.OTEL_ENABLED !== "true") return;
  const { NodeSDK } = require("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
  const { ParentBasedSampler, TraceIdRatioBasedSampler } = require("@opentelemetry/sdk-trace-base");
  const rate = Number(process.env.OTEL_TRACE_SAMPLE_RATE || 0.1);
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1 || !endpoint || !/^https?:\/\//.test(endpoint)) {
    throw new Error("Telemetry requires an HTTP trace collector and a sample rate between 0 and 1");
  }
  sdk = new NodeSDK({ serviceName: process.env.OTEL_SERVICE_NAME || "launchqueue-api", autoDetectResources: false,
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(rate) }),
    // Manual instrumentation deliberately excludes raw HTTP URLs and database queries.
    instrumentations: [], metricReaders: [], logRecordProcessors: [],
  });
  sdk.start();
}
async function stopTelemetry() { loop.disable(); if (sdk) await sdk.shutdown(); }
async function observe(name, action) {
  if (!operationNames.has(name)) throw new Error("Unknown telemetry operation");
  return trace.getTracer("launchqueue").startActiveSpan(name, async (span) => {
    const start = performance.now(); let failed = false;
    try { return await action(); }
    catch (error) { failed = true; span.setStatus({ code: SpanStatusCode.ERROR }); throw error; }
    finally { record(operations, name, performance.now() - start, failed); span.end(); }
  });
}
function snapshot() {
  const memory = process.memoryUsage();
  return { scope: "this process since startup", uptimeSeconds: Math.floor((Date.now() - started) / 1000),
    percentiles: "most recent 128 samples per label", memoryBytes: { rss: memory.rss, heapUsed: memory.heapUsed },
    eventLoopP95Ms: loop.count ? Math.round(loop.percentile(95) / 1e6 * 100) / 100 : null,
    requests: summarize(routes), operations: summarize(operations), webVitals: summarize(vitals),
    units: { requests: "ms", operations: "ms", LCP: "ms", INP: "ms", CLS: "score" } };
}
module.exports = { startTelemetry, stopTelemetry, observe, snapshot, methodLabel,
  recordRequest: (label, duration, failed) => record(routes, label, duration, failed),
  recordVital: (name, route, value) => record(vitals, `${name} ${route}`, value) };
