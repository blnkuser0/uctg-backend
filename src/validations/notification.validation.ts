import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const markNotificationsReadSchema = z.object({
  ids: z.array(objectId).optional(),
});
