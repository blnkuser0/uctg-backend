import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const createDmSchema = z.object({
  userId: objectId,
});

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  memberIds: z.array(objectId).default([]),
});

export const updateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    // Singular fields kept for back-compat; the plural ones let the "add members" picker
    // apply a whole selection in one request instead of one round-trip per person.
    addMemberId: objectId.optional(),
    removeMemberId: objectId.optional(),
    addMemberIds: z.array(objectId).max(200).optional(),
    removeMemberIds: z.array(objectId).max(200).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.addMemberId !== undefined ||
      data.removeMemberId !== undefined ||
      (data.addMemberIds?.length ?? 0) > 0 ||
      (data.removeMemberIds?.length ?? 0) > 0,
    { message: "Provide at least one change" }
  );

export const setPinnedSchema = z.object({
  pinned: z.boolean(),
});

export const setMutedSchema = z.object({
  muted: z.boolean(),
});
