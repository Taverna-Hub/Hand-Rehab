export type Hand = "left" | "right";
export type GameMode = "buttons" | "pressure";
export type RealtimeMode = GameMode;
export type UiMode = "single" | "four";
export type RealtimeType = "buttons" | "pressure" | "session";

export interface RealtimeBaseEvent {
  device_id: string;
  session_id: string;
  user_id: string;
  hand: Hand;
  mode: RealtimeMode;
  timestamp_ms: number;
  realtime_type?: RealtimeType;
  source_topic?: string;
  sequence?: number;
  error?: string;
}

export interface RealtimeButtonEvent extends RealtimeBaseEvent {
  mode: "buttons";
  realtime_type?: "buttons";
  button_id: number;
  event_type: "pressed" | "released";
}

export interface RealtimePressureEvent extends RealtimeBaseEvent {
  mode: "pressure";
  realtime_type?: "pressure";
  pressure_raw: number;
  pressure_kpa?: number | null;
}

export interface RealtimeSessionEvent {
  device_id: string;
  timestamp_ms: number;
  realtime_type?: "session";
  session_id?: string;
  user_id?: string;
  hand?: Hand;
  mode?: RealtimeMode;
  event_type?: "session_started" | "session_finished" | string;
  status?: string;
  wifi_rssi?: number;
  source_topic?: string;
  error?: string;
}

export type RealtimeEvent = RealtimeButtonEvent | RealtimePressureEvent | RealtimeSessionEvent;
