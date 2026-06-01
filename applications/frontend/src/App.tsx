import { useEffect, useState } from "react";
import { createNodeRedRealtimeClient } from "./realtime/nodeRedClient";
import type { RealtimeEvent } from "./realtime/types";

function nodeRedRealtimeUrl() {
  const viteEnv = (import.meta as ImportMeta & { env?: { VITE_NODE_RED_WS_URL?: string } }).env;
  if (viteEnv?.VITE_NODE_RED_WS_URL) {
    return viteEnv.VITE_NODE_RED_WS_URL;
  }

  return `ws://${window.location.hostname || "localhost"}:1880/ws/realtime`;
}

function printableValue(event: RealtimeEvent) {
  if (event.mode === "buttons") {
    return event.event_type === "pressed" ? String(event.button_id) : null;
  }

  return typeof event.pressure_kpa === "number" ? event.pressure_kpa.toFixed(3) : null;
}

export default function App() {
  const [value, setValue] = useState("");

  useEffect(() => {
    const client = createNodeRedRealtimeClient(nodeRedRealtimeUrl(), (event) => {
      const nextValue = printableValue(event);
      if (nextValue !== null) {
        setValue(nextValue);
      }
    });

    return () => client.close();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-white text-slate-950">
      <output className="text-8xl font-semibold tabular-nums">{value}</output>
    </main>
  );
}
