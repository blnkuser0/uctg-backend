import request from "supertest";
import { app } from "../src/server";
import { provisionSuperAdmin } from "../src/services/platform.service";

const ADMIN = { name: "Ugnexa Super Admin", email: "admin@test.com", password: "AdminTest123!" };

async function loginSuperAdmin(): Promise<string> {
  await provisionSuperAdmin(ADMIN);
  const response = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
  return response.body.data.accessToken as string;
}

describe("Super Admin provisioning", () => {
  it("allows only a Super Admin to create client organizations", async () => {
    const token = await loginSuperAdmin();
    const response = await request(app).post("/api/organization").set("Authorization", `Bearer ${token}`).send({ name: "Northstar Client" });
    expect(response.status).toBe(201);
    expect(response.body.data.kind).toBe("client");
  });

  it("provisions developers under Umbrella and client admins under their client organization", async () => {
    const token = await loginSuperAdmin();
    const client = await request(app).post("/api/organization").set("Authorization", `Bearer ${token}`).send({ name: "Northstar Client" });
    const developer = await request(app).post("/api/users").set("Authorization", `Bearer ${token}`).send({ name: "Dev One", email: "dev@ugnexa.test", password: "Developer123!", role: "DEVELOPER" });
    const clientAdmin = await request(app).post("/api/users").set("Authorization", `Bearer ${token}`).send({ name: "Client One", email: "client@ugnexa.test", password: "ClientAdmin123!", role: "CLIENT_ADMIN", organizationId: client.body.data._id });
    expect(developer.status).toBe(201);
    expect(developer.body.data.role.name).toBe("DEVELOPER");
    expect(clientAdmin.status).toBe(201);
    expect(clientAdmin.body.data.organizationId).toBe(client.body.data._id);
    expect(clientAdmin.body.data.role.name).toBe("CLIENT_ADMIN");
  });

  it("prevents a developer from creating accounts or organizations", async () => {
    const token = await loginSuperAdmin();
    await request(app).post("/api/users").set("Authorization", `Bearer ${token}`).send({ name: "Dev One", email: "dev@ugnexa.test", password: "Developer123!", role: "DEVELOPER" });
    const developerLogin = await request(app).post("/api/auth/login").send({ email: "dev@ugnexa.test", password: "Developer123!" });
    const createUser = await request(app).post("/api/users").set("Authorization", `Bearer ${developerLogin.body.data.accessToken}`).send({ name: "Nope", email: "nope@ugnexa.test", password: "Password123!", role: "DEVELOPER" });
    const createOrganization = await request(app).post("/api/organization").set("Authorization", `Bearer ${developerLogin.body.data.accessToken}`).send({ name: "Nope Client" });
    expect(createUser.status).toBe(403);
    expect(createOrganization.status).toBe(403);
  });
});
