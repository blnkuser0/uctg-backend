// Runs once per Jest worker, before any test file (or tests/setup.ts) is
// required. Gives each worker its own database on the shared in-memory
// mongod instance from jest.globalSetup.js, so parallel test FILES never
// race on the same collections (duplicate-key errors, cross-file afterEach
// wipes, etc).
const workerId = process.env.JEST_WORKER_ID ?? "0";
const baseUri = (process.env.MONGO_URI ?? "").replace(/\/[^/?]*(\?.*)?$/, "");
process.env.MONGO_URI = `${baseUri}/ugnexa_test_w${workerId}`;
