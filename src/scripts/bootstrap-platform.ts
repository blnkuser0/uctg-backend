import dns from "dns";

// Same fix as server.ts — Node's own DNS resolver can pick a broken server on
// this machine/network, breaking `mongodb+srv://` SRV lookups even when the
// OS resolver works fine. Must run before connectDB()'s mongoose.connect().
dns.setServers(["8.8.8.8", "1.1.1.1"]);
dns.setDefaultResultOrder("ipv4first");

import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/db";
import { Organization, IOrganization } from "../models/Organization.model";
import { Role, IRole } from "../models/Role.model";
import { User, IUser } from "../models/User.model";
import { ALL_PERMISSIONS } from "../constants/permissions";
import { slugify } from "../utils/slugify";

const SALT_ROUNDS = 10;
const DEVELOPERS_ORG_NAME = "Developers";
const SUPER_ADMIN_ROLE_NAME = "Super Admin";

export interface BootstrapResult {
  organization: IOrganization;
  role: IRole;
  user: IUser | null; // null when a Super Admin with this email already existed
  created: boolean;
}

/**
 * Idempotent one-time provisioning: ensures the single shared "Developers"
 * organization exists, ensures it has a "Super Admin" role seeded with every
 * permission, and creates a Super Admin user for the given email if one
 * doesn't already exist. Safe to call/run more than once — every step
 * checks before creating.
 */
export async function bootstrapPlatform(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<BootstrapResult> {
  let devsOrg = await Organization.findOne({ type: "internal" });
  const orgIsNew = !devsOrg;
  if (!devsOrg) {
    devsOrg = await Organization.create({
      name: DEVELOPERS_ORG_NAME,
      slug: slugify(DEVELOPERS_ORG_NAME),
      type: "internal",
      createdBy: new mongoose.Types.ObjectId(),
    });
  }

  let superAdminRole = await Role.findOne({ organizationId: devsOrg._id, name: SUPER_ADMIN_ROLE_NAME });
  if (!superAdminRole) {
    superAdminRole = await Role.create({
      organizationId: devsOrg._id,
      name: SUPER_ADMIN_ROLE_NAME,
      permissions: ALL_PERMISSIONS,
    });
  }

  const existing = await User.findOne({ email: input.email });
  if (existing) {
    return { organization: devsOrg, role: superAdminRole, user: null, created: false };
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await User.create({
    name: input.name ?? "Super Admin",
    email: input.email,
    passwordHash,
    organizationId: devsOrg._id,
    roleId: superAdminRole._id,
    isSuperAdmin: true,
  });

  if (orgIsNew) {
    devsOrg.createdBy = user._id;
    await devsOrg.save();
  }

  return { organization: devsOrg, role: superAdminRole, user, created: true };
}

async function start() {
  const email = process.env.BOOTSTRAP_SUPERADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_SUPERADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_SUPERADMIN_NAME;
  if (!email || !password) {
    throw new Error("BOOTSTRAP_SUPERADMIN_EMAIL and BOOTSTRAP_SUPERADMIN_PASSWORD env vars are required");
  }

  await connectDB();
  const result = await bootstrapPlatform({ email, password, name });

  if (result.created) {
    process.stdout.write(`Created Super Admin ${email} in Developers org ${result.organization._id}.\n`);
  } else {
    process.stdout.write(`Super Admin ${email} already exists — nothing to do.\n`);
  }

  await disconnectDB();
}

// Guard the same way server.ts guards its own start() — Jest imports this
// module directly (for bootstrapPlatform, see tests/bootstrap.test.ts) and
// must not trigger the CLI entrypoint or its env-var requirement as a
// side effect of that import.
if (require.main === module) {
  void start().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
