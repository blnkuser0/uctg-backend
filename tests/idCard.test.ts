import request from "supertest";
import { app } from "../src/server";
import { bootstrapPlatform } from "../src/scripts/bootstrap-platform";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";
import { User } from "../src/models/User.model";

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { token: res.body.data.accessToken as string, userId: res.body.data.user.id as string };
}

async function createOrg(name: string, email: string) {
  await createTestOrgAndAdmin({ organizationName: name, name: `${name} Admin`, email, password: "supersecret1" });
  return login(email, "supersecret1");
}

async function createMember(adminToken: string, email: string, permissions: string[] = []) {
  const role = await request(app)
    .post("/api/roles")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: `Role ${email}`, permissions });
  await request(app)
    .post("/api/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Mona Member", email, password: "supersecret2", roleId: role.body.data.id });
  return login(email, "supersecret2");
}

describe("Employee ID cards", () => {
  // Numbers are allocated outside the org-creation transaction, so a retried
  // or aborted transaction can leave a gap — the guarantee is unique and
  // increasing, not gap-free.
  it("gives every new user a unique, increasing ID number and a private QR token", async () => {
    const admin = await createOrg("Acme", "admin@acme.test");
    const member = await createMember(admin.token, "mona@acme.test");

    const first = await request(app).get("/api/users/me/id-card").set("Authorization", `Bearer ${admin.token}`);
    const second = await request(app).get("/api/users/me/id-card").set("Authorization", `Bearer ${member.token}`);

    expect(first.status).toBe(200);
    const number = (card: { body: { data: { employeeId: string } } }) => Number(card.body.data.employeeId.slice(4));
    expect(first.body.data.employeeId).toMatch(/^UGX-\d{4}$/);
    expect(number(second)).toBeGreaterThan(number(first));
    expect(first.body.data.verifyToken).toMatch(/^[a-f\d]{32}$/);
    expect(first.body.data.verifyToken).not.toBe(second.body.data.verifyToken);
    expect(second.body.data.name).toBe("Mona Member");
    expect(second.body.data.organization).toBe("Acme");
  });

  it("backfills an ID for an account created before ID cards existed", async () => {
    const admin = await createOrg("Acme", "admin@acme.test");
    await User.collection.updateOne({ email: "admin@acme.test" }, { $unset: { employeeId: "", idToken: "" } });

    const res = await request(app).get("/api/users/me/id-card").set("Authorization", `Bearer ${admin.token}`);
    const again = await request(app).get("/api/users/me/id-card").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.employeeId).toMatch(/^UGX-\d{4}$/);
    // Stable across requests — a reprinted ID must keep the same QR.
    expect(again.body.data.verifyToken).toBe(res.body.data.verifyToken);
    expect(again.body.data.employeeId).toBe(res.body.data.employeeId);
  });

  it("only lets a user manager view a teammate's card, never a plain member or another org", async () => {
    const acme = await createOrg("Acme", "admin@acme.test");
    const other = await createOrg("Other Co", "admin@other.test");
    const plain = await createMember(acme.token, "plain@acme.test");

    const asPlain = await request(app).get(`/api/users/${acme.userId}/id-card`).set("Authorization", `Bearer ${plain.token}`);
    const asOtherOrgAdmin = await request(app)
      .get(`/api/users/${plain.userId}/id-card`)
      .set("Authorization", `Bearer ${other.token}`);
    const asOwnOrgAdmin = await request(app)
      .get(`/api/users/${plain.userId}/id-card`)
      .set("Authorization", `Bearer ${acme.token}`);

    expect(asPlain.status).toBe(403);
    expect(asOtherOrgAdmin.status).toBe(403);
    expect(asOwnOrgAdmin.status).toBe(200);
    expect(asOwnOrgAdmin.body.data.name).toBe("Mona Member");
  });

  it("lets the Super Admin view a card in any org", async () => {
    const acme = await createOrg("Acme", "admin@acme.test");
    await bootstrapPlatform({ email: "root@ugnexa.test", password: "supersecret1", name: "Root Admin" });
    const root = await login("root@ugnexa.test", "supersecret1");

    const res = await request(app).get(`/api/users/${acme.userId}/id-card`).set("Authorization", `Bearer ${root.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(acme.userId);
  });

  it("rejects a malformed user id with 400 instead of crashing", async () => {
    const acme = await createOrg("Acme", "admin@acme.test");
    const res = await request(app).get("/api/users/not-an-id/id-card").set("Authorization", `Bearer ${acme.token}`);
    expect(res.status).toBe(400);
  });
});

describe("Public ID verification", () => {
  it("shows only the printed-card details, with no login", async () => {
    const acme = await createOrg("Acme", "admin@acme.test");
    const card = await request(app).get("/api/users/me/id-card").set("Authorization", `Bearer ${acme.token}`);

    const res = await request(app).get(`/api/public/verify/${card.body.data.verifyToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      name: "Acme Admin",
      employeeId: card.body.data.employeeId,
      role: "Admin",
      organization: "Acme",
      avatarUrl: null,
      isActive: true,
    });
    expect(JSON.stringify(res.body)).not.toContain("admin@acme.test");
  });

  it("reports a deactivated account as inactive", async () => {
    const acme = await createOrg("Acme", "admin@acme.test");
    const member = await createMember(acme.token, "mona@acme.test");
    const card = await request(app).get("/api/users/me/id-card").set("Authorization", `Bearer ${member.token}`);
    await request(app).delete(`/api/users/${member.userId}`).set("Authorization", `Bearer ${acme.token}`);

    const res = await request(app).get(`/api/public/verify/${card.body.data.verifyToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });

  it("404s an unknown token and 400s a malformed one", async () => {
    const unknown = await request(app).get(`/api/public/verify/${"a".repeat(32)}`);
    const malformed = await request(app).get("/api/public/verify/abc");
    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(400);
  });
});
