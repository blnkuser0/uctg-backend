import dns from "dns";

// Same fix as server.ts — Node's own DNS resolver can pick a broken server on
// this machine/network, breaking `mongodb+srv://` SRV lookups even when the
// OS resolver works fine. Must run before connectDB()'s mongoose.connect().
dns.setServers(["8.8.8.8", "1.1.1.1"]);
dns.setDefaultResultOrder("ipv4first");

import { connectDB, disconnectDB } from "../config/db";
import { Channel } from "../models/Channel.model";

const OLD_INDEX_NAME = "organizationId_1_dmKey_1";

/**
 * One-time repair for a real bug: the original `{organizationId, dmKey}` unique index used
 * `sparse: true`, which only excludes documents where a field is entirely MISSING — every
 * group/project channel has `dmKey` explicitly set to `null` (the schema default), so it was
 * NOT excluded, and the unique constraint collided the instant a second group or project
 * existed in an organization (every later attempt failed with a Mongo E11000 error). The current
 * Channel.model.ts now defines the correct index — a *partial* index scoped to actual (string)
 * dmKeys — under a different name (`organizationId_1_dmKey_1_partial`), but Mongoose's
 * autoIndex never drops an index it didn't create, so an already-running database keeps the
 * broken one forever unless something removes it. This does that removal, once.
 *
 * Idempotent — safe to run again; it's a no-op once the old index is gone.
 */
export async function fixChannelDmIndex(): Promise<{ dropped: boolean }> {
  // Ensures the collection (and Mongoose's own view of its indexes) actually exists first — on a
  // brand new database `channels` may not exist yet, and listing indexes on a nonexistent
  // collection throws rather than returning an empty list.
  await Channel.init();
  const indexes = await Channel.collection.indexes();
  const stale = indexes.find((index) => index.name === OLD_INDEX_NAME);

  if (!stale) {
    return { dropped: false };
  }

  await Channel.collection.dropIndex(OLD_INDEX_NAME);
  // Recreates every index declared in the current schema, including the fixed partial one —
  // same call Mongoose makes automatically on startup, just not deferred to "eventually".
  await Channel.syncIndexes();
  return { dropped: true };
}

async function start() {
  await connectDB();
  const result = await fixChannelDmIndex();

  if (result.dropped) {
    process.stdout.write(
      "Dropped the broken organizationId_1_dmKey_1 index and rebuilt Channel's indexes. " +
        "Creating a second group or project in an organization should now work.\n"
    );
  } else {
    process.stdout.write("No broken index found — nothing to do.\n");
  }

  await disconnectDB();
}

// Same import-vs-CLI guard as bootstrap-platform.ts: importing fixChannelDmIndex for a test
// must not also run the CLI entrypoint against a real MONGO_URI.
if (require.main === module) {
  void start().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
