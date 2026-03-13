import { createServer } from "node:http";
import { parse } from "node:url";

import next from "next";
import { Server } from "socket.io";

import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "./src/types/signaling";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
const port = Number(process.env.PORT ?? 3000);
const MAX_PARTICIPANTS = 4;
const socketCorsOrigin = process.env.SOCKET_IO_CORS_ORIGIN ?? "*";

const roomMembers = new Map<string, Set<string>>();
const socketToRoom = new Map<string, string>();

const relayIfSameRoom = (
  sourceSocketId: string,
  targetSocketId: string,
  action: () => void,
): void => {
  const sourceRoom = socketToRoom.get(sourceSocketId);
  const targetRoom = socketToRoom.get(targetSocketId);

  if (!sourceRoom || !targetRoom || sourceRoom !== targetRoom) {
    return;
  }

  action();
};

const removeSocketFromRoom = (
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  socketId: string,
): void => {
  const roomId = socketToRoom.get(socketId);
  if (!roomId) {
    return;
  }

  const members = roomMembers.get(roomId);
  if (!members) {
    socketToRoom.delete(socketId);
    return;
  }

  members.delete(socketId);
  socketToRoom.delete(socketId);

  io.to(roomId).emit("user-left", { socketId });

  if (members.size === 0) {
    roomMembers.delete(roomId);
  }
};

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "", true);
    handle(req, res, parsedUrl);
  });

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    {
      cors: {
        origin: socketCorsOrigin,
        methods: ["GET", "POST"],
      },
    },
  );

  io.on("connection", (socket) => {
    socket.on("join-room", ({ roomId }) => {
      if (!roomId) {
        socket.emit("error-message", { message: "Invalid room ID." });
        return;
      }

      const currentRoom = socketToRoom.get(socket.id);
      if (currentRoom && currentRoom !== roomId) {
        socket.leave(currentRoom);
        removeSocketFromRoom(io, socket.id);
      }

      const members = roomMembers.get(roomId) ?? new Set<string>();
      if (members.size >= MAX_PARTICIPANTS && !members.has(socket.id)) {
        socket.emit("room-full", { roomId, maxParticipants: MAX_PARTICIPANTS });
        return;
      }

      const existingUsers = Array.from(members).filter(
        (id) => id !== socket.id,
      );
      members.add(socket.id);
      roomMembers.set(roomId, members);
      socketToRoom.set(socket.id, roomId);
      socket.join(roomId);

      socket.emit("room-users", { roomId, users: existingUsers });
      socket.to(roomId).emit("user-joined", { socketId: socket.id });
    });

    socket.on("leave-room", () => {
      const roomId = socketToRoom.get(socket.id);
      if (roomId) {
        socket.leave(roomId);
      }
      removeSocketFromRoom(io, socket.id);
    });

    socket.on("offer", ({ targetSocketId, sdp }) => {
      relayIfSameRoom(socket.id, targetSocketId, () => {
        io.to(targetSocketId).emit("offer", {
          fromSocketId: socket.id,
          sdp,
        });
      });
    });

    socket.on("answer", ({ targetSocketId, sdp }) => {
      relayIfSameRoom(socket.id, targetSocketId, () => {
        io.to(targetSocketId).emit("answer", {
          fromSocketId: socket.id,
          sdp,
        });
      });
    });

    socket.on("ice-candidate", ({ targetSocketId, candidate }) => {
      relayIfSameRoom(socket.id, targetSocketId, () => {
        io.to(targetSocketId).emit("ice-candidate", {
          fromSocketId: socket.id,
          candidate,
        });
      });
    });

    socket.on("chat-message", ({ message }) => {
      const roomId = socketToRoom.get(socket.id);
      if (!roomId) {
        return;
      }

      const trimmed = message.trim();
      if (!trimmed) {
        return;
      }

      io.to(roomId).emit("chat-message", {
        id: `${Date.now()}-${socket.id}`,
        senderSocketId: socket.id,
        message: trimmed,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("disconnect", () => {
      removeSocketFromRoom(io, socket.id);
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
