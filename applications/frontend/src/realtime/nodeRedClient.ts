import type { RealtimeEvent } from "./types";

export type RealtimeMessageHandler = (event: RealtimeEvent) => void;
export type RealtimeConnectionStatus = "connecting" | "open" | "closed" | "error";

export interface NodeRedRealtimeClientOptions {
  onMessage: RealtimeMessageHandler;
  onStatus?: (status: RealtimeConnectionStatus) => void;
  onError?: (error: Error) => void;
}

export function createNodeRedRealtimeClient(url: string, options: NodeRedRealtimeClientOptions) {
  const socket = new WebSocket(url);
  options.onStatus?.("connecting");

  socket.addEventListener("open", () => {
    options.onStatus?.("open");
  });

  socket.addEventListener("message", (message) => {
    try {
      const payload = JSON.parse(message.data) as RealtimeEvent;
      options.onMessage(payload);
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error("invalid_realtime_payload"));
    }
  });

  socket.addEventListener("error", () => {
    options.onStatus?.("error");
  });

  socket.addEventListener("close", () => {
    options.onStatus?.("closed");
  });

  return {
    close: () => socket.close(),
    socket,
  };
}
