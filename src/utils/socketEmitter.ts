import { Server } from "socket.io";

let ioInstance: Server | null = null;

export function setSocketIO(io: Server): void {
  ioInstance = io;
}

export function getSocketIO(): Server | null {
  return ioInstance;
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  ioInstance?.to(`user:${userId}`).emit(event, payload);
}

export function emitToProject(projectId: string, event: string, payload: unknown): void {
  ioInstance?.to(`project:${projectId}`).emit(event, payload);
}

export function emitToChannel(channelId: string, event: string, payload: unknown): void {
  ioInstance?.to(`channel:${channelId}`).emit(event, payload);
}

export function emitToOrg(organizationId: string, event: string, payload: unknown): void {
  ioInstance?.to(`org:${organizationId}`).emit(event, payload);
}

// ── Live "something changed, refetch" signals ────────────────────────────────────────────────
// Payload-free on purpose: clients just invalidate their own cached queries for that resource and
// refetch through the normal, permission-checked API — so nothing is ever leaked over the socket
// and every viewer (HR, the requester, a manager) ends up with exactly what THEY are allowed to see.

/** Tells everyone connected in this organization that `resource` data changed. */
export function emitDataChanged(organizationId: string, resource: string): void {
  ioInstance?.to(`org:${organizationId}`).emit("data:changed", { resource });
}

/** For changes that cut across organizations (e.g. Super Admin provisioning). */
export function emitDataChangedEverywhere(resources: string[]): void {
  for (const resource of resources) ioInstance?.emit("data:changed", { resource });
}

// A person's open sockets join/leave a project's room the moment their membership changes, so
// project events (pm:*) reach every member on every page — including developers whose home
// organization differs from the project's, who the org room can't reach.
export function joinUserToProject(userId: string, projectId: string): void {
  ioInstance?.in(`user:${userId}`).socketsJoin(`project:${projectId}`);
}

export function removeUserFromProject(userId: string, projectId: string): void {
  ioInstance?.in(`user:${userId}`).socketsLeave(`project:${projectId}`);
}

export function closeProjectRoom(projectId: string): void {
  ioInstance?.in(`project:${projectId}`).socketsLeave(`project:${projectId}`);
}
