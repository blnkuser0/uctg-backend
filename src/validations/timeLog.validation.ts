import { z } from "zod";
import { TIME_LOG_TYPES } from "../models/TimeLog.model";

export const clockSchema = z.object({
  type: z.enum(TIME_LOG_TYPES),
  note: z.string().trim().max(500).optional(),
});

export const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM"),
});

export const dateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});
