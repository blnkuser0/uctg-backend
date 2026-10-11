import { FilterQuery } from "mongoose";
import { Accomplishment, IAccomplishment, IAccomplishmentAttachment } from "../models/Accomplishment.model";
import { ApiError } from "../utils/ApiError";

function dateRangeFilter(opts: { from?: string; to?: string }): { $gte?: string; $lte?: string } | undefined {
  if (!opts.from && !opts.to) return undefined;
  const range: { $gte?: string; $lte?: string } = {};
  if (opts.from) range.$gte = opts.from;
  if (opts.to) range.$lte = opts.to;
  return range;
}

async function create(
  organizationId: string,
  userId: string,
  input: { date: string; accomplishment: string; blockers?: string; inProgress?: string }
): Promise<IAccomplishment> {
  return Accomplishment.create({
    organizationId,
    userId,
    date: input.date,
    accomplishment: input.accomplishment,
    blockers: input.blockers ?? "",
    inProgress: input.inProgress ?? "",
  });
}

async function listMine(organizationId: string, userId: string, opts: { from?: string; to?: string }): Promise<IAccomplishment[]> {
  const query: FilterQuery<IAccomplishment> = { organizationId, userId };
  const range = dateRangeFilter(opts);
  if (range) query.date = range;
  return Accomplishment.find(query).sort({ date: -1, createdAt: -1 });
}

// Requires ACCOMPLISHMENTS_MANAGE (enforced at the route level) — this is the team-wide report,
// not scoped to the caller.
async function listAll(organizationId: string, opts: { from?: string; to?: string; userId?: string }): Promise<IAccomplishment[]> {
  const query: FilterQuery<IAccomplishment> = { organizationId };
  if (opts.userId) query.userId = opts.userId;
  const range = dateRangeFilter(opts);
  if (range) query.date = range;
  return Accomplishment.find(query)
    .populate({ path: "userId", select: "name email roleId", populate: { path: "roleId", select: "name" } })
    .sort({ date: -1, createdAt: -1 });
}

// Editing/deleting is always scoped to your OWN entries, even for someone holding
// ACCOMPLISHMENTS_MANAGE — that permission grants team-wide visibility, not the right to rewrite
// someone else's log.
async function update(
  organizationId: string,
  userId: string,
  accomplishmentId: string,
  input: { date?: string; accomplishment?: string; blockers?: string; inProgress?: string }
): Promise<IAccomplishment> {
  const entry = await Accomplishment.findOne({ _id: accomplishmentId, organizationId, userId });
  if (!entry) throw ApiError.notFound("Accomplishment not found");
  if (input.date !== undefined) entry.date = input.date;
  if (input.accomplishment !== undefined) entry.accomplishment = input.accomplishment;
  if (input.blockers !== undefined) entry.blockers = input.blockers;
  if (input.inProgress !== undefined) entry.inProgress = input.inProgress;
  await entry.save();
  return entry;
}

async function remove(organizationId: string, userId: string, accomplishmentId: string): Promise<void> {
  const entry = await Accomplishment.findOne({ _id: accomplishmentId, organizationId, userId });
  if (!entry) throw ApiError.notFound("Accomplishment not found");
  await entry.deleteOne();
}

async function addAttachment(
  organizationId: string,
  userId: string,
  accomplishmentId: string,
  file: IAccomplishmentAttachment
): Promise<IAccomplishment> {
  const entry = await Accomplishment.findOne({ _id: accomplishmentId, organizationId, userId });
  if (!entry) throw ApiError.notFound("Accomplishment not found");
  entry.attachments.push(file);
  await entry.save();
  return entry;
}

async function removeAttachment(
  organizationId: string,
  userId: string,
  accomplishmentId: string,
  fileKey: string
): Promise<{ entry: IAccomplishment; removedKey: string | null }> {
  const entry = await Accomplishment.findOne({ _id: accomplishmentId, organizationId, userId });
  if (!entry) throw ApiError.notFound("Accomplishment not found");
  const before = entry.attachments.length;
  entry.attachments = entry.attachments.filter((a) => a.fileKey !== fileKey);
  const removedKey = entry.attachments.length < before ? fileKey : null;
  await entry.save();
  return { entry, removedKey };
}

export const accomplishmentService = { create, listMine, listAll, update, remove, addAttachment, removeAttachment };
