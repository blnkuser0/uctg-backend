import { FilterQuery } from "mongoose";
import { Accomplishment, IAccomplishment } from "../models/Accomplishment.model";
import { ApiError } from "../utils/ApiError";

function dateRangeFilter(opts: { from?: string; to?: string }): { $gte?: string; $lte?: string } | undefined {
  if (!opts.from && !opts.to) return undefined;
  const range: { $gte?: string; $lte?: string } = {};
  if (opts.from) range.$gte = opts.from;
  if (opts.to) range.$lte = opts.to;
  return range;
}

async function create(organizationId: string, userId: string, input: { date: string; text: string }): Promise<IAccomplishment> {
  return Accomplishment.create({ organizationId, userId, date: input.date, text: input.text });
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
  return Accomplishment.find(query).populate("userId", "name email").sort({ date: -1, createdAt: -1 });
}

// Editing/deleting is always scoped to your OWN entries, even for someone holding
// ACCOMPLISHMENTS_MANAGE — that permission grants team-wide visibility, not the right to rewrite
// someone else's log.
async function update(
  organizationId: string,
  userId: string,
  accomplishmentId: string,
  input: { date?: string; text?: string }
): Promise<IAccomplishment> {
  const entry = await Accomplishment.findOne({ _id: accomplishmentId, organizationId, userId });
  if (!entry) throw ApiError.notFound("Accomplishment not found");
  if (input.date !== undefined) entry.date = input.date;
  if (input.text !== undefined) entry.text = input.text;
  await entry.save();
  return entry;
}

async function remove(organizationId: string, userId: string, accomplishmentId: string): Promise<void> {
  const entry = await Accomplishment.findOne({ _id: accomplishmentId, organizationId, userId });
  if (!entry) throw ApiError.notFound("Accomplishment not found");
  await entry.deleteOne();
}

export const accomplishmentService = { create, listMine, listAll, update, remove };
