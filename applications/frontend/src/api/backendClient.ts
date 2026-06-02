import type { GameMode, Hand } from "../realtime/types";

type ViteImportMeta = ImportMeta & {
  env?: {
    VITE_BACKEND_API_URL?: string;
  };
};

export type Sex = "female" | "male" | "other" | "not_informed";
export type SessionStatus = "created" | "running" | "finished" | "cancelled" | "error";

export interface UserRead {
  id: string;
  name: string;
  age: number;
  sex: Sex;
  created_at: string;
  updated_at: string;
}

export interface UserCreate {
  name: string;
  age: number;
  sex: Sex;
}

export interface GameSessionRead {
  id: string;
  user_id: string;
  device_id: string;
  hand: Hand;
  mode: GameMode;
  duration_seconds: number | null;
  status: SessionStatus;
  started_at: string;
  scheduled_finish_at: string | null;
  finished_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface GameSessionCreate {
  user_id: string;
  hand: Hand;
  mode: GameMode;
}

export function backendApiUrl() {
  const viteEnv = (import.meta as ViteImportMeta).env;
  if (viteEnv?.VITE_BACKEND_API_URL) {
    return viteEnv.VITE_BACKEND_API_URL.replace(/\/$/, "");
  }

  return `http://${window.location.hostname || "localhost"}:8000`;
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${backendApiUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      detail = payload.detail ?? detail;
    } catch {
      detail = response.statusText || detail;
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export function listUsers() {
  return requestJson<UserRead[]>("/api/v1/users");
}

export function createUser(payload: UserCreate) {
  return requestJson<UserRead>("/api/v1/users", {
    body: JSON.stringify(payload),
    method: "POST",
  });
}

export function listActiveSessions() {
  return requestJson<GameSessionRead[]>("/api/v1/game-sessions/active");
}

export function startGameSession(payload: GameSessionCreate) {
  return requestJson<GameSessionRead>("/api/v1/game-sessions/start", {
    body: JSON.stringify(payload),
    method: "POST",
  });
}

export function finishGameSession(sessionId: string) {
  return requestJson<GameSessionRead>(`/api/v1/game-sessions/${sessionId}/finish`, {
    body: JSON.stringify({}),
    method: "PATCH",
  });
}
