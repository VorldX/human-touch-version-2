"use client";

import { io, Socket } from "socket.io-client";

let socketInstance: Socket | null = null;

export function getRealtimeClient(): Socket | null {
  if (typeof window === "undefined") {
    return null;
  }

  const endpoint = process.env.NEXT_PUBLIC_REALTIME_URL?.trim();
  if (!endpoint) {
    return null;
  }

  if (!socketInstance) {
    socketInstance = io(endpoint, {
      transports: ["websocket"],
      autoConnect: true,
      reconnection: true
    });
  }

  return socketInstance;
}
