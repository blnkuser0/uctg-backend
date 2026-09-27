import { z } from "zod";
import { TIME_LOG_TYPES } from "../models/TimeLog.model";

export const clockSchema = z.object({
  type: z.enum(TIME_LOG_TYPES),
  note: z.string().trim().max(500).optional(),
});

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

// userId lets someone with ATTENDANCE_VIEW_ALL look at another employee's calendar — the
// controller enforces that; without it the query always means "my own".
export const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM"),
  userId: objectId.optional(),
});

export const dateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

export const summaryQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  userId: objectId.optional(),
});
