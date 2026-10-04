const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { startDemo } = require("../localDemo");

async function main() {
  const smoke = process.argv.includes("--smoke");
  const stress = process.argv.includes("--stress");
  const referrals = process.argv.includes("--referrals");
  const binary = process.env.K6_BINARY || "k6";
  const budget = Number(process.env.PERFORMANCE_P95_MS || 2000);
  if (!Number.isFinite(budget) || budget <= 0) throw new Error("Invalid latency budget");
  const outputDir = path.resolve(__dirname, "../../../docs/performance");
  await fs.mkdir(outputDir, { recursive: true });
  const demo = await startDemo({ port: 0, monitoring: true });
  const Signup = require("../../models/Signup");
  const Waitlist = require("../../models/Waitlist");
  const Founder = require("../../models/Founder");
  const generateToken = require("../../utils/generateToken");
  const measurements = [];
  let failed = false;
  try {
    const owner = await Founder.findOne({ email: "demo@example.com" });
    const waitlist = await Waitlist.findOne({ founderId: owner._id });
    const url = `http://127.0.0.1:${demo.server.address().port}/api/waitlists/${waitlist._id}/stats?limit=50`;
    const token = generateToken(owner._id);
    for (const records of smoke ? [1000] : stress || referrals ? [50000] : [1000, 10000, 50000]) {
      await Signup.deleteMany({ waitlistId: waitlist._id });
      for (let offset = 0; offset < records; offset += 1000) {
        await Signup.insertMany(Array.from({ length: Math.min(1000, records - offset) }, (_, i) => ({
          waitlistId: waitlist._id, email: `bench${offset + i}@example.com`, refCode: `BENCH${offset + i}`,
          basePosition: offset + i + 1, currentPosition: offset + i + 1, verificationState: "verified",
          ...(referrals ? { referredBy: offset + i >= 10 ? `BENCH${(offset + i) % 10}` : null, referralCount: offset + i < 10 ? (records - 10) / 10 : 0 } : {}),
        })));
      }
      const warmup = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      await warmup.arrayBuffer();
      if (!warmup.ok) throw new Error("Fixture warmup failed");
      if (records === 50000) {
        const { rankPipeline, pagePipeline } = require("../../services/ranking");
        const before = await Signup.aggregate([...rankPipeline(waitlist._id), { $skip: 0 }, { $limit: 50 }]).allowDiskUse(true).explain("executionStats");
        const after = await Signup.aggregate(pagePipeline(waitlist._id, 1, 50)).allowDiskUse(true).explain("executionStats");
        const summarize = (explain) => {
          const cursor = explain.stages.find((stage) => stage.$cursor).$cursor;
          return { examined: cursor.executionStats.totalDocsExamined, campaignIndexUsed: JSON.stringify(cursor.queryPlanner.winningPlan).includes("IXSCAN"),
            stages: explain.stages.map((stage) => ({ name: Object.keys(stage)[0], returned: stage.nReturned, timeEstimateMs: stage.executionTimeMillisEstimate,
              ...(stage.$sort ? { retainedRows: Number(stage.$sort.limit || records), usedDisk: stage.usedDisk, bytesSorted: stage.totalDataSizeSortedBytesEstimate } : {}) })) };
        };
        await fs.writeFile(path.join(outputDir, "ranking-explain.json"), JSON.stringify({ records, before: summarize(before), after: summarize(after) }, null, 2));
      }
      for (const vus of smoke ? [5] : stress || referrals ? [10] : [1, 5, 10]) {
        const output = path.join(outputDir, `stats-${referrals ? "referrals-" : ""}${records}-${vus}.json`);
        // Pass only runtime necessities and this synthetic session to the load generator.
        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|Path|SYSTEMROOT|SystemRoot|TEMP|TMP|HOME|USERPROFILE)$/.test(key)));
        Object.assign(env, { K6_NO_USAGE_REPORT: "true", PERFORMANCE_URL: url, PERFORMANCE_TOKEN: token,
          PERFORMANCE_RECORDS: String(records), PERFORMANCE_VUS: String(vus), PERFORMANCE_ITERATIONS: smoke ? "20" : "50",
          PERFORMANCE_P95_MS: String(budget), PERFORMANCE_OUTPUT: output, PERFORMANCE_REFERRALS: String(referrals) });
        const code = await new Promise((resolve, reject) => {
          const child = spawn(binary, ["run", "--quiet", path.join(__dirname, "stats.mjs")], { env, stdio: "inherit", windowsHide: true });
          child.once("error", reject); child.once("exit", resolve);
        });
        const result = JSON.parse(await fs.readFile(output, "utf8"));
        const metric = (name) => result.metrics[name]?.values || {};
        measurements.push({ records, vus, requests: metric("http_reqs").count, p50Ms: metric("http_req_duration")["p(50)"],
          p95Ms: metric("http_req_duration")["p(95)"], requestsPerSecond: metric("http_reqs").rate,
          errorRate: metric("http_req_failed").rate, checkRate: metric("checks").rate,
          returnedRows: metric("returned_rows").med, responseBytes: metric("response_bytes").med, passed: code === 0 });
        if (code !== 0) failed = true;
      }
    }
    const report = { measuredAt: new Date().toISOString(), node: process.version, k6: "2.3.0", environment: "isolated local MongoDB replica set; warm cache; closed workload; persistent monitoring enabled",
      referrals, budgets: { p95Ms: budget, errorRate: 0, checkRate: 1 }, measurements };
    await fs.writeFile(path.join(outputDir, referrals ? "report-referrals.json" : "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (failed) process.exitCode = 1;
  } finally { await demo.shutdown(); }
}
main().catch(() => { console.error("Isolated performance run failed; check that k6 is installed and the fixture can start"); process.exitCode = 1; });
