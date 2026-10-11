import dns from "dns";

// Same fix as server.ts / bootstrap-platform.ts — Node's own DNS resolver can pick a broken
// server on this machine/network, breaking `mongodb+srv://` SRV lookups even when the OS
// resolver works fine. Must run before connectDB()'s mongoose.connect().
dns.setServers(["8.8.8.8", "1.1.1.1"]);
dns.setDefaultResultOrder("ipv4first");

import { connectDB, disconnectDB } from "../config/db";
import { Accomplishment } from "../models/Accomplishment.model";

/**
 * One-time, idempotent migration for the old single `text` field -> the new
 * `accomplishment`/`blockers`/`inProgress` split. Any record that still has the
 * old `text` field (and hasn't already been migrated) gets `accomplishment` set
 * to its old text, with `blockers`/`inProgress` left blank. Safe to run more
 * than once — already-migrated documents (no `text` field left) are skipped.
 */
export async function migrateAccomplishmentSections(): Promise<{ migrated: number }> {
  const result = await Accomplishment.collection.updateMany({ text: { $exists: true } }, [
    { $set: { accomplishment: "$text", blockers: "", inProgress: "" } },
    { $unset: "text" },
  ]);
  return { migrated: result.modifiedCount };
}

async function start() {
  await connectDB();
  const { migrated } = await migrateAccomplishmentSections();
  process.stdout.write(`Migrated ${migrated} accomplishment record(s) to the accomplishment/blockers/inProgress split.\n`);
  await disconnectDB();
}

if (require.main === module) {
  void start().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
