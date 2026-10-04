const mongoose = require("mongoose");
const { createRedis } = require("../config/redis");

async function startWorker(start) {
  require("dotenv").config();
  require("../utils/validateEnv")();
  const telemetry = require("../services/telemetry");
  telemetry.startTelemetry();
  if (!process.env.REDIS_URL) throw new Error("Worker requires REDIS_URL");
  const connection = createRedis("worker");
  try {
    await connection.connect();
    const [, policy] = await connection.config("GET", "maxmemory-policy");
    if (policy !== "noeviction") throw new Error("Queue Redis requires maxmemory-policy=noeviction");
    await mongoose.connect(process.env.MONGO_URI);
    require("../services/monitoring").start();
    const close = await start(connection);
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      await close();
      connection.disconnect();
      await telemetry.stopTelemetry();
      await mongoose.disconnect();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    return shutdown;
  } catch (err) {
    connection.disconnect();
    await telemetry.stopTelemetry();
    await mongoose.disconnect();
    throw err;
  }
}
module.exports = { startWorker };
