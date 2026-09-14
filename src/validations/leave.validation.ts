import { z } from "zod";

export const createLeaveSchema = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
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
