import { z } from "zod";

export const createManualTimeEntrySchema = z.object({
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date(),
  note: z.string().trim().max(500).optional(),
});
