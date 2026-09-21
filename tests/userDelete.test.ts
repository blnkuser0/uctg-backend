import request from "supertest";
import { app } from "../src/server";
import { bootstrapPlatform } from "../src/scripts/bootstrap-platform";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";
import { User } from "../src/models/User.model";

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { res, token: res.body.data?.accessToken as string, userId: res.body.data?.user?.id as string };
}

async function setup() {
  await createTestOrgAndAdmin({ organizationName: "Acme", name: "Ada Admin", email: "ada@acme.test", password: "supersecret1" });
  const admin = await login("ada@acme.test", "supersecret1");
  const role = await request(app).post("/api/roles").set("Authorization", `Bearer ${admin.token}`).send({ name: "Member", permissions: [] });
  const roleId = role.body.data.id as string;

  const created = await request(app)
    .post("/api/users")
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ name: "Mona Member", email: "mona@acme.test", password: "supersecret2", roleId });
  const mona = await login("mona@acme.test", "supersecret2");
  return { admin, roleId, mona, monaId: created.body.data.id as string };
}

const del = (token: string, userId: string) =>
  request(app).delete(`/api/users/${userId}/permanent`).set("Authorization", `Bearer ${token}`);

describe("Deleting a user", () => {
  it("removes them from the org's user list and signs them out for good", async () => {
    const { admin, mona, monaId } = await setup();
    const card = await request(app).get("/api/users/me/id-card").set("Authorization", `Bearer ${mona.token}`);

    const res = await del(admin.token, monaId);
    expect(res.status).toBe(200);

    const list = await request(app).get("/api/users").set("Authorization", `Bearer ${admin.token}`);
    expect(list.body.data.map((u: { id: string }) => u.id)).not.toContain(monaId);
    const search = await request(app).get("/api/users/search?q=mona").set("Authorization", `Bearer ${admin.token}`);
    expect(search.body.data).toHaveLength(0);

    // Can't sign in, and the token they already held stops working.
    const relogin = await login("mona@acme.test", "supersecret2");
    expect(relogin.res.status).toBe(401);
    const stale = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${mona.token}`);
    expect(stale.status).toBe(403);

    // Their printed ID stops verifying.
    const verify = await request(app).get(`/api/public/verify/${card.body.data.verifyToken}`);
    expect(verify.status).toBe(404);
  });

  it("keeps the row (so history isn't orphaned) but frees the email for reuse", async () => {
    const { admin, roleId, monaId } = await setup();
    await del(admin.token, monaId);

    const row = await User.findById(monaId);
    expect(row).not.toBeNull();
    expect(row!.deletedAt).toBeInstanceOf(Date);
    expect(row!.isActive).toBe(false);
    expect(row!.name).toBe("Mona Member");
    expect(row!.email).not.toBe("mona@acme.test");

    const again = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ email: "mona@acme.test", password: "supersecret3", roleId });
    expect(again.status).toBe(201);
    expect((await login("mona@acme.test", "supersecret3")).res.status).toBe(200);
  });

  it("drops them from project membership", async () => {
    const { admin, monaId } = await setup();
    const project = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Website" });
    const projectId = project.body.data._id as string;
    const added = await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ userId: monaId });
    expect(added.body.data.memberIds).toContain(monaId);

    await del(admin.token, monaId);

    const after = await request(app).get(`/api/projects/${projectId}`).set("Authorization", `Bearer ${admin.token}`);
    expect(after.body.data.memberIds).not.toContain(monaId);
  });

  it("won't let you delete yourself", async () => {
    const { admin } = await setup();
    const res = await del(admin.token, admin.userId);
    expect(res.status).toBe(400);
    expect((await login("ada@acme.test", "supersecret1")).res.status).toBe(200);
  });

  it("only lets a user manager do it, and only inside their own org", async () => {
    const { mona, monaId } = await setup();
    await createTestOrgAndAdmin({ organizationName: "Other Co", name: "Olga", email: "olga@other.test", password: "supersecret1" });
    const olga = await login("olga@other.test", "supersecret1");

    const asMember = await del(mona.token, mona.userId);
    expect(asMember.status).toBe(403);
    const otherOrg = await del(olga.token, monaId);
    expect(otherOrg.status).toBe(404);
    expect((await login("mona@acme.test", "supersecret2")).res.status).toBe(200);
  });

  it("refuses to delete a Super Admin", async () => {
    await bootstrapPlatform({ email: "root@ugnexa.test", password: "supersecret1", name: "Root Admin" });
    const root = await login("root@ugnexa.test", "supersecret1");
    const other = await request(app)
      .post("/api/platform/users")
      .set("Authorization", `Bearer ${root.token}`)
      .send({ email: "dev@ugnexa.test", isDeveloper: true });
    expect(other.status).toBe(201);
    // Make a second Super Admin so the "not yourself" rule isn't what stops us.
    await User.updateOne({ email: "dev@ugnexa.test" }, { isSuperAdmin: true });
    const devId = other.body.data.id as string;

    const res = await del(root.token, devId);
    expect(res.status).toBe(403);
  });

  it("404s a user who is already deleted", async () => {
    const { admin, monaId } = await setup();
    expect((await del(admin.token, monaId)).status).toBe(200);
    expect((await del(admin.token, monaId)).status).toBe(404);
  });
});
