import request from "supertest";
import { app } from "../src/server";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";
import { Channel } from "../src/models/Channel.model";
import { fixChannelDmIndex } from "../src/scripts/fix-channel-dm-index";

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { token: res.body.data.accessToken as string };
}

async function setup() {
  await createTestOrgAndAdmin({ organizationName: "Acme", name: "Ada Admin", email: "ada@acme.test", password: "supersecret1" });
  return login("ada@acme.test", "supersecret1");
}

const createGroup = (token: string, name: string) =>
  request(app).post("/api/channels").set("Authorization", `Bearer ${token}`).send({ name });

const createProject = (token: string, name: string) =>
  request(app).post("/api/projects").set("Authorization", `Bearer ${token}`).send({ name });

// Recreates the exact bug: a `sparse` unique index on {organizationId, dmKey} does NOT exclude
// documents where dmKey is explicitly `null` (only ones where it's entirely absent) — every
// group/project channel sets it to null, so the very first one created "claims" that null slot
// for the org and every later one collides. Puts the Channel collection back into that broken
// state so the regression test below is exercising the real historical shape, not a guess.
async function installTheOldBrokenIndex(): Promise<void> {
  await Channel.init(); // ensures the collection exists before we inspect/mutate its indexes
  const indexes = await Channel.collection.indexes();
  if (indexes.some((i) => i.name === "organizationId_1_dmKey_1_partial")) {
    await Channel.collection.dropIndex("organizationId_1_dmKey_1_partial");
  }
  if (!indexes.some((i) => i.name === "organizationId_1_dmKey_1")) {
    await Channel.collection.createIndex({ organizationId: 1, dmKey: 1 }, { unique: true, sparse: true, name: "organizationId_1_dmKey_1" });
  }
}

describe("Channel dmKey index — group/project creation must not collide on organizationId+null", () => {
  afterEach(async () => {
    // Leave the collection's indexes correct for every other test file sharing this worker's DB.
    await fixChannelDmIndex();
  });

  it("reproduces the historical bug when the old sparse (not partial) index is in place", async () => {
    await installTheOldBrokenIndex();
    const admin = await setup();

    const first = await createGroup(admin.token, "First Group");
    expect(first.status).toBe(201);

    // This is the exact failure users hit: the second non-DM channel in the org.
    const second = await createGroup(admin.token, "Second Group");
    expect(second.status).toBe(500);
    expect(second.body.message).toMatch(/E11000|duplicate key/i);
  });

  it("fixChannelDmIndex() repairs a database that has the old index, without touching existing data", async () => {
    await installTheOldBrokenIndex();
    const admin = await setup();
    const existing = await createGroup(admin.token, "Existing Group");
    expect(existing.status).toBe(201);

    const result = await fixChannelDmIndex();
    expect(result.dropped).toBe(true);

    const indexNames = (await Channel.collection.indexes()).map((i) => i.name);
    expect(indexNames).not.toContain("organizationId_1_dmKey_1");
    expect(indexNames).toContain("organizationId_1_dmKey_1_partial");

    // The pre-existing group is untouched, and creating another now works.
    const stillThere = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    expect(stillThere.body.data.some((c: { name: string }) => c.name === "Existing Group")).toBe(true);

    const after = await createGroup(admin.token, "After Fix");
    expect(after.status).toBe(201);
  });

  it("running the fix twice is a no-op the second time", async () => {
    await installTheOldBrokenIndex();
    expect((await fixChannelDmIndex()).dropped).toBe(true);
    expect((await fixChannelDmIndex()).dropped).toBe(false);
  });

  it("on a healthy (already-fixed) database: several groups, and a project on top of them, all create fine in the same org", async () => {
    const admin = await setup();

    expect((await createGroup(admin.token, "Group A")).status).toBe(201);
    expect((await createGroup(admin.token, "Group B")).status).toBe(201);
    expect((await createGroup(admin.token, "Group C")).status).toBe(201);
    expect((await createProject(admin.token, "Project One")).status).toBe(201);
    expect((await createProject(admin.token, "Project Two")).status).toBe(201);

    const list = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    expect(list.body.data.filter((c: { type: string }) => c.type === "group")).toHaveLength(3);
    expect(list.body.data.filter((c: { type: string }) => c.type === "project")).toHaveLength(2);
  });

  it("real DMs are still unique per pair — the partial index didn't just stop enforcing anything", async () => {
    await createTestOrgAndAdmin({ organizationName: "Acme2", name: "Ada", email: "ada2@acme.test", password: "supersecret1" });
    const admin = await login("ada2@acme.test", "supersecret1");
    const role = await request(app).post("/api/roles").set("Authorization", `Bearer ${admin.token}`).send({ name: "Member", permissions: [] });
    const created = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Mona", email: "mona2@acme.test", password: "supersecret2", roleId: role.body.data.id });
    const memberId = created.body.data.id as string;

    const first = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: memberId });
    const second = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: memberId });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // The upsert-based getOrCreateDm returns the SAME channel both times, not a duplicate.
    expect(second.body.data._id).toBe(first.body.data._id);
  });
});
