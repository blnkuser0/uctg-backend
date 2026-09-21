import { z } from "zod";

export const userIdParamSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid user id") });

// Matches generateIdToken(): 16 random bytes as hex.
export const verifyTokenParamSchema = z.object({ token: z.string().regex(/^[a-f\d]{32}$/i, "Invalid ID token") });
