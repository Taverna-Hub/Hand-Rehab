import type { RealtimeEvent } from "./types";

export type RealtimeMessageHandler = (event: RealtimeEvent) => void;

export function createNodeRedRealtimeClient(url: string, onMessage: RealtimeMessageHandler) {
  const socket = new WebSocket(url);

  socket.addEventListener("message", (message) => {
    const payload = JSON.parse(message.data) as RealtimeEvent;
    onMessage(payload);
  });

  return {
    close: () => socket.close(),
    socket,
  };
}
