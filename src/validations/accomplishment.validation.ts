import { z } from "zod";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const sectionText = z.string().trim().max(5000);

export const createAccomplishmentSchema = z.object({
  date: dateString,
  accomplishment: sectionText.min(1),
  blockers: sectionText.optional(),
  inProgress: sectionText.optional(),
});

export const updateAccomplishmentSchema = z
  .object({
    date: dateString.optional(),
    accomplishment: sectionText.min(1).optional(),
    blockers: sectionText.optional(),
    inProgress: sectionText.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Provide at least one change" });

export const listAccomplishmentsQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  userId: objectId.optional(),
});

export const addAccomplishmentAttachmentSchema = z.object({
  section: z.enum(["accomplishment", "blockers", "inProgress"]),
});
