// Local-only fixture: owns an ephemeral database and captures email instead of using SMTP.
async function startDemo({ port = 5051, clientUrl = "http://localhost:5173", monitoring = false } = {}) {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "local-demo-signing-key-not-for-production";
  process.env.CLIENT_URL = clientUrl;
  process.env.EMAIL_DELIVERY_MODE = "inline";
  process.env.OTEL_ENABLED = "false";
  process.env.MONITORING_ENABLED = String(monitoring);
  delete process.env.REDIS_URL;
  const { MongoMemoryReplSet } = require("mongodb-memory-server");
  const mongoose = require("mongoose");
  const bcrypt = require("bcryptjs");
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 },
    binary: { downloadDir: require("path").resolve(__dirname, "../node_modules/.cache/mongodb-memory-server") } });
  await mongoose.connect(mongo.getUri());
  const inbox = [];
  require.cache[require.resolve("../utils/sendEmail")] = { exports: async (message) => { inbox.push(message); } };
  const app = require("../index");
  require("../services/monitoring").start();
  const Founder = require("../models/Founder");
  const Waitlist = require("../models/Waitlist");
  const Signup = require("../models/Signup");
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  const seed = async () => {
    for (const model of Object.values(mongoose.models)) await model.deleteMany({});
    inbox.length = 0;
    const founder = await Founder.create({ email: "demo@example.com", name: "Demo Founder", password: await bcrypt.hash("DemoPassword123!", 10), plan: "pro" });
    await Founder.create({ email: "admin@example.com", name: "Demo Admin", password: await bcrypt.hash("DemoAdmin123!", 10), adminApproved: true });
    const waitlist = await Waitlist.create({ founderId: founder._id, name: "Interview Demo", slug: "interview-demo", description: "A focused workspace for the next generation of independent makers.", accentColor: "#7663b9", discoverable: true, signupSequence: 120 });
    await Signup.insertMany(Array.from({ length: 120 }, (_, i) => ({ waitlistId: waitlist._id, email: `subscriber${i}@example.com`, refCode: `DEMO${i}`,
      basePosition: i + 1, currentPosition: i + 1, initialPosition: i + 1, verificationState: "verified", verifiedAt: new Date() })));
  };
  await seed();
  app.get("/__demo/inbox", (req, res) => res.json({ emails: inbox.filter((m) => !req.query.to || m.to === req.query.to) }));
  app.post("/__demo/reset", async (_req, res) => { await seed(); res.json({ reset: true }); });
  const server = await new Promise((resolve) => { const listener = app.listen(port, "127.0.0.1", () => resolve(listener)); });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return; stopping = true;
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    await require("../services/telemetry").stopTelemetry();
    await mongoose.disconnect(); await mongo.stop();
  };
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
  return { server, mongo, shutdown };
}
if (require.main === module) startDemo().then(() => console.log("Local demo API: http://localhost:5051 | demo@example.com / DemoPassword123! | Captured mail: /__demo/inbox"))
  .catch(() => { console.error("Unable to start isolated local demo"); process.exitCode = 1; });
module.exports = { startDemo };
