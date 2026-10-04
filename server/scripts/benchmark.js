const { startDemo } = require("./localDemo");
async function main() {
  const demo = await startDemo({ port: 5052 });
  const Signup = require("../models/Signup");
  const Waitlist = require("../models/Waitlist");
  const Founder = require("../models/Founder");
  const generateToken = require("../utils/generateToken");
  try {
    const waitlist = await Waitlist.findOne(); const owner = await Founder.findOne();
    const headers = { Authorization: `Bearer ${generateToken(owner._id)}` };
    const measurements = [];
    for (const records of [1000, 10000]) {
      await Signup.deleteMany({});
      await Signup.insertMany(Array.from({ length: records }, (_, i) => ({ waitlistId: waitlist._id, email: `bench${i}@example.com`, refCode: `BENCH${i}`,
        basePosition: i + 1, currentPosition: i + 1, verificationState: "verified" })));
      const url = `http://127.0.0.1:5052/api/waitlists/${waitlist._id}/stats?limit=50`;
      await fetch(url, { headers }).then((r) => r.text());
      const timings = []; let bytes; let rows;
      for (let i = 0; i < 10; i++) {
        const started = performance.now(); const response = await fetch(url, { headers }); const body = await response.text();
        if (!response.ok) throw new Error("Benchmark request failed");
        timings.push(performance.now() - started); bytes = Buffer.byteLength(body); rows = JSON.parse(body).signups.length;
      }
      timings.sort((a, b) => a - b);
      measurements.push({ records, returnedRows: rows, responseBytes: bytes, p50Ms: Math.round(timings[4]), p95Ms: Math.round(timings[9]) });
    }
    console.log(JSON.stringify({ node: process.version, database: "isolated local MongoDB replica set", samples: 10, measurements }, null, 2));
  } finally { await demo.shutdown(); }
}
main().catch(() => { console.error("Local benchmark failed"); process.exitCode = 1; });
