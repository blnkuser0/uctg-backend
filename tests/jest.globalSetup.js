const { MongoMemoryServer } = require("mongodb-memory-server");

module.exports = async function globalSetup() {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-access-secret";
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh-secret";
  process.env.NODE_ENV = "test";
  globalThis.__MONGOD__ = mongod;
};
