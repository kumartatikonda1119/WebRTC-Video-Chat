# WebRTC Video Chat (Next.js + TypeScript)

Production-ready multi-peer video chat with WebRTC mesh topology, Socket.IO signaling, and in-room text chat.

## Features

- Custom TypeScript server (`server.ts`) running Next.js + Socket.IO in one process
- Dynamic room routing using App Router: `/room/[roomId]`
- Full WebRTC signaling lifecycle:
  - Offer / answer exchange
  - Trickle ICE candidate exchange
  - Per-peer connection management
- Mesh call support for up to 4 participants
- In-call controls:
  - Mute/unmute microphone
  - Toggle camera on/off
  - Hang up and cleanup resources
- Real-time room chat over existing Socket.IO connection
- One-click invite link copy for room sharing
- Connection status indicators (waiting / connecting / connected)
- Dockerized deployment with health checks

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- React 19
- Socket.IO (server + client)
- WebRTC (`RTCPeerConnection`)
- Tailwind CSS
- Docker / Docker Compose

## Project Structure

```text
.
├─ server.ts
├─ docker-compose.yml
├─ Dockerfile
├─ .env.example
├─ tsconfig.server.json
└─ src
	├─ app
	│  ├─ api/health/route.ts
	│  ├─ room/[roomId]/page.tsx
	│  ├─ page.tsx
	│  └─ layout.tsx
	└─ types/signaling.ts
```

## Environment Variables

Copy `.env.example` to `.env.local` (or `.env`) and update values as needed.

- `PORT`: server port (default `3000`)
- `NEXT_PUBLIC_STUN_SERVER`: STUN server URL exposed to browser
- `SOCKET_IO_CORS_ORIGIN`: CORS origin for signaling server
- `NEXT_PUBLIC_TURN_URL`: optional TURN URL for cross-network reliability
- `NEXT_PUBLIC_TURN_USERNAME`: optional TURN username
- `NEXT_PUBLIC_TURN_CREDENTIAL`: optional TURN credential

## Local Development

```bash
npm install
npm run dev
```

Then open:

- `http://localhost:3000`

## Docker

```bash
docker-compose up --build -d
```

Health check endpoint:

- `GET /api/health`

View container health:

```bash
docker ps
```

## How To Test Calls

1. Open room URL in tab 1.
2. Open the same room URL in tab 2 (or additional tabs up to 4).
3. Grant camera/microphone permissions.
4. Verify remote videos appear in the grid.
5. Test controls:
   - `[data-test-id="mute-mic-button"]`
   - `[data-test-id="toggle-camera-button"]`
   - `[data-test-id="hangup-button"]`
6. Test chat:
   - `[data-test-id="chat-input"]`
   - `[data-test-id="chat-submit"]`
   - `[data-test-id="chat-log"]`
7. Click `Copy Invite Link` and share the URL with another participant.

## Signaling Events

Client -> Server:

- `join-room`
- `leave-room`
- `offer`
- `answer`
- `ice-candidate`
- `chat-message`

Server -> Client:

- `room-users`
- `user-joined`
- `user-left`
- `offer`
- `answer`
- `ice-candidate`
- `chat-message`
- `room-full`
- `error-message`

## Production Notes

- Current setup uses public STUN server by default.
- For broader NAT compatibility, configure TURN env variables in `.env`.
- Mesh topology is appropriate for small rooms (up to 4 users).
- For larger rooms, move to SFU architecture.
