const http = require("node:http");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");
const path = require("node:path");

it("exports sampled traces to a configured OTLP collector and flushes on shutdown", async () => {
  const received = [];
  const collector = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => { received.push(Buffer.concat(chunks).toString()); res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); });
  });
  await new Promise((resolve) => collector.listen(0, "127.0.0.1", resolve));
  try {
    // Run the production exporter in Node: its dynamic imports need Node's loader,
    // rather than Jest's VM loader. This also checks actual process shutdown.
    await promisify(execFile)(process.execPath, ["-e", `
      const { EventEmitter } = require('node:events');
      const telemetry = require('./services/telemetry');
      telemetry.startTelemetry();
      const req = { method: 'GET', route: { path: '/health' }, originalUrl: '/health?token=private-token' };
      const res = new EventEmitter(); res.setHeader = () => {}; res.statusCode = 200;
      require('./middleware/requestTrace')(req, res, () => {}); res.emit('finish');
      telemetry.stopTelemetry().catch(() => { process.exitCode = 1; });
    `], { cwd: path.resolve(__dirname, "../.."), env: { ...process.env, NODE_ENV: "test", OTEL_ENABLED: "true", OTEL_TRACE_SAMPLE_RATE: "1",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `http://127.0.0.1:${collector.address().port}/v1/traces` }, timeout: 10000 });
    expect(received).toHaveLength(1);
    const payload = JSON.parse(received[0]);
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).toBe("GET /health");
    expect(received[0]).not.toContain("private-token");
  } finally {
    collector.closeAllConnections(); await new Promise((resolve) => collector.close(resolve));
  }
});
