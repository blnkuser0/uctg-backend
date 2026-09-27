import { z } from "zod";
import { LEAVE_TYPES } from "../models/Leave.model";

export const createLeaveSchema = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    leaveType: z.enum(LEAVE_TYPES),
    reason: z.string().trim().min(1).max(1000),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

export const leaveDecisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(500).optional(),
});
