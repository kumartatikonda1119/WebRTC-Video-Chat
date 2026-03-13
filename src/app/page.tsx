"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [roomId, setRoomId] = useState("");

  const createRoom = () => {
    const generatedId =
      typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}`;
    router.push(`/room/${generatedId}`);
  };

  const joinRoom = () => {
    const value = roomId.trim();
    if (!value) {
      return;
    }

    router.push(`/room/${value}`);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#1f3b5f,#0a1220_45%,#04070d)] px-4 py-10 text-slate-100">
      <section className="w-full max-w-2xl rounded-3xl border border-slate-700/70 bg-slate-900/70 p-8 shadow-2xl backdrop-blur-md md:p-10">
        <p className="mb-4 inline-flex rounded-full border border-cyan-300/40 bg-cyan-500/10 px-4 py-1 text-xs tracking-wide text-cyan-200">
          Next.js + Socket.IO + WebRTC Mesh
        </p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">
          Production-ready Video Chat Rooms
        </h1>
        <p className="mt-4 text-sm text-slate-300 md:text-base">
          Create a private room or join an existing one. The app supports up to
          4 participants with direct peer-to-peer media.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            placeholder="Paste a room ID"
            className="rounded-xl border border-slate-600 bg-slate-950/90 px-4 py-3 text-sm outline-none transition focus:border-cyan-400"
          />
          <button
            type="button"
            onClick={joinRoom}
            className="rounded-xl border border-cyan-500 bg-cyan-500/15 px-5 py-3 text-sm transition hover:bg-cyan-500/30"
          >
            Join Room
          </button>
        </div>

        <button
          type="button"
          onClick={createRoom}
          className="mt-4 w-full rounded-xl border border-emerald-400/60 bg-emerald-500/15 px-5 py-3 text-sm transition hover:bg-emerald-500/30"
        >
          Create New Room
        </button>
      </section>
    </main>
  );
}
