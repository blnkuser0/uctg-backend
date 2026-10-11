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
      .send({ date: "2025-06-01", accomplishment: "Fixed the login bug" });
    expect(create.status).toBe(403);

    const mine = await request(app).get("/api/accomplishments/mine").set("Authorization", `Bearer ${plainToken}`);
    expect(mine.status).toBe(403);

    const all = await request(app).get("/api/accomplishments").set("Authorization", `Bearer ${plainToken}`);
    expect(all.status).toBe(403);
  });

  it("lets a permission holder log their own entry (accomplishment/blockers/in-progress) and read it back", async () => {
    const { holderToken } = await setup();

    const created = await request(app)
      .post("/api/accomplishments")
      .set("Authorization", `Bearer ${holderToken}`)
      .send({
        date: "2025-06-02",
        accomplishment: "Shipped the reporting dashboard",
        blockers: "Waiting on design review",
        inProgress: "Polishing the export flow",
      });
    expect(created.status).toBe(201);
    expect(created.body.data.date).toBe("2025-06-02");
    expect(created.body.data.accomplishment).toBe("Shipped the reporting dashboard");
    expect(created.body.data.blockers).toBe("Waiting on design review");
    expect(created.body.data.inProgress).toBe("Polishing the export flow");
    expect(created.body.data.attachments).toEqual([]);

    const mine = await request(app).get("/api/accomplishments/mine").set("Authorization", `Bearer ${holderToken}`);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]._id).toBe(created.body.data._id);
  });

  it("defaults blockers/inProgress to blank when omitted", async () => {
    const { holderToken } = await setup();

    const created = await request(app)
      .post("/api/accomplishments")
      .set("Authorization", `Bearer ${holderToken}`)
      .send({ date: "2025-06-02", accomplishment: "Just the accomplishment" });
    expect(created.status).toBe(201);
    expect(created.body.data.blockers).toBe("");
    expect(created.body.data.inProgress).toBe("");
  });

  it("rejects an entry with no accomplishment text or a malformed date", async () => {
    const { holderToken } = await setup();

    const blank = await request(app)
      .post("/api/accomplishments")
      .set("Authorization", `Bearer ${holderToken}`)
      .send({ date: "2025-06-02", accomplishment: "   " });
    expect(blank.status).toBe(400);

    const badDate = await request(app)
      .post("/api/accomplishments")
      .set("Authorization", `Bearer ${holderToken}`)
      .send({ date: "06/02/2025", accomplishment: "Did something" });
    expect(badDate.status).toBe(400);
  });

  it("lets a holder view everyone's entries, but keeps 'mine' scoped to their own", async () => {
    const { adminToken, holderToken } = await setup();

    await request(app)
      .post("/api/accomplishments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ date: "2025-06-03", accomplishment: "Reviewed PRs" });
    await request(app)
      .post("/api/accomplishments")
      .set("Authorization", `Bearer ${holderToken}`)
      .send({ date: "2025-06-03", accomplishment: "Onboarded a new hire" });

    const holderMine = await request(app).get("/api/accomplishments/mine").set("Authorization", `Bearer ${holderToken}`);
    expect(holderMine.body.data).toHaveLength(1);
    expect(holderMine.body.data[0].accomplishment).toBe("Onboarded a new hire");

    const teamWide = await request(app).get("/api/accomplishments").set("Authorization", `Bearer ${holderToken}`);
    expect(teamWide.body.data).toHaveLength(2);
    // listAll populates the author so a report can show whose entry is whose.
    expect(teamWide.body.data.map((e: { userId: { name: string } }) => e.userId.name).sort()).toEqual(["Ada Admin", "Leo Lead"]);
    // ...and their role, so the UI can show it automatically without a manual pick.
    const leoEntry = teamWide.body.data.find((e: { userId: { name: string } }) => e.userId.name === "Leo Lead");
    expect(leoEntry.userId.roleId.name).toBe("Team Lead");
  });

  it("filters the team-wide view by date range and by user", async () => {
    const { adminToken, holderToken, holderId } = await setup();

    await request(app).post("/api/accomplishments").set("Authorization", `Bearer ${holderToken}`).send({ date: "2025-06-01", accomplishment: "Old entry" });
    await request(app).post("/api/accomplishments").set("Authorization", `Bearer ${holderToken}`).send({ date: "2025-06-10", accomplishment: "Recent entry" });
    await request(app).post("/api/accomplishments").set("Authorization", `Bearer ${adminToken}`).send({ date: "2025-06-10", accomplishment: "Ada's own entry" });

    const ranged = await request(app)
      .get("/api/accomplishments")
      .query({ from: "2025-06-05", to: "2025-06-15" })
      .set("Authorization", `Bearer ${holderToken}`);
    expect(ranged.body.data).toHaveLength(2);
    expect(ranged.body.data.map((e: { accomplishment: string }) => e.accomplishment).sort()).toEqual(["Ada's own entry", "Recent entry"]);

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
      .send({ date: "2025-06-04", accomplishment: "Draft version" });
    const id = created.body.data._id;

    const updated = await request(app)
      .patch(`/api/accomplishments/${id}`)
      .set("Authorization", `Bearer ${holderToken}`)
      .send({ accomplishment: "Final version", blockers: "None" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.accomplishment).toBe("Final version");
    expect(updated.body.data.blockers).toBe("None");

    // Ada also holds the permission (team-wide view) but didn't author this entry.
    const otherEdit = await request(app)
      .patch(`/api/accomplishments/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ accomplishment: "Hijacked" });
    expect(otherEdit.status).toBe(404);

    const otherDelete = await request(app).delete(`/api/accomplishments/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(otherDelete.status).toBe(404);

    const ownDelete = await request(app).delete(`/api/accomplishments/${id}`).set("Authorization", `Bearer ${holderToken}`);
    expect(ownDelete.status).toBe(200);

    const mineAfter = await request(app).get("/api/accomplishments/mine").set("Authorization", `Bearer ${holderToken}`);
    expect(mineAfter.body.data).toHaveLength(0);
  });
});

describe("Accomplishment attachments", () => {
  async function createEntry(token: string) {
    const created = await request(app)
      .post("/api/accomplishments")
      .set("Authorization", `Bearer ${token}`)
      .send({ date: "2025-06-05", accomplishment: "Entry with files" });
    return created.body.data._id as string;
  }

  it("lets the owner attach a file to a specific section and tags it correctly", async () => {
    const { holderToken } = await setup();
    const id = await createEntry(holderToken);

    const res = await request(app)
      .post(`/api/accomplishments/${id}/attachments`)
      .set("Authorization", `Bearer ${holderToken}`)
      .field("section", "blockers")
      .attach("files", Buffer.from("hello world"), "blocker-screenshot.png");

    expect(res.status).toBe(201);
    expect(res.body.data.attachments).toHaveLength(1);
    expect(res.body.data.attachments[0].section).toBe("blockers");
    expect(res.body.data.attachments[0].originalName).toBe("blocker-screenshot.png");
  });

  it("rejects an attachment upload with no files or an invalid section", async () => {
    const { holderToken } = await setup();
    const id = await createEntry(holderToken);

    const noFiles = await request(app)
      .post(`/api/accomplishments/${id}/attachments`)
      .set("Authorization", `Bearer ${holderToken}`)
      .field("section", "accomplishment");
    expect(noFiles.status).toBe(400);

    const badSection = await request(app)
      .post(`/api/accomplishments/${id}/attachments`)
      .set("Authorization", `Bearer ${holderToken}`)
      .field("section", "lunch")
      .attach("files", Buffer.from("hello"), "note.txt");
    expect(badSection.status).toBe(400);
  });

  it("blocks attaching to or removing from someone else's entry", async () => {
    const { adminToken, holderToken } = await setup();
    const id = await createEntry(holderToken);

    const otherAttach = await request(app)
      .post(`/api/accomplishments/${id}/attachments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("section", "accomplishment")
      .attach("files", Buffer.from("hello"), "note.txt");
    expect(otherAttach.status).toBe(404);
  });

  it("lets the owner remove an attachment", async () => {
    const { holderToken } = await setup();
    const id = await createEntry(holderToken);

    const uploaded = await request(app)
      .post(`/api/accomplishments/${id}/attachments`)
      .set("Authorization", `Bearer ${holderToken}`)
      .field("section", "inProgress")
      .attach("files", Buffer.from("hello"), "progress-note.txt");
    const fileKey = uploaded.body.data.attachments[0].fileKey as string;

    const removed = await request(app)
      .delete(`/api/accomplishments/${id}/attachments/${encodeURIComponent(fileKey)}`)
      .set("Authorization", `Bearer ${holderToken}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data.attachments).toHaveLength(0);
  });
});
