import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const createMessageSchema = z.object({
  message: z.string().trim().min(1).max(10000),
  mentions: z.array(objectId).optional(),
  // The message being replied to, if any — must be in the same channel (checked in the service,
  // where the channel is already known).
  replyToId: objectId.optional(),
});

export const updateMessageSchema = z.object({
  message: z.string().trim().min(1).max(10000),
});

export const listMessagesQuerySchema = z.object({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const reactToMessageSchema = z.object({
  // A single emoji glyph. Generous length cap rather than a fixed enum — multi-codepoint emoji
  // (skin tones, ZWJ family sequences) run well past 2 UTF-16 code units.
  emoji: z.string().trim().min(1).max(16),
});

export const searchChannelQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().positive().max(50).optional(),
});
