const { MongoMemoryReplSet } = require("mongodb-memory-server");

module.exports = async function globalSetup() {
  // A single-node replica set (not a plain MongoMemoryServer) — the app uses
  // Mongoose transactions (org+admin registration), and MongoDB only allows
  // transactions on a replica set / mongos, never on a standalone instance.
  // This also matches production, since Atlas clusters are replica sets.
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URI = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-access-secret";
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh-secret";
  process.env.NODE_ENV = "test";
  globalThis.__MONGOD__ = mongod;
};
