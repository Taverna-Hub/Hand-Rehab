export type Hand = "left" | "right";
export type RealtimeMode = "buttons" | "pressure";

export interface RealtimeBaseEvent {
  device_id: string;
  session_id: string;
  user_id: string;
  hand: Hand;
  mode: RealtimeMode;
  timestamp_ms: number;
  source_topic?: string;
}

export interface RealtimeButtonEvent extends RealtimeBaseEvent {
  mode: "buttons";
  button_id: number;
  event_type: "pressed" | "released";
}

export interface RealtimePressureEvent extends RealtimeBaseEvent {
  mode: "pressure";
  pressure_raw: number;
  pressure_kpa?: number | null;
}

export type RealtimeEvent = RealtimeButtonEvent | RealtimePressureEvent;
