import bcrypt from "bcryptjs";
import { Types } from "mongoose";
import { ROLE_PERMISSIONS, SystemRole, UMBRELLA_ORGANIZATION_SLUG } from "../constants/roles";
import { Organization, IOrganization } from "../models/Organization.model";
import { Role, IRole } from "../models/Role.model";
import { User, IUser } from "../models/User.model";
import { ApiError } from "../utils/ApiError";
import { slugify } from "../utils/slugify";

const SALT_ROUNDS = 10;

async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  let suffix = 1;
  while (await Organization.exists({ slug })) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
  return slug;
}

export async function ensureRole(organizationId: Types.ObjectId, name: SystemRole): Promise<IRole> {
  return Role.findOneAndUpdate(
    { organizationId, name },
    { $set: { permissions: ROLE_PERMISSIONS[name], isSystem: true } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

export async function ensureUmbrellaOrganization(): Promise<IOrganization> {
  let umbrella = await Organization.findOne({ slug: UMBRELLA_ORGANIZATION_SLUG });
  if (!umbrella) {
    umbrella = await Organization.create({
      name: "Ugnexa Umbrella",
      slug: UMBRELLA_ORGANIZATION_SLUG,
      kind: "umbrella",
      createdBy: new Types.ObjectId(),
    });
  }
  if (umbrella.kind !== "umbrella") {
    umbrella.kind = "umbrella";
    await umbrella.save();
  }
  await Promise.all([ensureRole(umbrella._id, "SUPER_ADMIN"), ensureRole(umbrella._id, "DEVELOPER")]);
  return umbrella;
}

export async function ensureClientRoles(organization: IOrganization): Promise<void> {
  await ensureRole(organization._id, "CLIENT_ADMIN");
}

export async function provisionSuperAdmin(input: {
  name: string;
  email: string;
  password: string;
}): Promise<IUser> {
  const umbrella = await ensureUmbrellaOrganization();
  const role = await ensureRole(umbrella._id, "SUPER_ADMIN");
  const email = input.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        name: input.name.trim(),
        passwordHash,
        organizationId: umbrella._id,
        roleId: role._id,
        isActive: true,
      },
      $setOnInsert: { tokenVersion: 0 },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).select("+passwordHash");
  if (!umbrella.createdBy || umbrella.createdBy.toString() !== user._id.toString()) {
    umbrella.createdBy = user._id;
    await umbrella.save();
  }
  return user;
}

export async function createClientOrganization(input: { name: string; createdBy: string }): Promise<IOrganization> {
  const slug = await generateUniqueSlug(input.name);
  const organization = await Organization.create({
    name: input.name.trim(),
    slug,
    kind: "client",
    createdBy: input.createdBy,
  });
  await ensureClientRoles(organization);
  return organization;
}

export async function resolveProvisioningRole(role: SystemRole, organizationId?: string): Promise<{ role: IRole; organization: IOrganization }> {
  const umbrella = await ensureUmbrellaOrganization();
  if (role === "SUPER_ADMIN" || role === "DEVELOPER") {
    return { role: await ensureRole(umbrella._id, role), organization: umbrella };
  }
  if (!organizationId) throw ApiError.badRequest("A client organization is required for CLIENT_ADMIN accounts");
  const organization = await Organization.findOne({ _id: organizationId, kind: "client", status: "active" });
  if (!organization) throw ApiError.badRequest("Select an active client organization");
  return { role: await ensureRole(organization._id, "CLIENT_ADMIN"), organization };
}
