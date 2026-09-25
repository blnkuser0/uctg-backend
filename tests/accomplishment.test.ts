import request from "supertest";
import { app } from "../src/server";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";

const ADMIN = {
  organizationName: "Fitout Co",
  name: "Ada Admin",
  email: "ada@ugnexa.test",
  password: "supersecret1",
};

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.data.accessToken as string;
}

async function createRole(adminToken: string, name: string, permissions: string[]) {
  const res = await request(app).post("/api/roles").set("Authorization", `Bearer ${adminToken}`).send({ name, permissions });
  return res.body.data.id as string;
}

async function createUserWithRole(adminToken: string, roleId: string, name: string, email: string, password: string) {
  const res = await request(app).post("/api/users").set("Authorization", `Bearer ${adminToken}`).send({ name, email, password, roleId });
  return { token: await login(email, password), userId: res.body.data.id as string };
}

async function setup() {
  await createTestOrgAndAdmin(ADMIN);
  // Ada (the org creator) gets the seeded Admin role, which carries ALL_PERMISSIONS —
  // including ACCOMPLISHMENTS_MANAGE — so she doubles as the "holder" account.
  const adminToken = await login(ADMIN.email, ADMIN.password);

  const holderRoleId = await createRole(adminToken, "Team Lead", ["accomplishments.manage"]);
  const holder = await createUserWithRole(adminToken, holderRoleId, "Leo Lead", "leo@ugnexa.test", "supersecret2");

  const plainRoleId = await createRole(adminToken, "Member", []);
  const plain = await createUserWithRole(adminToken, plainRoleId, "Mona Member", "mona@ugnexa.test", "supersecret3");

  return { adminToken, holderToken: holder.token, holderId: holder.userId, plainToken: plain.token };
}

describe("Daily accomplishments", () => {
  it("blocks logging or viewing without the permission", async () => {
    const { plainToken } = await setup();

    const create = await request(app)
      .post("/api/accomplishments")
      .set("Authorization", `Bearer ${plainToken}`)
      .send({ date: "2025-06-01", text: "Fixed the login bug" });
    expect(create.status).toBe(403);

    const mine = await request(app).get("/api/accomplishments/mine").set("Authorization", `Bearer ${plainToken}`);
    expect(mine.status).toBe(403);

    const all = await request(app).get("/api/accomplishments").set("Authorization", `Bearer ${plainToken}`);
    expect(all.status).toBe(403);
  });

  it("lets a permission holder log their own entry and read it back", async () => {
    const { holderToken } = await setup();

    const created = await request(app)
      .post("/api/accomplishments")
      .set("Authorization", `Bearer ${holderToken}`)
      .send({ date: "2025-06-02", text: "Shipped the reporting dashboard" });
    expect(created.status).toBe(201);
    expect(created.body.data.date).toBe("2025-06-02");
    expect(created.body.data.text).toBe("Shipped the reporting dashboard");

    const mine = await request(app).get("/api/accomplishments/mine").set("Authorization", `Bearer ${holderToken}`);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]._id).toBe(created.body.data._id);
  });

  it("rejects an entry with no text or a malformed date", async () => {
    const { holderToken } = await setup();

    const blank = await request(app)
      .post("/api/accomplishments")
      .set("Authorization", `Bearer ${holderToken}`)
      .send({ date: "2025-06-02", text: "   " });
    expect(blank.status).toBe(400);

    const badDate = await request(app)
      .post("/api/accomplishments")
      .set("Authorization", `Bearer ${holderToken}`)
      .send({ date: "06/02/2025", text: "Did something" });
    expect(badDate.status).toBe(400);
  });

  it("lets a holder view everyone's entries, but keeps 'mine' scoped to their own", async () => {
    const { adminToken, holderToken } = await setup();

    await request(app).post("/api/accomplishments").set("Authorization", `Bearer ${adminToken}`).send({ date: "2025-06-03", text: "Reviewed PRs" });
    await request(app).post("/api/accomplishments").set("Authorization", `Bearer ${holderToken}`).send({ date: "2025-06-03", text: "Onboarded a new hire" });

    const holderMine = await request(app).get("/api/accomplishments/mine").set("Authorization", `Bearer ${holderToken}`);
    expect(holderMine.body.data).toHaveLength(1);
    expect(holderMine.body.data[0].text).toBe("Onboarded a new hire");

    const teamWide = await request(app).get("/api/accomplishments").set("Authorization", `Bearer ${holderToken}`);
    expect(teamWide.body.data).toHaveLength(2);
    // listAll populates the author so a report can show whose entry is whose.
    expect(teamWide.body.data.map((e: { userId: { name: string } }) => e.userId.name).sort()).toEqual(["Ada Admin", "Leo Lead"]);
  });

  it("filters the team-wide view by date range and by user", async () => {
    const { adminToken, holderToken, holderId } = await setup();

    await request(app).post("/api/accomplishments").set("Authorization", `Bearer ${holderToken}`).send({ date: "2025-06-01", text: "Old entry" });
    await request(app).post("/api/accomplishments").set("Authorization", `Bearer ${holderToken}`).send({ date: "2025-06-10", text: "Recent entry" });
    await request(app).post("/api/accomplishments").set("Authorization", `Bearer ${adminToken}`).send({ date: "2025-06-10", text: "Ada's own entry" });

    const ranged = await request(app)
      .get("/api/accomplishments")
      .query({ from: "2025-06-05", to: "2025-06-15" })
      .set("Authorization", `Bearer ${holderToken}`);
    expect(ranged.body.data).toHaveLength(2);
    expect(ranged.body.data.map((e: { text: string }) => e.text).sort()).toEqual(["Ada's own entry", "Recent entry"]);

    const byUser = await request(app)
      .get("/api/accomplishments")
      .query({ userId: holderId })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byUser.body.data).toHaveLength(2);
    expect(byUser.body.data.every((e: { userId: { _id: string } }) => e.userId._id === holderId)).toBe(true);
  });

  it("lets the author edit or delete their own entry, but not someone else's", async () => {
    const { adminToken, holderToken } = await setup();

    const created = await request(app)
      .post("/api/accomplishments")
      .set("Authorization", `Bearer ${holderToken}`)
      .send({ date: "2025-06-04", text: "Draft version" });
    const id = created.body.data._id;

    const updated = await request(app)
      .patch(`/api/accomplishments/${id}`)
      .set("Authorization", `Bearer ${holderToken}`)
      .send({ text: "Final version" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.text).toBe("Final version");

    // Ada also holds the permission (team-wide view) but didn't author this entry.
    const otherEdit = await request(app)
      .patch(`/api/accomplishments/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ text: "Hijacked" });
    expect(otherEdit.status).toBe(404);

    const otherDelete = await request(app).delete(`/api/accomplishments/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(otherDelete.status).toBe(404);

    const ownDelete = await request(app).delete(`/api/accomplishments/${id}`).set("Authorization", `Bearer ${holderToken}`);
    expect(ownDelete.status).toBe(200);

    const mineAfter = await request(app).get("/api/accomplishments/mine").set("Authorization", `Bearer ${holderToken}`);
    expect(mineAfter.body.data).toHaveLength(0);
  });
});
