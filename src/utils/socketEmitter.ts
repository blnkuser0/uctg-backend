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
