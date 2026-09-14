import { Leave, ILeave, LeaveDecisionStatus } from "../models/Leave.model";
import { User } from "../models/User.model";
import { PERMISSIONS } from "../constants/permissions";
import { roleService } from "./role.service";
import { notificationService } from "./notification.service";
import { ApiError } from "../utils/ApiError";

function formatDateRange(startDate: Date, endDate: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Manila" });
  return `${fmt(startDate)} – ${fmt(endDate)}`;
}

/**
 * Admin has final say: pending until Admin decides, then mirrors Admin's
 * decision regardless of what HR chose (HR's vote is informational only).
 */
export function computeOverallStatus(
  hrStatus: LeaveDecisionStatus,
  adminStatus: LeaveDecisionStatus
): LeaveDecisionStatus {
  return adminStatus === "pending" ? "pending" : adminStatus;
}

async function createLeave(
  organizationId: string,
  userId: string,
  input: { startDate: Date; endDate: Date; reason: string }
): Promise<ILeave> {
  const leave = await Leave.create({
    organizationId,
    userId,
    startDate: input.startDate,
    endDate: input.endDate,
    reason: input.reason,
  });

  const submitter = await User.findById(userId);
  const [hrApproverIds, adminApproverIds] = await Promise.all([
    roleService.listUserIdsWithPermission(organizationId, PERMISSIONS.LEAVES_APPROVE_HR),
    roleService.listUserIdsWithPermission(organizationId, PERMISSIONS.LEAVES_APPROVE_ADMIN),
  ]);
  const approverIds = [...new Set([...hrApproverIds, ...adminApproverIds])].filter((id) => id !== userId);

  await Promise.all(
    approverIds.map((approverId) =>
      notificationService.createNotification({
        organizationId,
        userId: approverId,
        type: "leave_submitted",
        leaveId: leave._id.toString(),
        actorId: userId,
        actorName: submitter?.name ?? "Someone",
        title: `${submitter?.name ?? "Someone"} requested leave`,
        message: formatDateRange(leave.startDate, leave.endDate),
      })
    )
  );

  return leave;
}

async function listAll(organizationId: string): Promise<ILeave[]> {
  return Leave.find({ organizationId }).populate("userId", "name email").sort({ createdAt: -1 });
}

async function listMine(organizationId: string, userId: string): Promise<ILeave[]> {
  return Leave.find({ organizationId, userId }).sort({ createdAt: -1 });
}

async function getByIdInOrg(organizationId: string, leaveId: string): Promise<ILeave> {
  const leave = await Leave.findOne({ _id: leaveId, organizationId });
  if (!leave) throw ApiError.notFound("Leave request not found");
  return leave;
}

async function setHrDecision(
  organizationId: string,
  leaveId: string,
  decidedBy: string,
  status: "approved" | "rejected",
  note?: string
): Promise<ILeave> {
  const leave = await getByIdInOrg(organizationId, leaveId);

  leave.hrStatus = status;
  leave.hrDecidedBy = decidedBy as unknown as ILeave["hrDecidedBy"];
  leave.hrDecidedAt = new Date();
  leave.hrNote = note ?? null;
  leave.status = computeOverallStatus(leave.hrStatus, leave.adminStatus);

  await leave.save();

  if (leave.adminStatus === "pending") {
    const decider = await User.findById(decidedBy);
    const adminApproverIds = (
      await roleService.listUserIdsWithPermission(organizationId, PERMISSIONS.LEAVES_APPROVE_ADMIN)
    ).filter((id) => id !== decidedBy);

    await Promise.all(
      adminApproverIds.map((approverId) =>
        notificationService.createNotification({
          organizationId,
          userId: approverId,
          type: "leave_hr_decided",
          leaveId: leave._id.toString(),
          actorId: decidedBy,
          actorName: decider?.name ?? "HR",
          title: `HR ${status} a leave request — needs your final decision`,
          message: formatDateRange(leave.startDate, leave.endDate),
        })
      )
    );
  }

  return leave;
}

async function setAdminDecision(
  organizationId: string,
  leaveId: string,
  decidedBy: string,
  status: "approved" | "rejected",
  note?: string
): Promise<ILeave> {
  const leave = await getByIdInOrg(organizationId, leaveId);

  leave.adminStatus = status;
  leave.adminDecidedBy = decidedBy as unknown as ILeave["adminDecidedBy"];
  leave.adminDecidedAt = new Date();
  leave.adminNote = note ?? null;
  leave.status = computeOverallStatus(leave.hrStatus, leave.adminStatus);

  await leave.save();

  const requesterId = leave.userId.toString();
  if (requesterId !== decidedBy) {
    const decider = await User.findById(decidedBy);
    await notificationService.createNotification({
      organizationId,
      userId: requesterId,
      type: "leave_decided",
      leaveId: leave._id.toString(),
      actorId: decidedBy,
      actorName: decider?.name ?? "Admin",
      title: `Your leave request was ${leave.status}`,
      message: formatDateRange(leave.startDate, leave.endDate),
    });
  }

  return leave;
}

async function cancelOwn(organizationId: string, userId: string, leaveId: string): Promise<void> {
  const leave = await Leave.findOne({ _id: leaveId, organizationId, userId });
  if (!leave) throw ApiError.notFound("Leave request not found");
  if (leave.status !== "pending") {
    throw ApiError.badRequest("Only a pending leave request can be cancelled");
  }
  await leave.deleteOne();
}

export const leaveService = {
  createLeave,
  listAll,
  listMine,
  setHrDecision,
  setAdminDecision,
  cancelOwn,
};
