"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";

import type {
  ChatMessagePayload,
  ClientToServerEvents,
  ServerToClientEvents,
  SignalIceCandidate,
  SignalSdp,
} from "@/types/signaling";

declare global {
  interface Window {
    __localStream?: MediaStream;
  }
}

type ConnectionStatus = "waiting" | "connecting" | "connected";

const statusText: Record<ConnectionStatus, string> = {
  waiting: "Waiting for others...",
  connecting: "Connecting to peers...",
  connected: "Connected",
};

const getStunServer = (): string =>
  process.env.NEXT_PUBLIC_STUN_SERVER ?? "stun:stun.l.google.com:19302";

const getIceServers = (): RTCIceServer[] => {
  const servers: RTCIceServer[] = [{ urls: [getStunServer()] }];

  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    servers.push({
      urls: [turnUrl],
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
};

const toRtcSdp = (sdp: SignalSdp): RTCSessionDescriptionInit => ({
  type: sdp.type,
  sdp: sdp.sdp,
});

const toRtcCandidate = (
  candidate: SignalIceCandidate,
): RTCIceCandidateInit => ({
  candidate: candidate.candidate,
  sdpMid: candidate.sdpMid,
  sdpMLineIndex: candidate.sdpMLineIndex,
  usernameFragment: candidate.usernameFragment ?? undefined,
});

const toSignalSdp = (sdp: RTCSessionDescriptionInit): SignalSdp => ({
  type: sdp.type,
  sdp: sdp.sdp,
});

const toSignalCandidate = (candidate: RTCIceCandidate): SignalIceCandidate => {
  const serialized = candidate.toJSON();
  return {
    candidate: serialized.candidate ?? "",
    sdpMid: serialized.sdpMid ?? null,
    sdpMLineIndex: serialized.sdpMLineIndex ?? null,
    usernameFragment: serialized.usernameFragment ?? null,
  };
};

function RemoteVideo({
  peerId,
  stream,
}: {
  peerId: string;
  stream: MediaStream;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-950">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="aspect-video w-full object-cover"
        aria-label={`Remote stream from ${peerId}`}
      />
      <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-3 py-1 text-xs text-slate-100">
        {peerId.slice(0, 6)}
      </span>
    </div>
  );
}

export default function RoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = useMemo(
    () => (typeof params?.roomId === "string" ? params.roomId : ""),
    [params?.roomId],
  );
  const router = useRouter();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket<
    ServerToClientEvents,
    ClientToServerEvents
  > | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(
    new Map(),
  );
  const socketIdRef = useRef("");

  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [peerIds, setPeerIds] = useState<string[]>([]);
  const [connectedPeerIds, setConnectedPeerIds] = useState<string[]>([]);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessagePayload[]>([]);
  const [selfSocketId, setSelfSocketId] = useState("");
  const inviteLink = useMemo(() => {
    if (typeof window === "undefined" || !roomId) {
      return "";
    }

    return `${window.location.origin}/room/${roomId}`;
  }, [roomId]);

  const connectionStatus: ConnectionStatus =
    connectedPeerIds.length > 0
      ? "connected"
      : peerIds.length > 0
        ? "connecting"
        : "waiting";

  const removePeer = useCallback((peerId: string) => {
    const peerConnection = peerConnectionsRef.current.get(peerId);
    if (peerConnection) {
      peerConnection.ontrack = null;
      peerConnection.onicecandidate = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
      peerConnectionsRef.current.delete(peerId);
    }

    pendingIceCandidatesRef.current.delete(peerId);

    setPeerIds((prev) => prev.filter((id) => id !== peerId));
    setConnectedPeerIds((prev) => prev.filter((id) => id !== peerId));
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const shouldCreateOffer = useCallback((peerId: string): boolean => {
    if (!socketIdRef.current) {
      return false;
    }

    return socketIdRef.current.localeCompare(peerId) < 0;
  }, []);

  const ensurePeerConnection = useCallback(
    async (peerId: string): Promise<RTCPeerConnection> => {
      const existingPeer = peerConnectionsRef.current.get(peerId);
      if (existingPeer) {
        return existingPeer;
      }

      const peerConnection = new RTCPeerConnection({
        iceServers: getIceServers(),
      });

      const localStream = localStreamRef.current;
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          peerConnection.addTrack(track, localStream);
        });
      }

      peerConnection.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) {
          return;
        }

        setRemoteStreams((prev) => ({
          ...prev,
          [peerId]: stream,
        }));
      };

      peerConnection.onicecandidate = (event) => {
        if (!event.candidate || !socketRef.current || !roomId) {
          return;
        }

        socketRef.current.emit("ice-candidate", {
          roomId,
          targetSocketId: peerId,
          candidate: toSignalCandidate(event.candidate),
        });
      };

      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;

        if (state === "connected") {
          setConnectedPeerIds((prev) =>
            prev.includes(peerId) ? prev : [...prev, peerId],
          );
        }

        if (["failed", "disconnected", "closed"].includes(state)) {
          setConnectedPeerIds((prev) => prev.filter((id) => id !== peerId));
        }

        if (["failed", "closed"].includes(state)) {
          removePeer(peerId);
        }
      };

      peerConnectionsRef.current.set(peerId, peerConnection);
      setPeerIds((prev) => (prev.includes(peerId) ? prev : [...prev, peerId]));
      return peerConnection;
    },
    [removePeer, roomId],
  );

  const flushPendingIceCandidates = useCallback(async (peerId: string) => {
    const peerConnection = peerConnectionsRef.current.get(peerId);
    if (!peerConnection || !peerConnection.remoteDescription) {
      return;
    }

    const queue = pendingIceCandidatesRef.current.get(peerId);
    if (!queue || queue.length === 0) {
      return;
    }

    for (const queuedCandidate of queue) {
      await peerConnection
        .addIceCandidate(queuedCandidate)
        .catch(() => undefined);
    }

    pendingIceCandidatesRef.current.delete(peerId);
  }, []);

  const queueOrAddIceCandidate = useCallback(
    async (peerId: string, candidate: RTCIceCandidateInit) => {
      const peerConnection = await ensurePeerConnection(peerId);

      if (peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(candidate).catch(() => undefined);
        return;
      }

      const currentQueue = pendingIceCandidatesRef.current.get(peerId) ?? [];
      currentQueue.push(candidate);
      pendingIceCandidatesRef.current.set(peerId, currentQueue);
    },
    [ensurePeerConnection],
  );

  const maybeCreateOffer = useCallback(
    async (peerId: string) => {
      if (!socketRef.current || !roomId || !shouldCreateOffer(peerId)) {
        return;
      }

      const peerConnection = await ensurePeerConnection(peerId);

      if (peerConnection.signalingState !== "stable") {
        return;
      }

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      socketRef.current.emit("offer", {
        roomId,
        targetSocketId: peerId,
        sdp: toSignalSdp(offer),
      });
    },
    [ensurePeerConnection, roomId, shouldCreateOffer],
  );

  const hangup = useCallback(
    (redirectToHome: boolean) => {
      const socket = socketRef.current;

      if (socket && socket.connected && roomId) {
        socket.emit("leave-room", { roomId });
      }

      socket?.disconnect();
      socketRef.current = null;

      peerConnectionsRef.current.forEach((peerConnection) => {
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.close();
      });
      peerConnectionsRef.current.clear();
      pendingIceCandidatesRef.current.clear();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      localStreamRef.current = null;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }

      window.__localStream = undefined;
      setRemoteStreams({});
      setPeerIds([]);
      setConnectedPeerIds([]);
      setChatMessages([]);
      setSelfSocketId("");

      if (redirectToHome) {
        router.push("/");
      }
    },
    [roomId, router],
  );

  useEffect(() => {
    if (!roomId) {
      return;
    }

    let isMounted = true;

    const initialize = async () => {
      try {
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (!isMounted) {
          localStream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStreamRef.current = localStream;
        window.__localStream = localStream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        const socket = io({
          transports: ["websocket"],
          reconnection: true,
        });

        socketRef.current = socket;

        socket.on("connect", () => {
          const connectedSocketId = socket.id ?? "";
          socketIdRef.current = connectedSocketId;
          setSelfSocketId(connectedSocketId);
          socket.emit("join-room", { roomId });
        });

        socket.on("disconnect", () => {
          socketIdRef.current = "";
          setSelfSocketId("");
        });

        socket.on("room-users", async ({ users }) => {
          for (const peerId of users) {
            await ensurePeerConnection(peerId);
            await maybeCreateOffer(peerId);
          }
        });

        socket.on("user-joined", async ({ socketId }) => {
          await ensurePeerConnection(socketId);
          await maybeCreateOffer(socketId);
        });

        socket.on("offer", async ({ fromSocketId, sdp }) => {
          const peerConnection = await ensurePeerConnection(fromSocketId);

          if (peerConnection.signalingState !== "stable") {
            await peerConnection
              .setLocalDescription({ type: "rollback" })
              .catch(() => undefined);
          }

          await peerConnection.setRemoteDescription(toRtcSdp(sdp));
          await flushPendingIceCandidates(fromSocketId);
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          socket.emit("answer", {
            roomId,
            targetSocketId: fromSocketId,
            sdp: toSignalSdp(answer),
          });
        });

        socket.on("answer", async ({ fromSocketId, sdp }) => {
          const peerConnection = await ensurePeerConnection(fromSocketId);
          await peerConnection.setRemoteDescription(toRtcSdp(sdp));
          await flushPendingIceCandidates(fromSocketId);
        });

        socket.on("ice-candidate", async ({ fromSocketId, candidate }) => {
          await queueOrAddIceCandidate(fromSocketId, toRtcCandidate(candidate));
        });

        socket.on("user-left", ({ socketId }) => {
          removePeer(socketId);
        });

        socket.on("chat-message", (payload) => {
          setChatMessages((prev) => [...prev, payload]);
        });

        socket.on("room-full", ({ maxParticipants }) => {
          setError(`Room is full. Max participants: ${maxParticipants}.`);
        });

        socket.on("error-message", ({ message }) => {
          setError(message);
        });
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to access camera or microphone.";
        setError(message);
      }
    };

    void initialize();

    return () => {
      isMounted = false;
      hangup(false);
    };
  }, [
    ensurePeerConnection,
    flushPendingIceCandidates,
    hangup,
    maybeCreateOffer,
    queueOrAddIceCandidate,
    removePeer,
    roomId,
  ]);

  const copyInviteLink = useCallback(async () => {
    if (!inviteLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteLink);
      setInfoMessage(
        "Invite link copied. Share it with others to join this room.",
      );
      setTimeout(() => setInfoMessage(null), 2500);
    } catch {
      setInfoMessage(
        "Unable to copy automatically. Copy the room link manually.",
      );
      setTimeout(() => setInfoMessage(null), 2500);
    }
  }, [inviteLink]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    const track = stream?.getAudioTracks()[0];

    if (!track) {
      return;
    }

    track.enabled = !track.enabled;
    setIsMicMuted(!track.enabled);
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    const track = stream?.getVideoTracks()[0];

    if (!track) {
      return;
    }

    track.enabled = !track.enabled;
    setIsCameraOff(!track.enabled);
  }, []);

  const onSubmitChat = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const message = chatInput.trim();
      if (!message || !socketRef.current || !roomId) {
        return;
      }

      socketRef.current.emit("chat-message", {
        roomId,
        message,
      });
      setChatInput("");
    },
    [chatInput, roomId],
  );

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 md:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1fr_340px]">
        <section className="rounded-3xl border border-slate-700/70 bg-slate-900/90 p-4 shadow-2xl backdrop-blur-sm md:p-6">
          <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Room {roomId}
              </h1>
              <p className="text-sm text-slate-400">
                Mesh video chat (max 4 participants)
              </p>
            </div>

            <div className="rounded-full border border-slate-600 bg-slate-800 px-4 py-1 text-sm text-slate-200">
              {statusText[connectionStatus]}
            </div>
          </header>

          <p
            data-test-id="status-waiting"
            className={
              connectionStatus === "waiting"
                ? "mb-3 text-sm text-amber-300"
                : "hidden"
            }
          >
            Waiting for others...
          </p>
          <p
            data-test-id="status-connecting"
            className={
              connectionStatus === "connecting"
                ? "mb-3 text-sm text-cyan-300"
                : "hidden"
            }
          >
            Connecting...
          </p>
          <p
            data-test-id="status-connected"
            className={
              connectionStatus === "connected"
                ? "mb-3 text-sm text-emerald-300"
                : "hidden"
            }
          >
            Connected
          </p>

          {error && (
            <p className="mb-4 rounded-xl border border-rose-400/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
              {error}
            </p>
          )}

          {infoMessage && (
            <p className="mb-4 rounded-xl border border-cyan-400/40 bg-cyan-950/40 px-4 py-3 text-sm text-cyan-200">
              {infoMessage}
            </p>
          )}

          <div className="mb-4 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
            <p className="mb-2 text-xs text-slate-400">
              Invite people using this room link
            </p>
            <div className="flex flex-col gap-2 md:flex-row">
              <input
                value={inviteLink}
                readOnly
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200"
              />
              <button
                type="button"
                data-test-id="copy-invite-button"
                onClick={copyInviteLink}
                className="rounded-lg border border-cyan-500 bg-cyan-500/15 px-4 py-2 text-sm transition hover:bg-cyan-500/30"
              >
                Copy Invite Link
              </button>
            </div>
          </div>

          <div
            data-test-id="remote-video-container"
            className="grid min-h-90 grid-cols-1 gap-4 rounded-2xl border border-slate-700/60 bg-slate-950/70 p-4 md:grid-cols-2"
          >
            {Object.entries(remoteStreams).length === 0 && (
              <div className="col-span-full flex items-center justify-center rounded-xl border border-dashed border-slate-700 text-sm text-slate-400">
                Remote participants will appear here.
              </div>
            )}

            {Object.entries(remoteStreams).map(([peerId, stream]) => (
              <RemoteVideo key={peerId} peerId={peerId} stream={stream} />
            ))}
          </div>

          <div className="pointer-events-none mt-4 flex justify-end md:mt-6">
            <div className="pointer-events-auto w-45 overflow-hidden rounded-xl border border-slate-600 bg-slate-950 shadow-lg">
              <video
                data-test-id="local-video"
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="aspect-video w-full bg-slate-900 object-cover"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-test-id="mute-mic-button"
              onClick={toggleMic}
              className="rounded-full border border-slate-500 px-5 py-2 text-sm transition hover:border-slate-300"
            >
              {isMicMuted ? "Unmute Mic" : "Mute Mic"}
            </button>
            <button
              type="button"
              data-test-id="toggle-camera-button"
              onClick={toggleCamera}
              className="rounded-full border border-slate-500 px-5 py-2 text-sm transition hover:border-slate-300"
            >
              {isCameraOff ? "Turn Camera On" : "Turn Camera Off"}
            </button>
            <button
              type="button"
              data-test-id="hangup-button"
              onClick={() => hangup(true)}
              className="rounded-full border border-rose-500 bg-rose-500/20 px-5 py-2 text-sm text-rose-200 transition hover:bg-rose-500/30"
            >
              Hang Up
            </button>
          </div>
        </section>

        <aside className="flex min-h-130 flex-col rounded-3xl border border-slate-700/70 bg-slate-900/90 p-4 shadow-2xl lg:p-5">
          <h2 className="mb-3 text-lg font-semibold">Room Chat</h2>

          <div
            data-test-id="chat-log"
            className="mb-4 flex-1 space-y-2 overflow-y-auto rounded-xl border border-slate-700/80 bg-slate-950/60 p-3"
          >
            {chatMessages.length === 0 && (
              <p className="text-sm text-slate-500">No messages yet.</p>
            )}

            {chatMessages.map((message) => (
              <div
                key={message.id}
                data-test-id="chat-message"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              >
                <p className="text-xs text-slate-400">
                  {message.senderSocketId === selfSocketId
                    ? "You"
                    : message.senderSocketId.slice(0, 6)}
                </p>
                <p>{message.message}</p>
              </div>
            ))}
          </div>

          <form onSubmit={onSubmitChat} className="flex gap-2">
            <input
              data-test-id="chat-input"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Type a message"
              className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-cyan-400"
            />
            <button
              data-test-id="chat-submit"
              type="submit"
              className="rounded-xl border border-cyan-500 bg-cyan-500/20 px-4 py-2 text-sm transition hover:bg-cyan-500/35"
            >
              Send
            </button>
          </form>
        </aside>
      </div>
    </main>
  );
}
