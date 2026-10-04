const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

let mongoServer;

async function connectDb() {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  // Ensure unique indexes exist before exercising concurrent writes.
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.init()),
  );
}

async function closeDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
}

async function clearDb() {
  if (mongoose.connection.readyState !== 0) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  }
}

function getDbUri() {
  if (!mongoServer) throw new Error("Test database has not started");
  return mongoServer.getUri();
}
module.exports = { connectDb, closeDb, clearDb, getDbUri };
