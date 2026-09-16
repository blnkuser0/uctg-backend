import { bootstrapPlatform } from "../src/scripts/bootstrap-platform";
import { Organization } from "../src/models/Organization.model";
import { Role } from "../src/models/Role.model";
import { User } from "../src/models/User.model";

const SUPER_ADMIN = {
  email: "root@ugnexa.test",
  password: "supersecret1",
  name: "Root Admin",
};

describe("Platform bootstrap", () => {
  it("creates the Developers org, a Super Admin role, and the first Super Admin user", async () => {
    const result = await bootstrapPlatform(SUPER_ADMIN);

    expect(result.created).toBe(true);
    expect(result.organization.type).toBe("internal");
    expect(result.role.permissions.length).toBeGreaterThan(0);
    expect(result.user).not.toBeNull();
    expect(result.user!.isSuperAdmin).toBe(true);
    expect(result.user!.organizationId.toString()).toBe(result.organization._id.toString());

    const orgCount = await Organization.countDocuments({ type: "internal" });
    expect(orgCount).toBe(1);
  });

  it("is idempotent: running it twice does not create duplicate orgs/roles/admins", async () => {
    await bootstrapPlatform(SUPER_ADMIN);
    const second = await bootstrapPlatform(SUPER_ADMIN);

    expect(second.created).toBe(false);
    expect(second.user).toBeNull();

    const orgCount = await Organization.countDocuments({ type: "internal" });
    const roleCount = await Role.countDocuments({ name: "Super Admin" });
    const userCount = await User.countDocuments({ email: SUPER_ADMIN.email });
    expect(orgCount).toBe(1);
    expect(roleCount).toBe(1);
    expect(userCount).toBe(1);
  });

  it("re-running with a different email adds a second Super Admin to the same Developers org", async () => {
    const first = await bootstrapPlatform(SUPER_ADMIN);
    const second = await bootstrapPlatform({ ...SUPER_ADMIN, email: "root2@ugnexa.test" });

    expect(second.created).toBe(true);
    expect(second.organization._id.toString()).toBe(first.organization._id.toString());

    const orgCount = await Organization.countDocuments({ type: "internal" });
    expect(orgCount).toBe(1);
  });
});
