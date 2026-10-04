const mongoose = require("mongoose");
const Span = require("../models/TraceSpan");
const names = new Set(["mongo.analytics.summary", "mongo.analytics.visitors", "mongo.analytics.ranking", "mongo.analytics.referrers", "redis.cache.read", "redis.cache.write", "email.deliver", "ai.design"]);
class MongoTraceExporter {
  constructor(serviceName) { this.serviceName = serviceName.slice(0, 64); }
  export(spans, callback) {
    if (mongoose.connection.readyState !== 1) { callback({ code: 1 }); return; }
    const rows = spans.flatMap((span) => {
      const attributes = span.attributes;
      const isHttp = typeof attributes["http.route"] === "string" && typeof attributes["http.request.method"] === "string";
      if (!isHttp && !names.has(span.name)) return [];
      const context = span.spanContext(), startedAt = new Date(span.startTime[0] * 1000 + span.startTime[1] / 1e6);
      return [{ _id: `${context.traceId}:${context.spanId}`, traceId: context.traceId, spanId: context.spanId,
        parentSpanId: span.parentSpanContext?.spanId || null, name: span.name.slice(0, 160), serviceName: this.serviceName, startedAt,
        durationMs: span.duration[0] * 1000 + span.duration[1] / 1e6, status: span.status.code,
        ...(isHttp ? { route: attributes["http.route"].slice(0, 128), method: attributes["http.request.method"].slice(0, 10), responseStatus: attributes["http.response.status_code"] } : {}),
        expiresAt: new Date(startedAt.getTime() + 7 * 86400000) }];
    });
    if (!rows.length) { callback({ code: 0 }); return; }
    Span.bulkWrite(rows.map((row) => ({ updateOne: { filter: { _id: row._id }, update: { $setOnInsert: row }, upsert: true } })), { ordered: false, maxTimeMS: 3000 })
      .then(() => callback({ code: 0 }), () => callback({ code: 1 }));
  }
  shutdown() { return Promise.resolve(); }
}
module.exports = MongoTraceExporter;
