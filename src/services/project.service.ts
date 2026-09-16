import { Project, IProject } from "../models/Project.model";
import { Stage } from "../models/Stage.model";
import { User } from "../models/User.model";
import { Organization } from "../models/Organization.model";
import { IRole } from "../models/Role.model";
import { PERMISSIONS, Permission } from "../constants/permissions";
import { notificationService } from "./notification.service";
import { channelService } from "./channel.service";
import { ApiError } from "../utils/ApiError";

const DEFAULT_STAGES = [
  { name: "Design" },
  { name: "Procurement" },
  { name: "Installation" },
  { name: "QA" },
  { name: "Done", isDoneStage: true },
];

function deriveKeyBase(name: string): string {
  const alnum = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (alnum.slice(0, 4) || "PRJ").padEnd(2, "X");
}

async function generateUniqueKey(organizationId: string, name: string, requested?: string): Promise<string> {
  const base = requested ?? deriveKeyBase(name);
  let key = base;
  let attempt = 1;
  while (true) {
    const existing = await Project.findOne({ organizationId, key });
    if (!existing) return key;
    attempt += 1;
    key = `${base}${attempt}`;
  }
}

async function createProject(
  organizationId: string,
  userId: string,
  clientOrganizationId: string | undefined,
  input: { name: string; key?: string; description?: string; color?: string; memberIds?: string[] }
): Promise<IProject> {
  const targetOrganizationId = clientOrganizationId ?? organizationId;
  if (clientOrganizationId) {
    const client = await Organization.findOne({ _id: clientOrganizationId, kind: "client", status: "active" });
    if (!client) throw ApiError.badRequest("Select an active client organization");
  }
  const key = await generateUniqueKey(targetOrganizationId, input.name, input.key);
  const requestedMemberIds = [...new Set(input.memberIds ?? [])];
  if (requestedMemberIds.length > 0) {
    const eligibleDevelopers = await User.find({ _id: { $in: requestedMemberIds }, isActive: true }).populate<{ roleId: IRole }>("roleId");
    if (eligibleDevelopers.length !== requestedMemberIds.length || eligibleDevelopers.some((developer) => developer.roleId.name !== "DEVELOPER")) {
      throw ApiError.badRequest("Project teams can only include active Umbrella developers");
    }
  }
  const memberIds = [...new Set([userId, ...requestedMemberIds])];

  const project = await Project.create({
    organizationId: targetOrganizationId,
    name: input.name,
    key,
    description: input.description ?? "",
    color: input.color ?? "#0891b2",
    createdBy: userId,
    memberIds,
  });

  await Stage.insertMany(
    DEFAULT_STAGES.map((stage, index) => ({
      organizationId: targetOrganizationId,
      projectId: project._id,
      name: stage.name,
      order: index,
      isDoneStage: !!stage.isDoneStage,
      createdBy: userId,
    }))
  );

  await channelService.createProjectChannel(targetOrganizationId, project._id.toString(), project.name, memberIds, userId);

  return project;
}

async function listMyProjects(userId: string): Promise<IProject[]> {
  return Project.find({ memberIds: userId, deletedAt: null }).sort({ createdAt: -1 });
}

async function listAllProjects(): Promise<IProject[]> {
  return Project.find({ deletedAt: null }).sort({ createdAt: -1 });
}

/** Loads a project and enforces access: must be a member, or hold projects.manage. */
async function assertProjectAccess(
  organizationId: string,
  projectId: string,
  userId: string,
  permissions: Permission[]
): Promise<IProject> {
  const project = await Project.findOne({ _id: projectId, organizationId, deletedAt: null });
  if (!project) throw ApiError.notFound("Project not found");

  const isMember = project.memberIds.some((id) => id.toString() === userId);
  const canManageAll = permissions.includes(PERMISSIONS.PROJECTS_MANAGE);
  if (!isMember && !canManageAll) {
    throw ApiError.forbidden("You are not a member of this project");
  }
  return project;
}

async function updateProject(
  organizationId: string,
  projectId: string,
  userId: string,
  permissions: Permission[],
  updates: Partial<Pick<IProject, "name" | "description" | "color" | "status">>
): Promise<IProject> {
  const project = await assertProjectAccess(organizationId, projectId, userId, permissions);
  Object.assign(project, updates);
  await project.save();
  return project;
}

async function deleteProject(
  organizationId: string,
  projectId: string,
  userId: string,
  permissions: Permission[]
): Promise<void> {
  const project = await assertProjectAccess(organizationId, projectId, userId, permissions);
  project.deletedAt = new Date();
  await project.save();
}

async function addMember(
  organizationId: string,
  projectId: string,
  userId: string,
  permissions: Permission[],
  newMemberId: string
): Promise<IProject> {
  const project = await assertProjectAccess(organizationId, projectId, userId, permissions);
  if (!project.memberIds.some((id) => id.toString() === newMemberId)) {
    const developer = await User.findById(newMemberId).populate<{ roleId: IRole }>("roleId");
    if (!developer || !developer.isActive || developer.roleId.name !== "DEVELOPER") {
      throw ApiError.badRequest("Only active Umbrella developers can be assigned to client projects");
    }
    project.memberIds.push(newMemberId as unknown as IProject["memberIds"][number]);
    await project.save();
    await channelService.addProjectMember(projectId, newMemberId);

    if (newMemberId !== userId) {
      const actor = await User.findById(userId);
      await notificationService.createNotification({
        organizationId,
        userId: newMemberId,
        type: "project_added",
        projectId: project._id.toString(),
        actorId: userId,
        actorName: actor?.name ?? "Someone",
        title: `${actor?.name ?? "Someone"} added you to a project`,
        message: project.name,
      });
    }
  }
  return project;
}

async function removeMember(
  organizationId: string,
  projectId: string,
  userId: string,
  permissions: Permission[],
  memberIdToRemove: string
): Promise<IProject> {
  const project = await assertProjectAccess(organizationId, projectId, userId, permissions);
  project.memberIds = project.memberIds.filter((id) => id.toString() !== memberIdToRemove);
  await project.save();
  await channelService.removeProjectMember(projectId, memberIdToRemove);
  return project;
}

export const projectService = {
  createProject,
  listMyProjects,
  listAllProjects,
  assertProjectAccess,
  updateProject,
  deleteProject,
  addMember,
  removeMember,
};
