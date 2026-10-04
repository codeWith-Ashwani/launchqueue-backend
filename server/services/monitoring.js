const crypto = require("node:crypto");
const mongoose = require("mongoose");
const Batch = require("../models/MonitoringBatch");
const pending = [], buffer = new Map();
let timer, flushing, dropped = 0, lastPersistedAt = null;
function enabled() { return process.env.MONITORING_ENABLED === "true" || (process.env.NODE_ENV !== "test" && process.env.MONITORING_ENABLED !== "false"); }
const bounds = {
  http: [50, 100, 250, 500, 1000, 2000, 5000, 10000, 40000, Infinity],
  operation: [50, 100, 250, 500, 1000, 2000, 5000, 10000, 40000, Infinity],
  LCP: [100, 500, 1000, 2000, 2500, 4000, 8000, Infinity],
  INP: [50, 100, 200, 500, 1000, 2000, Infinity], CLS: [0, 0.01, 0.1, 0.25, 0.5, 1, 5, Infinity],
};
function threshold(name, label) { return ({ LCP: 2500, INP: 200, CLS: 0.1 })[name] ?? (label.includes("/waitlists/design") || label === "ai.design" ? 40000 : 2000); }
function capture(name, label, value, failed = false) {
  if (!enabled() || !bounds[name] || !Number.isFinite(value) || value < 0 || typeof label !== "string" || label.length > 160) return;
  const key = `${name} ${label}`;
  if (!buffer.has(key)) {
    if (buffer.size >= 256) { dropped++; return; }
    buffer.set(key, { name, label, count: 0, failed: 0, good: 0, total: 0, buckets: bounds[name].map(() => 0) });
  }
  const entry = buffer.get(key); entry.count++; entry.failed += Number(failed); entry.good += Number(value <= threshold(name, label)); entry.total += value;
  entry.buckets[bounds[name].findIndex((bound) => value <= bound)]++;
}
function status() { return { enabled: enabled(), retentionDays: 7, bufferedLabels: buffer.size, pendingBatches: pending.length, droppedObservations: dropped, lastPersistedAt }; }
async function flush() {
  if (flushing || !enabled()) return flushing;
  if (buffer.size) {
    if (pending.length >= 8) dropped += [...buffer.values()].reduce((sum, row) => sum + row.count, 0);
    else pending.push({ _id: crypto.randomUUID(), capturedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400000), entries: [...buffer.values()] });
    buffer.clear();
  }
  if (mongoose.connection.readyState !== 1) return;
  flushing = (async () => {
    while (pending.length) {
      const batch = pending[0];
      try {
        await Batch.updateOne({ _id: batch._id }, { $setOnInsert: batch }, { upsert: true, maxTimeMS: 3000 });
        pending.shift(); lastPersistedAt = new Date();
      } catch { break; }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}
function start() { if (!enabled() || timer) return; timer = setInterval(() => { void flush(); }, 10000); timer.unref(); }
async function stop() { clearInterval(timer); timer = null; await flush(); await flush(); }
function percentile(buckets, cuts, count, p) {
  let total = 0;
  for (let i = 0; i < buckets.length; i++) { total += buckets[i]; if (total >= Math.ceil(count * p)) return Number.isFinite(cuts[i]) ? cuts[i] : null; }
  return null;
}
async function report(hours) {
  await flush();
  const rows = await Batch.aggregate([{ $match: { capturedAt: { $gte: new Date(Date.now() - hours * 3600000) } } }, { $unwind: "$entries" },
    { $group: { _id: { name: "$entries.name", label: "$entries.label" }, count: { $sum: "$entries.count" }, failed: { $sum: "$entries.failed" }, good: { $sum: "$entries.good" }, total: { $sum: "$entries.total" }, histograms: { $push: "$entries.buckets" } } },
  ]).allowDiskUse(true).option({ maxTimeMS: 5000 });
  const series = rows.map((row) => {
    const { name, label } = row._id;
    const histogram = bounds[name].map((_, i) => row.histograms.reduce((sum, buckets) => sum + (buckets[i] || 0), 0));
    const target = name === "http" || name === "operation" ? 0.95 : 0.75, goodRate = row.good / row.count;
    return { name, label, count: row.count, failures: row.failed, goodRate, threshold: threshold(name, label), targetGoodRate: target,
      mean: row.total / row.count, p75UpperBound: percentile(histogram, bounds[name], row.count, 0.75), p95UpperBound: percentile(histogram, bounds[name], row.count, 0.95),
      availability: name === "http" ? 1 - row.failed / row.count : null,
      status: row.count < 20 ? "warming" : goodRate < target || (name === "http" && 1 - row.failed / row.count < 0.99) ? "breached" : "met" };
  }).sort((a, b) => a.label.localeCompare(b.label));
  return { windowHours: hours, storage: status(), objectives: { observedHttpAvailability: 0.99, httpLatencyGoodRate: 0.95, webVitalsGoodRate: 0.75,
    minimumObservations: 20, percentiles: "histogram upper bounds; null means above the largest finite bucket", population: "sampled observations, including updates; not unique visitors or external uptime" }, series };
}
module.exports = { enabled, capture, status, flush, start, stop, report };
