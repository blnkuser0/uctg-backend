import { NextFunction, Request, Response } from "express";
import { emitDataChanged, emitDataChangedEverywhere } from "../utils/socketEmitter";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// API resources whose changes should show up live for everyone in the organization. Chat
// (channels/messages) and notifications are deliberately absent — they already have their own,
// more targeted realtime events, and broadcasting every message org-wide would be noise.
const ORG_SYNCED = new Set([
  "leaves",
  "users",
  "roles",
  "accomplishments",
  "timeclock",
  "organization",
  "projects",
  "stages",
  "labels",
  "tasks",
  "comments",
  "time-entries",
]);

/**
 * After ANY successful write to a synced resource, tell the organization to refetch it. Hooking
 * this one place (instead of every controller) means a new endpoint under a synced resource is
 * live automatically, and no page can be forgotten.
 */
export function realtimeSync(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }

  const resource = req.path.split("/")[1];
  const isPlatform = resource === "platform";
  if (!isPlatform && !ORG_SYNCED.has(resource)) {
    next();
    return;
  }

  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;

    if (isPlatform) {
      // Provisioning touches other organizations' users, roles and project access.
      emitDataChangedEverywhere(["platform", "projects", "users", "roles"]);
      return;
    }
    if (req.orgId) emitDataChanged(req.orgId, resource);
  });

  next();
}
