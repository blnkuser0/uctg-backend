import { Organization, IOrganization } from "../models/Organization.model";
import { ApiError } from "../utils/ApiError";

async function getOrganization(organizationId: string): Promise<IOrganization> {
  const org = await Organization.findById(organizationId);
  if (!org) throw ApiError.notFound("Organization not found");
  return org;
}

async function updateOrganization(organizationId: string, updates: { name?: string }): Promise<IOrganization> {
  const org = await getOrganization(organizationId);
  if (updates.name) org.name = updates.name;
  await org.save();
  return org;
}

async function listClientOrganizations(): Promise<IOrganization[]> {
  return Organization.find({ kind: "client", status: "active" }).sort({ name: 1 });
}

export const organizationService = {
  getOrganization,
  updateOrganization,
  listClientOrganizations,
};
