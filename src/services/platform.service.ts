import { Organization, IOrganization } from "../models/Organization.model";
import { Role, IRole } from "../models/Role.model";
import { Project, IProject } from "../models/Project.model";
import { User, IUser } from "../models/User.model";
import { registerOrganization } from "./auth.service";
import { userService, UserWithRole } from "./user.service";
import { projectService } from "./project.service";
import { ApiError } from "../utils/ApiError";

const DEVELOPER_ROLE_NAME = "Developer";

async function getDevelopersOrg(): Promise<IOrganization> {
  const org = await Organization.findOne({ type: "internal" });
  if (!org) throw ApiError.notFound("The Developers organization has not been bootstrapped yet");
  return org;
}

async function getOrCreateDeveloperRole(devsOrgId: string): Promise<IRole> {
  let role = await Role.findOne({ organizationId: devsOrgId, name: DEVELOPER_ROLE_NAME });
  if (!role) {
    role = await Role.create({ organizationId: devsOrgId, name: DEVELOPER_ROLE_NAME, permissions: [] });
  }
  return role;
}

/** Creates a new client Organization + its first admin user — reuses registerOrganization's
 *  transaction (with its non-transactional fallback) and Role-seeding as-is; the only thing that
 *  changes is WHO can reach this (Super Admin only, via /platform, instead of the public internet). */
async function createClientOrganization(input: {
  organizationName: string;
  name: string;
  email: string;
  password: string;
}): Promise<IUser> {
  return registerOrganization(input);
}

async function listAllOrganizations(): Promise<IOrganization[]> {
  return Organization.find().sort({ name: 1 });
}

async function createDeveloperUser(input: { name: string; email: string; password: string }): Promise<UserWithRole> {
  const devsOrg = await getDevelopersOrg();
  const role = await getOrCreateDeveloperRole(devsOrg._id.toString());
  return userService.createUser({
    name: input.name,
    email: input.email,
    password: input.password,
    organizationId: devsOrg._id.toString(),
    roleId: role._id.toString(),
  });
}

async function createClientOrgUser(input: {
  organizationId: string;
  name: string;
  email: string;
  password: string;
  roleId: string;
}): Promise<UserWithRole> {
  const org = await Organization.findById(input.organizationId);
  if (!org) throw ApiError.notFound("Organization not found");
  return userService.createUser(input);
}

async function listDevelopers(): Promise<UserWithRole[]> {
  const devsOrg = await getDevelopersOrg();
  return userService.listUsers(devsOrg._id.toString());
}

async function listAllProjectsPlatformWide(): Promise<IProject[]> {
  return projectService.listAllProjectsPlatformWide();
}

async function assignDeveloperToProject(
  actingOrganizationId: string,
  actingUserId: string,
  projectId: string,
  developerUserId: string
): Promise<IProject> {
  const devsOrg = await getDevelopersOrg();
  const developer = await User.findOne({ _id: developerUserId, organizationId: devsOrg._id });
  if (!developer) throw ApiError.badRequest("That user is not a Developers-org user");

  const project = await Project.findOne({ _id: projectId, deletedAt: null });
  if (!project) throw ApiError.notFound("Project not found");

  // isSuperAdmin:true bypasses assertProjectAccess regardless of the acting
  // org's relationship to the project — permissions can be empty here since
  // it's unused once that bypass applies.
  return projectService.addMember(actingOrganizationId, projectId, actingUserId, [], true, developerUserId);
}

async function unassignDeveloperFromProject(
  actingOrganizationId: string,
  actingUserId: string,
  projectId: string,
  developerUserId: string
): Promise<IProject> {
  return projectService.removeMember(actingOrganizationId, projectId, actingUserId, [], true, developerUserId);
}

export const platformService = {
  createClientOrganization,
  listAllOrganizations,
  createDeveloperUser,
  createClientOrgUser,
  listDevelopers,
  listAllProjectsPlatformWide,
  assignDeveloperToProject,
  unassignDeveloperFromProject,
};
