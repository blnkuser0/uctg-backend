import request from "supertest";
import { app } from "../src/server";

const ADMIN = { name: "Ada Admin", email: "ada@ugnexa.test", password: "supersecret1" };
const MEMBER = { name: "Mona Member", email: "mona@ugnexa.test", password: "supersecret2", role: "member" as const };

async function loginAsAdmin() {
  await request(app).post("/api/auth/register").send(ADMIN);
  const res = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
  return res.body.data.accessToken as string;
}

describe("User provisioning", () => {
  it("lets an admin create a member account", async () => {
    const adminToken = await loginAsAdmin();
    const res = await request(app).post("/api/users").set("Authorization", `Bearer ${adminToken}`).send(MEMBER);

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe("member");
    expect(res.body.data.email).toBe(MEMBER.email);
  });

  it("blocks a member from creating another user", async () => {
    const adminToken = await loginAsAdmin();
    await request(app).post("/api/users").set("Authorization", `Bearer ${adminToken}`).send(MEMBER);

    const memberLogin = await request(app).post("/api/auth/login").send({ email: MEMBER.email, password: MEMBER.password });
    const memberToken = memberLogin.body.data.accessToken;

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "X", email: "x@ugnexa.test", password: "password123", role: "member" });

    expect(res.status).toBe(403);
  });

  it("lists users for any authenticated user", async () => {
    const adminToken = await loginAsAdmin();
    await request(app).post("/api/users").set("Authorization", `Bearer ${adminToken}`).send(MEMBER);

    const res = await request(app).get("/api/users").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });

  it("deactivates a user and blocks further logins", async () => {
    const adminToken = await loginAsAdmin();
    const created = await request(app).post("/api/users").set("Authorization", `Bearer ${adminToken}`).send(MEMBER);
    const userId = created.body.data.id;

    const deactivateRes = await request(app).delete(`/api/users/${userId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(deactivateRes.status).toBe(200);

    const loginRes = await request(app).post("/api/auth/login").send({ email: MEMBER.email, password: MEMBER.password });
    expect(loginRes.status).toBe(403);
  });
});
