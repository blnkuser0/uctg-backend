import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { jwtService } from "../services/jwt.service";
import { setSocketIO } from "../utils/socketEmitter";
import { logger } from "../utils/logger";
import { config } from "../config";

interface AuthedSocket extends Socket {
  userId?: string;
}

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: config.server.clientUrl, credentials: true },
  });

  io.use((socket: AuthedSocket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error("Authentication token missing"));
      const payload = jwtService.verifyAccessToken(token);
      socket.userId = payload.sub;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket: AuthedSocket) => {
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }
    logger.debug({ userId: socket.userId, socketId: socket.id }, "Socket connected");

    // Board rooms — pm:* events are wired in M3 once Project/Task exist.
    socket.on("project:subscribe", (projectId: string) => {
      if (typeof projectId === "string") socket.join(`project:${projectId}`);
    });

    socket.on("project:unsubscribe", (projectId: string) => {
      if (typeof projectId === "string") socket.leave(`project:${projectId}`);
    });

    socket.on("channel:subscribe", (channelId: string) => {
      if (typeof channelId === "string") socket.join(`channel:${channelId}`);
    });

    socket.on("channel:unsubscribe", (channelId: string) => {
      if (typeof channelId === "string") socket.leave(`channel:${channelId}`);
    });

    socket.on("disconnect", () => {
      logger.debug({ userId: socket.userId, socketId: socket.id }, "Socket disconnected");
    });
  });

  setSocketIO(io);
  return io;
}
