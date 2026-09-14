import request from "supertest";
import { app } from "../src/server";

const ADMIN = {
  organizationName: "Fitout Co",
  name: "Ada Admin",
  email: "ada@ugnexa.test",
  password: "supersecret1",
};

async function loginWithId(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { token: res.body.data.accessToken as string, userId: res.body.data.user.id as string };
}

async function createRole(adminToken: string, name: string, permissions: string[] = []) {
  const res = await request(app).post("/api/roles").set("Authorization", `Bearer ${adminToken}`).send({ name, permissions });
  return res.body.data.id as string;
}

async function createUser(adminToken: string, roleId: string, name: string, email: string, password: string) {
  await request(app).post("/api/users").set("Authorization", `Bearer ${adminToken}`).send({ name, email, password, roleId });
  return loginWithId(email, password);
}

async function setup() {
  await request(app).post("/api/auth/register").send(ADMIN);
  const admin = await loginWithId(ADMIN.email, ADMIN.password);

  const roleId = await createRole(admin.token, "Member");
  const member = await createUser(admin.token, roleId, "Mona Member", "mona@ugnexa.test", "supersecret2");

  return { admin, member };
}

describe("Profile settings", () => {
  it("lets a user rename themselves", async () => {
    const { member } = await setup();
    const res = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${member.token}`)
      .send({ name: "Mona Updated" });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Mona Updated");
  });

  it("uploads an avatar image and sets avatarUrl", async () => {
    const { member } = await setup();
    const res = await request(app)
      .post("/api/auth/me/avatar")
      .set("Authorization", `Bearer ${member.token}`)
      .attach("avatar", Buffer.from("fake-image-bytes"), "avatar.png");
    expect(res.status).toBe(200);
    expect(res.body.data.avatarUrl).toMatch(/^http/);
  });

  it("changes password, requiring the correct current password, and lets the new one log in", async () => {
    const { member } = await setup();

    const wrongCurrent = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${member.token}`)
      .send({ currentPassword: "wrong-password", newPassword: "brandnewpass1" });
    expect(wrongCurrent.status).toBe(400);

    const changed = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${member.token}`)
      .send({ currentPassword: "supersecret2", newPassword: "brandnewpass1" });
    expect(changed.status).toBe(200);

    const oldLoginFails = await request(app).post("/api/auth/login").send({ email: "mona@ugnexa.test", password: "supersecret2" });
    expect(oldLoginFails.status).toBe(401);

    const newLoginWorks = await request(app).post("/api/auth/login").send({ email: "mona@ugnexa.test", password: "brandnewpass1" });
    expect(newLoginWorks.status).toBe(200);
  });
});

describe("Organization settings", () => {
  it("lets anyone view the organization, but only org.manage holders rename it", async () => {
    const { admin, member } = await setup();

    const viewRes = await request(app).get("/api/organization").set("Authorization", `Bearer ${member.token}`);
    expect(viewRes.status).toBe(200);
    expect(viewRes.body.data.name).toBe(ADMIN.organizationName);

    const blockedRename = await request(app)
      .patch("/api/organization")
      .set("Authorization", `Bearer ${member.token}`)
      .send({ name: "Hijacked Co" });
    expect(blockedRename.status).toBe(403);

    const allowedRename = await request(app)
      .patch("/api/organization")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Renamed Fitout Co" });
    expect(allowedRename.status).toBe(200);
    expect(allowedRename.body.data.name).toBe("Renamed Fitout Co");
  });
});
