export type SignalSdp = {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp?: string;
};

export type SignalIceCandidate = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
};

export type JoinRoomPayload = {
  roomId: string;
};

export type RelayOfferPayload = {
  roomId: string;
  targetSocketId: string;
  sdp: SignalSdp;
};

export type RelayAnswerPayload = {
  roomId: string;
  targetSocketId: string;
  sdp: SignalSdp;
};

export type RelayIcePayload = {
  roomId: string;
  targetSocketId: string;
  candidate: SignalIceCandidate;
};

export type ChatSendPayload = {
  roomId: string;
  message: string;
};

export type RoomUsersPayload = {
  roomId: string;
  users: string[];
};

export type UserJoinedPayload = {
  socketId: string;
};

export type UserLeftPayload = {
  socketId: string;
};

export type IncomingOfferPayload = {
  fromSocketId: string;
  sdp: SignalSdp;
};

export type IncomingAnswerPayload = {
  fromSocketId: string;
  sdp: SignalSdp;
};

export type IncomingIcePayload = {
  fromSocketId: string;
  candidate: SignalIceCandidate;
};

export type ChatMessagePayload = {
  id: string;
  senderSocketId: string;
  message: string;
  timestamp: string;
};

export type RoomFullPayload = {
  roomId: string;
  maxParticipants: number;
};

export type ErrorPayload = {
  message: string;
};

export interface ClientToServerEvents {
  "join-room": (payload: JoinRoomPayload) => void;
  "leave-room": (payload: JoinRoomPayload) => void;
  offer: (payload: RelayOfferPayload) => void;
  answer: (payload: RelayAnswerPayload) => void;
  "ice-candidate": (payload: RelayIcePayload) => void;
  "chat-message": (payload: ChatSendPayload) => void;
}

export interface ServerToClientEvents {
  "room-users": (payload: RoomUsersPayload) => void;
  "user-joined": (payload: UserJoinedPayload) => void;
  "user-left": (payload: UserLeftPayload) => void;
  offer: (payload: IncomingOfferPayload) => void;
  answer: (payload: IncomingAnswerPayload) => void;
  "ice-candidate": (payload: IncomingIcePayload) => void;
  "chat-message": (payload: ChatMessagePayload) => void;
  "room-full": (payload: RoomFullPayload) => void;
  "error-message": (payload: ErrorPayload) => void;
}
