import { z } from "zod";

export const createLabelSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().trim().min(1).max(20),
});

export const updateLabelSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: z.string().trim().min(1).max(20).optional(),
});
