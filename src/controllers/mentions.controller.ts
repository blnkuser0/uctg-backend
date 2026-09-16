import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { commentService } from "../services/comment.service";
import { messageService } from "../services/message.service";

interface MentionItem {
  _id: string;
  source: "task" | "chat";
  authorName: string;
  message: string;
  createdAt: Date;
  link: string;
}

export const listMentions = asyncHandler(async (req: Request, res: Response) => {
  const [comments, messages] = await Promise.all([
    commentService.listMentionsForUser(req.user!.id),
    messageService.listMentionsForUser(req.user!.id),
  ]);

  const items: MentionItem[] = [
    ...comments.map((c) => ({
      _id: c._id.toString(),
      source: "task" as const,
      authorName: c.authorName,
      message: c.message,
      createdAt: c.createdAt,
      link: `/projects/${c.projectId}/board`,
    })),
    ...messages.map((m) => ({
      _id: m._id.toString(),
      source: "chat" as const,
      authorName: m.authorName,
      message: m.message,
      createdAt: m.createdAt,
      link: `/chat/${m.channelId}`,
    })),
  ];

  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  res.json(new ApiResponse(200, items.slice(0, 100), "Mentions"));
});
