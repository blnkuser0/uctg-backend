import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { jwtService } from "../services/jwt.service";
import { setSocketIO } from "../utils/socketEmitter";
import { User } from "../models/User.model";
import { logger } from "../utils/logger";
import { config } from "../config";

interface AuthedSocket extends Socket {
  userId?: string;
  userName?: string;
  organizationId?: string;
}

// Per-org set of currently-online user ids, kept in memory. One user can have several sockets
// open (two tabs, phone + desktop) — `onlineSocketCounts` is what actually decides "online",
// so closing one tab doesn't mark them offline while another is still connected. This lives on
// a single server process; fine for the current single-instance deployment, and nothing here
// is written to the database, so a restart just means everyone re-announces on reconnect.
const orgOnlineUsers = new Map<string, Set<string>>();
const onlineSocketCounts = new Map<string, number>();

function markOnline(organizationId: string, userId: string): boolean {
  const count = (onlineSocketCounts.get(userId) ?? 0) + 1;
  onlineSocketCounts.set(userId, count);
  if (count > 1) return false; // already had another socket open — not a new transition

  if (!orgOnlineUsers.has(organizationId)) orgOnlineUsers.set(organizationId, new Set());
  orgOnlineUsers.get(organizationId)!.add(userId);
  return true;
}

function markOffline(organizationId: string, userId: string): boolean {
  const count = (onlineSocketCounts.get(userId) ?? 1) - 1;
  if (count > 0) {
    onlineSocketCounts.set(userId, count);
    return false; // other sockets for this user are still open
  }
  onlineSocketCounts.delete(userId);
  orgOnlineUsers.get(organizationId)?.delete(userId);
  return true;
}

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: config.server.clientUrl, credentials: true },
    // Tighter than the library defaults (25s/20s, ~45s worst case) so presence "went offline"
    // reflects reality within a reasonable window even when a tab closes/crashes/loses network
    // without sending a clean WebSocket close frame — a "went offline" that lags a minute behind
    // reality isn't very useful. Still generous enough not to flag a normal brief network blip.
    pingInterval: 10000,
    pingTimeout: 8000,
  });

  io.use((socket: AuthedSocket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error("Authentication token missing"));
      const payload = jwtService.verifyAccessToken(token);
      socket.userId = payload.sub;
      socket.userName = payload.name;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket: AuthedSocket) => {
    if (!socket.userId) return;
    socket.join(`user:${socket.userId}`);
    logger.debug({ userId: socket.userId, socketId: socket.id }, "Socket connected");

    // Fire-and-forget: the socket is already usable (message/board events don't need org),
    // presence just joins in a beat later once we know which org room to use.
    void User.findById(socket.userId)
      .select("organizationId")
      .then((user) => {
        if (!user) return;
        const organizationId = user.organizationId.toString();
        socket.organizationId = organizationId;
        socket.join(`org:${organizationId}`);

        // Tell the newly-connected client who's already online before it can have missed any
        // presence:online broadcasts, then tell everyone else about this one.
        socket.emit("presence:snapshot", { userIds: [...(orgOnlineUsers.get(organizationId) ?? [])] });
        if (markOnline(organizationId, socket.userId!)) {
          socket.to(`org:${organizationId}`).emit("presence:online", { userId: socket.userId });
        }
      })
      .catch((err) => logger.error({ err, userId: socket.userId }, "Failed to resolve org for presence"));

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

    // Ephemeral — never persisted, just relayed to whoever else is currently viewing the same
    // channel. The frontend re-sends "start" every couple of seconds while typing and always
    // sends "stop" on blur/send, so a dropped event self-heals within a few seconds either way.
    socket.on("typing:start", (channelId: string) => {
      if (typeof channelId !== "string" || !socket.userId) return;
      socket.to(`channel:${channelId}`).emit("chat:typing", { channelId, userId: socket.userId, name: socket.userName, typing: true });
    });

    socket.on("typing:stop", (channelId: string) => {
      if (typeof channelId !== "string" || !socket.userId) return;
      socket.to(`channel:${channelId}`).emit("chat:typing", { channelId, userId: socket.userId, name: socket.userName, typing: false });
    });

    socket.on("disconnect", () => {
      logger.debug({ userId: socket.userId, socketId: socket.id }, "Socket disconnected");
      if (socket.organizationId && socket.userId && markOffline(socket.organizationId, socket.userId)) {
        socket.to(`org:${socket.organizationId}`).emit("presence:offline", { userId: socket.userId });
      }
    });
  });

  setSocketIO(io);
  return io;
}
