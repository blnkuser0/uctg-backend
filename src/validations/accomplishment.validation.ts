import { z } from "zod";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const createAccomplishmentSchema = z.object({
  date: dateString,
  text: z.string().trim().min(1).max(2000),
});

export const updateAccomplishmentSchema = z
  .object({
    date: dateString.optional(),
    text: z.string().trim().min(1).max(2000).optional(),
  })
  .refine((data) => data.date !== undefined || data.text !== undefined, { message: "Provide at least one change" });

export const listAccomplishmentsQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  userId: objectId.optional(),
});
