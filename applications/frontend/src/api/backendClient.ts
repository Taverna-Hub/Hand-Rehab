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

export interface GameplayMetricsPayload {
  total_stimuli: number;
  hits: number;
  errors: number;
  missed_stimuli: number;
  score: number;
  max_combo: number;
  avg_reaction_ms: number | null;
  best_reaction_ms: number | null;
  worst_reaction_ms: number | null;
  accuracy_rate: number | null;
  error_rate: number | null;
  missed_rate: number | null;
  precision_by_lane: Record<string, number>;
}

export interface GameplayMetricsRead extends GameplayMetricsPayload {
  session_id: string;
  user_id: string;
  user_name: string;
  device_id: string;
  hand: Hand;
  mode: GameMode;
  duration_seconds: number | null;
  started_at: string;
  finished_at: string | null;
}

export interface GameSessionFinishPayload {
  notes?: string | null;
  gameplay_metrics?: GameplayMetricsPayload | null;
}

export type BenchmarkStatus = "running" | "completed" | "failed" | "cancelled";
export type BenchmarkStrategy = "ring_buffer" | "inefficient_shift_buffer";
export type BenchmarkOperation = "sliding_insert";

export interface BenchmarkRunCreate {
  device_id?: string;
  sample_counts?: number[];
  iterations?: number;
}

export interface BenchmarkResultRead {
  id: string;
  run_id: string;
  device_id: string;
  strategy: BenchmarkStrategy;
  sample_count: number;
  iterations: number;
  operation: BenchmarkOperation;
  duration_total_us: number;
  latency_us_avg: number;
  latency_us_max: number;
  free_heap_before_bytes: number | null;
  free_heap_after_bytes: number | null;
  min_free_heap_bytes: number | null;
  dropped_samples: number;
  timestamp_ms: number | null;
  source_topic: string | null;
  created_at: string;
}

export interface BenchmarkRunRead {
  id: string;
  device_id: string;
  status: BenchmarkStatus;
  sample_counts: number[];
  strategies: BenchmarkStrategy[];
  iterations: number;
  operation: BenchmarkOperation;
  expected_results: number;
  started_at: string;
  finished_at: string | null;
  last_status: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  results: BenchmarkResultRead[];
}

export interface BenchmarkRunListItem extends Omit<BenchmarkRunRead, "results"> {
  result_count: number;
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

export function finishGameSession(sessionId: string, payload: GameSessionFinishPayload = {}) {
  return requestJson<GameSessionRead>(`/api/v1/game-sessions/${sessionId}/finish`, {
    body: JSON.stringify(payload),
    method: "PATCH",
  });
}

export function listGameplayMetrics() {
  return requestJson<GameplayMetricsRead[]>("/api/v1/metrics/gameplay/sessions");
}

export function startBenchmarkRun(payload: BenchmarkRunCreate = {}) {
  return requestJson<BenchmarkRunRead>("/api/v1/benchmarks/runs", {
    body: JSON.stringify(payload),
    method: "POST",
  });
}

export function listBenchmarkRuns(limit = 20) {
  return requestJson<BenchmarkRunListItem[]>(`/api/v1/benchmarks/runs?limit=${limit}`);
}

export function getBenchmarkRun(runId: string) {
  return requestJson<BenchmarkRunRead>(`/api/v1/benchmarks/runs/${runId}`);
}

export function cancelBenchmarkRun(runId: string, reason = "cancelled_manually") {
  return requestJson<BenchmarkRunRead>(`/api/v1/benchmarks/runs/${runId}/cancel`, {
    body: JSON.stringify({ reason }),
    method: "PATCH",
  });
}

export function cancelActiveBenchmarkRun(reason = "cancelled_manually") {
  return requestJson<BenchmarkRunRead>("/api/v1/benchmarks/runs/active/cancel", {
    body: JSON.stringify({ reason }),
    method: "PATCH",
  });
}
