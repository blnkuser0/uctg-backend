import bcrypt from "bcryptjs";
import mongoose, { Types } from "mongoose";
import { config } from "../config";
import { ensureClientRoles, ensureRole, provisionSuperAdmin } from "../services/platform.service";
import { Organization } from "../models/Organization.model";
import { User } from "../models/User.model";
import { Project } from "../models/Project.model";
import { Stage } from "../models/Stage.model";
import { Label } from "../models/Label.model";
import { Task } from "../models/Task.model";
import { TaskComment } from "../models/TaskComment.model";
import { TimeEntry } from "../models/TimeEntry.model";
import { TimeLog } from "../models/TimeLog.model";
import { Leave } from "../models/Leave.model";
import { Channel } from "../models/Channel.model";
import { Message } from "../models/Message.model";
import { Notification } from "../models/Notification.model";

const DEMO_PASSWORD = "DemoTest123!";

function dayOffset(days: number, hour = 9, minute = 0): Date {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

async function upsertOrganization(name: string, slug: string, createdBy: Types.ObjectId) {
  const organization = await Organization.findOneAndUpdate(
    { slug },
    { $set: { name, kind: "client", status: "active", createdBy } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  await ensureClientRoles(organization);
  return organization;
}

async function upsertUser(input: { name: string; email: string; organizationId: Types.ObjectId; roleId: Types.ObjectId }) {
  return User.findOneAndUpdate(
    { email: input.email },
    { $set: { ...input, passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10), isActive: true } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function seed(): Promise<void> {
  await mongoose.connect(config.mongo.uri);

  const admin = await provisionSuperAdmin({ name: "Ugnexa Super Admin", email: "admin@test.com", password: "AdminTest123!" });
  const umbrella = await Organization.findById(admin.organizationId).orFail();
  const developerRole = await ensureRole(umbrella._id, "DEVELOPER");

  const [maya, noah, liam] = await Promise.all([
    upsertUser({ name: "Maya Santos", email: "maya@test.com", organizationId: umbrella._id, roleId: developerRole._id }),
    upsertUser({ name: "Noah Reyes", email: "noah@test.com", organizationId: umbrella._id, roleId: developerRole._id }),
    upsertUser({ name: "Liam Cruz", email: "liam@test.com", organizationId: umbrella._id, roleId: developerRole._id }),
  ]);

  const [northstar, aster] = await Promise.all([
    upsertOrganization("Northstar Retail Group", "demo-northstar-retail", admin._id),
    upsertOrganization("Aster Health Network", "demo-aster-health", admin._id),
  ]);
  const northstarAdminRole = await ensureRole(northstar._id, "CLIENT_ADMIN");
  await upsertUser({ name: "Camille Dizon", email: "camille@northstar.test", organizationId: northstar._id, roleId: northstarAdminRole._id });

  const projectSpecs = [
    { organization: northstar, key: "NOVA", name: "Northstar Commerce Refresh", color: "#38bdf8", description: "Rebuild the client storefront, catalog operations, and release workflow.", members: [admin._id, maya._id, noah._id] },
    { organization: aster, key: "CARE", name: "Aster Patient Portal", color: "#a78bfa", description: "Secure patient experience for appointments, records, and clinic messaging.", members: [admin._id, maya._id, liam._id] },
    { organization: northstar, key: "EDGE", name: "Retail Analytics Console", color: "#34d399", description: "Operational reporting and store-level inventory intelligence.", members: [admin._id, noah._id, liam._id] },
  ];

  const seededTasks: Array<{ task: InstanceType<typeof Task>; project: InstanceType<typeof Project> }> = [];
  for (const projectSpec of projectSpecs) {
    const project = await Project.findOneAndUpdate(
      { organizationId: projectSpec.organization._id, key: projectSpec.key },
      { $set: { name: projectSpec.name, description: projectSpec.description, color: projectSpec.color, status: "active", createdBy: admin._id, memberIds: projectSpec.members, deletedAt: null } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const stageSpecs = [
      { name: "Backlog", color: "#64748b", order: 0, isDoneStage: false },
      { name: "In progress", color: "#38bdf8", order: 1, isDoneStage: false },
      { name: "Review", color: "#f59e0b", order: 2, isDoneStage: false },
      { name: "Done", color: "#10b981", order: 3, isDoneStage: true },
    ];
    const stages = await Promise.all(stageSpecs.map((stage) => Stage.findOneAndUpdate(
      { projectId: project._id, name: stage.name },
      { $set: { ...stage, organizationId: project.organizationId, createdBy: admin._id, deletedAt: null } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    )));

    const [featureLabel, qualityLabel, blockerLabel] = await Promise.all([
      Label.findOneAndUpdate({ projectId: project._id, name: "Feature" }, { $set: { organizationId: project.organizationId, color: "#38bdf8", createdBy: admin._id, deletedAt: null } }, { new: true, upsert: true }),
      Label.findOneAndUpdate({ projectId: project._id, name: "Quality" }, { $set: { organizationId: project.organizationId, color: "#a78bfa", createdBy: admin._id, deletedAt: null } }, { new: true, upsert: true }),
      Label.findOneAndUpdate({ projectId: project._id, name: "Blocked" }, { $set: { organizationId: project.organizationId, color: "#fb7185", createdBy: admin._id, deletedAt: null } }, { new: true, upsert: true }),
    ]);

    const taskSpecs = [
      { title: "Map the primary customer journey", stage: 3, priority: "high", deadline: -3, assignees: [admin._id, maya._id], labels: [featureLabel._id], completed: true },
      { title: "Build responsive account navigation", stage: 1, priority: "urgent", deadline: 2, assignees: [admin._id, noah._id], labels: [featureLabel._id], completed: false },
      { title: "Validate empty and loading states", stage: 2, priority: "normal", deadline: 4, assignees: [admin._id, liam._id], labels: [qualityLabel._id], completed: false },
      { title: "Resolve staging API permission gap", stage: 1, priority: "high", deadline: 1, assignees: [admin._id, maya._id], labels: [blockerLabel._id], completed: false },
      { title: "Prepare client acceptance checklist", stage: 0, priority: "low", deadline: 8, assignees: [admin._id], labels: [qualityLabel._id], completed: false },
    ];

    for (let index = 0; index < taskSpecs.length; index += 1) {
      const spec = taskSpecs[index];
      const taskNumber = index + 1;
      const checklist = [
        { _id: new Types.ObjectId(), text: "Confirm acceptance criteria", isChecked: true, order: 0, completedBy: admin._id, completedAt: dayOffset(-1) },
        { _id: new Types.ObjectId(), text: "Attach QA evidence", isChecked: index % 2 === 0, order: 1, completedBy: index % 2 === 0 ? admin._id : null, completedAt: index % 2 === 0 ? dayOffset(-1) : null },
      ];
      const task = await Task.findOneAndUpdate(
        { projectId: project._id, taskNumber },
        { $set: {
          organizationId: project.organizationId,
          projectId: project._id,
          stageId: stages[spec.stage]._id,
          parentTaskId: null,
          taskNumber,
          title: spec.title,
          description: `Demo task for ${project.name}. Open this task to test status, comments, checklist, time tracking, and attachments.`,
          priority: spec.priority,
          labelIds: spec.labels,
          createdBy: admin._id,
          assigneeIds: spec.assignees,
          startDate: dayOffset(-5),
          deadline: dayOffset(spec.deadline, 17),
          order: index,
          checklist,
          checklistProgress: index % 2 === 0 ? 100 : 50,
          estimateMinutes: 480,
          trackedMinutes: 150 + index * 30,
          attachments: index === 1 ? [{ url: `${config.server.clientUrl}/assets/branding/logo-square-dark.webp`, fileKey: `demo/${project.key}-reference.webp`, originalName: `${project.key.toLowerCase()}-ui-reference.webp`, mimeType: "image/webp", size: 48231, uploadedBy: admin._id, createdAt: dayOffset(-2) }] : [],
          commentCount: 2,
          completedAt: spec.completed ? dayOffset(-2) : null,
          deletedAt: null,
        } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      seededTasks.push({ task, project });
    }
    project.taskSeq = taskSpecs.length;
    await project.save();
  }

  for (const { task, project } of seededTasks) {
    await TaskComment.deleteMany({ taskId: task._id, message: /^\[Demo\]/ });
    await TaskComment.insertMany([
      { organizationId: project.organizationId, projectId: project._id, taskId: task._id, userId: maya._id, authorName: maya.name, authorAvatar: null, message: "[Demo] The implementation is ready for a focused review. I added the edge cases to the checklist.", mentions: [admin._id], attachments: [], isEdited: false },
      { organizationId: project.organizationId, projectId: project._id, taskId: task._id, userId: admin._id, authorName: admin.name, authorAvatar: null, message: "[Demo] Reviewed. Please keep the status current and attach the final evidence before moving to Done.", mentions: [], attachments: [], isEdited: false },
    ]);
  }

  await TimeEntry.deleteMany({ note: /^\[Demo\]/ });
  await TimeEntry.insertMany(seededTasks.slice(0, 5).map(({ task, project }, index) => ({ organizationId: project.organizationId, taskId: task._id, projectId: project._id, userId: admin._id, source: "manual", startedAt: dayOffset(-index - 1, 9), endedAt: dayOffset(-index - 1, 11), durationMinutes: 120, note: "[Demo] Product implementation and review" })));

  await TimeLog.deleteMany({ note: /^\[Demo\]/ });
  const timeLogs = [];
  for (let days = -6; days <= 0; days += 1) {
    if ([0, 6].includes(dayOffset(days).getDay())) continue;
    for (const member of [admin, maya, noah, liam]) {
      timeLogs.push({ organizationId: umbrella._id, userId: member._id, type: "time-in", timestamp: dayOffset(days, 8, 45), note: "[Demo] Office shift" });
      timeLogs.push({ organizationId: umbrella._id, userId: member._id, type: "time-out", timestamp: dayOffset(days, 17, 30), note: "[Demo] Office shift" });
    }
  }
  await TimeLog.insertMany(timeLogs);

  await Leave.deleteMany({ reason: /^\[Demo\]/ });
  await Leave.insertMany([
    { organizationId: umbrella._id, userId: maya._id, startDate: dayOffset(6), endDate: dayOffset(7), reason: "[Demo] Family appointment", hrStatus: "approved", hrDecidedBy: admin._id, hrDecidedAt: dayOffset(-1), adminStatus: "pending", status: "pending" },
    { organizationId: umbrella._id, userId: noah._id, startDate: dayOffset(12), endDate: dayOffset(14), reason: "[Demo] Planned vacation", hrStatus: "approved", hrDecidedBy: admin._id, hrDecidedAt: dayOffset(-2), adminStatus: "approved", adminDecidedBy: admin._id, adminDecidedAt: dayOffset(-1), status: "approved" },
  ]);

  const channel = await Channel.findOneAndUpdate(
    { organizationId: umbrella._id, type: "group", name: "Demo Delivery Standup" },
    { $set: { memberIds: [admin._id, maya._id, noah._id, liam._id], createdBy: admin._id, lastMessageAt: new Date(), deletedAt: null } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  await Message.deleteMany({ channelId: channel._id, message: /^\[Demo\]/ });
  await Message.insertMany([
    { organizationId: umbrella._id, channelId: channel._id, userId: maya._id, authorName: maya.name, authorAvatar: null, message: "[Demo] NOVA navigation is in review. I attached the responsive states to the task.", mentions: [admin._id], attachments: [], isEdited: false },
    { organizationId: umbrella._id, channelId: channel._id, userId: noah._id, authorName: noah.name, authorAvatar: null, message: "[Demo] API integration is stable; next focus is the empty-state pass.", mentions: [], attachments: [], isEdited: false },
  ]);

  await Notification.deleteMany({ userId: admin._id, title: /^\[Demo\]/ });
  await Notification.insertMany([
    { organizationId: umbrella._id, userId: admin._id, type: "task_mention", projectId: seededTasks[1].project._id, taskId: seededTasks[1].task._id, actorId: maya._id, actorName: maya.name, title: "[Demo] Maya mentioned you in a task", message: "Navigation states are ready for review.", readAt: null },
    { organizationId: umbrella._id, userId: admin._id, type: "task_deadline", projectId: seededTasks[3].project._id, taskId: seededTasks[3].task._id, actorId: admin._id, actorName: "Catalyst", title: "[Demo] A high-priority task is due soon", message: seededTasks[3].task.title, readAt: null },
    { organizationId: umbrella._id, userId: admin._id, type: "message_mention", channelId: channel._id, actorId: maya._id, actorName: maya.name, title: "[Demo] New standup update", message: "Project review is ready.", readAt: dayOffset(-1) },
  ]);

  process.stdout.write([
    "Demo workspace ready.",
    "Super Admin: admin@test.com / AdminTest123!",
    `Developer accounts: maya@test.com, noah@test.com, liam@test.com / ${DEMO_PASSWORD}`,
    `Seeded ${projectSpecs.length} projects and ${seededTasks.length} tasks.`,
  ].join("\n") + "\n");
}

seed()
  .catch((error) => {
    console.error("Failed to seed demo data", error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
