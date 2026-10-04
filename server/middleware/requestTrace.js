const crypto = require("crypto");
const { trace, SpanStatusCode } = require("@opentelemetry/api");
const { recordRequest, methodLabel } = require("../services/telemetry");
module.exports = (req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  const started = performance.now();
  const method = methodLabel(req.method);
  return trace
    .getTracer("launchqueue")
    .startActiveSpan("HTTP request", (span) => {
      let ended = false;
      if (res.writeHead) {
        const original = res.writeHead;
        res.writeHead = function (...args) {
          if (!res.headersSent)
            res.setHeader(
              "Server-Timing",
              `app;dur=${(performance.now() - started).toFixed(1)}`,
            );
          return original.apply(this, args);
        };
      }
      const finish = (aborted) => {
        if (ended) return;
        ended = true;
        const route =
          typeof req.route?.path === "string"
            ? (req.telemetryMount || "") + req.route.path
            : "unmatched";
        const status = aborted ? 499 : res.statusCode;
        const durationMs = performance.now() - started;
        recordRequest(
          `${method} ${route}`,
          durationMs,
          status >= 500 || aborted,
        );
        span.updateName(`${method} ${route}`);
        span.setAttributes({
          "http.request.method": method,
          "http.route": route,
          "http.response.status_code": status,
          "request.id": req.requestId,
        });
        if (status >= 500 || aborted)
          span.setStatus({ code: SpanStatusCode.ERROR });
        const spanContext = span.spanContext();
        span.end();
        if (process.env.NODE_ENV !== "test")
          console.log(
            JSON.stringify({
              type: "request",
              requestId: req.requestId,
              method,
              route,
              status,
              durationMs: Math.round(durationMs),
              ...(spanContext.traceId !== "00000000000000000000000000000000"
                ? { traceId: spanContext.traceId }
                : {}),
            }),
          );
      };
      res.once("finish", () => finish(false));
      res.once("close", () => finish(true));
      next();
    });
};
