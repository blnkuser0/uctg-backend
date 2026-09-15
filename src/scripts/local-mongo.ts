import path from "path";
import { MongoMemoryReplSet } from "mongodb-memory-server";

async function start() {
  const mongo = await MongoMemoryReplSet.create({
    instanceOpts: [{
      dbPath: path.resolve(process.cwd(), ".local", "mongodb-replset"),
      port: 27017,
    }],
    replSet: {
      count: 1,
      dbName: "ugnexa-catalyst",
      ip: "127.0.0.1",
      name: "ugnexa-dev",
      storageEngine: "wiredTiger",
    },
  });

  process.stdout.write(`MongoDB replica set is listening at ${mongo.getUri("ugnexa-catalyst")}\n`);
}

void start().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
