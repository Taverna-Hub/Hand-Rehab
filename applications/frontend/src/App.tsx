import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  Clock3,
  Gamepad2,
  Gauge,
  Hand as HandIcon,
  Keyboard,
  Plus,
  Save,
  SlidersHorizontal,
  Target,
  Trophy,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  backendApiUrl,
  calibratePressure,
  createUser,
  finishGameSession,
  listActiveSessions,
  listGameplayMetrics,
  listUsers,
  startGameSession,
  type GameplayMetricsPayload,
  type GameplayMetricsRead,
  type GameSessionRead,
  type Sex,
  type UserRead,
} from "./api/backendClient";
import { BenchmarkDashboard } from "./BenchmarkDashboard";
import { createNodeRedRealtimeClient, type RealtimeConnectionStatus } from "./realtime/nodeRedClient";
import logo from "./assets/pictures/logo.png";
import gameMusic from "./assets/sounds/music.mp3";
import lossStreakSound from "./assets/sounds/loss_streak.ogg";
import mistakeSound from "./assets/sounds/mistake.ogg";
import successSound from "./assets/sounds/success.ogg";
import upgradeStreakSound from "./assets/sounds/upgrade_streak.ogg";
import type {
  GameMode,
  Hand,
  RealtimeButtonEvent,
  RealtimeEvent,
  RealtimePressureEvent,
  RealtimeSessionEvent,
  UiMode,
} from "./realtime/types";

const BPM = 80;
const BEAT_INTERVAL_MS = 60_000 / BPM;
const NOTE_LEAD_MS = 2_400;
const HIT_WINDOW_MS = 250;
const PERFECT_WINDOW_MS = 100;
const MISS_GRACE_MS = 90;
const REALTIME_JITTER_GRACE_MS = 30;
const REALTIME_CLOCK_SAMPLE_LIMIT = 20;
const NOTE_FADE_MS = 650;
const FEEDBACK_LIFETIME_MS = 1_250;
const FALLBACK_PRESSURE_HIT_KPA = 0.5;
const DEFAULT_PRESSURE_HIT_DELTA_RAW = 700;
const DEFAULT_PRESSURE_RELEASE_DELTA_RAW = 350;
const PRESSURE_CALIBRATION_TIMEOUT_MS = 12_000;
const HOLD_NOTE_DURATION_MS = BEAT_INTERVAL_MS * 2;
const SESSION_START_COUNTDOWN_MS = 3_000;
const SESSION_START_ACK_TIMEOUT_MS = 8_000;

const FOUR_LANE_PATTERN = [1, 2, 3, 4, 2, 4, 1, 3, 1, 4, 2, 3];

type NoteStatus = "pending" | "holding" | "hit" | "miss";
type HitQuality = "perfect" | "good";
type FeedbackTone = "hit" | "miss" | "neutral";
type IconType = typeof Users;
type Route =
  | { name: "patients" }
  | { name: "patient"; userId: string }
  | { name: "play"; userId: string }
  | { name: "benchmarks" };

interface LaneDefinition {
  id: number;
  label: string;
  color: string;
  soft: string;
  line: string;
}

interface ActiveNote {
  id: string;
  laneId: number;
  hitAt: number;
  status: NoteStatus;
  type: "tap" | "hold";
  holdUntil?: number;
  judgedAt?: number;
  quality?: HitQuality;
}

interface ScoreStats {
  score: number;
  combo: number;
  maxCombo: number;
  hits: number;
  errors: number;
  missedStimuli: number;
  perfects: number;
  goods: number;
  reactionTimesMs: number[];
  laneStats: Record<number, LaneScoreStats>;
}

interface LaneScoreStats {
  stimuli: number;
  hits: number;
}

interface LastInput {
  id: number;
  label: string;
  meta: string;
}

interface RealtimeLatencyDiagnostics {
  inputCompensationMs: number;
  jitterMs: number | null;
  lastSequence: number | null;
  offsetMs: number | null;
  sampleCount: number;
  transportDelayMs: number | null;
}

interface Feedback {
  id: number;
  label: string;
  tone: FeedbackTone;
  laneId: number;
}

type CalibrationPhase = "idle" | "pending" | "queued" | "running" | "completed" | "failed" | "rejected";

interface CalibrationState {
  phase: CalibrationPhase;
  message: string;
}

interface PressureCalibration {
  baselineRaw: number | null;
  calibratedAt: number | null;
  hitThresholdRaw: number;
  noiseRaw: number | null;
  releaseThresholdRaw: number;
}

type LaneCooldowns = Record<number, number>;

const LANES: Record<number, LaneDefinition> = {
  1: { id: 1, label: "Vermelho", color: "#dc2626", soft: "rgba(220, 38, 38, 0.18)", line: "rgba(248, 113, 113, 0.62)" },
  2: { id: 2, label: "Amarelo", color: "#eab308", soft: "rgba(234, 179, 8, 0.2)", line: "rgba(250, 204, 21, 0.66)" },
  3: { id: 3, label: "Verde", color: "#16a34a", soft: "rgba(22, 163, 74, 0.18)", line: "rgba(74, 222, 128, 0.62)" },
  4: { id: 4, label: "Azul", color: "#2563eb", soft: "rgba(37, 99, 235, 0.18)", line: "rgba(96, 165, 250, 0.62)" },
};

type ViteImportMeta = ImportMeta & {
  env?: {
    VITE_NODE_RED_WS_URL?: string;
    VITE_REALTIME_INPUT_LATENCY_MS?: string;
  };
};

function parseRoute(): Route {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const patientMatch = path.match(/^\/patients\/([^/]+)$/);
  const playMatch = path.match(/^\/patients\/([^/]+)\/play$/);

  if (path === "/benchmarks") {
    return { name: "benchmarks" };
  }
  if (playMatch) {
    return { name: "play", userId: decodeURIComponent(playMatch[1]) };
  }
  if (patientMatch) {
    return { name: "patient", userId: decodeURIComponent(patientMatch[1]) };
  }
  return { name: "patients" };
}

function pathFor(route: Route) {
  if (route.name === "patient") {
    return `/patients/${encodeURIComponent(route.userId)}`;
  }
  if (route.name === "play") {
    return `/patients/${encodeURIComponent(route.userId)}/play`;
  }
  if (route.name === "benchmarks") {
    return "/benchmarks";
  }
  return "/";
}

function useRoute() {
  const [route, setRoute] = useState<Route>(() => parseRoute());

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((nextRoute: Route) => {
    const path = pathFor(nextRoute);
    window.history.pushState(null, "", path);
    setRoute(nextRoute);
  }, []);

  return { navigate, route };
}

function initialStats(): ScoreStats {
  return {
    combo: 0,
    errors: 0,
    goods: 0,
    hits: 0,
    laneStats: {
      1: { hits: 0, stimuli: 0 },
      2: { hits: 0, stimuli: 0 },
      3: { hits: 0, stimuli: 0 },
      4: { hits: 0, stimuli: 0 },
    },
    maxCombo: 0,
    missedStimuli: 0,
    perfects: 0,
    reactionTimesMs: [],
    score: 0,
  };
}

function nodeRedRealtimeUrl() {
  const viteEnv = (import.meta as ViteImportMeta).env;
  if (viteEnv?.VITE_NODE_RED_WS_URL) {
    return viteEnv.VITE_NODE_RED_WS_URL;
  }

  return `ws://${window.location.hostname || "localhost"}:1880/ws/realtime`;
}

function realtimeInputLatencyCompensationMs() {
  const viteEnv = (import.meta as ViteImportMeta).env;
  const value = Number(viteEnv?.VITE_REALTIME_INPUT_LATENCY_MS ?? 120);
  return Number.isFinite(value) ? Math.max(0, value) : 120;
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function uiModeToGameMode(mode: UiMode): GameMode {
  return mode === "single" ? "pressure" : "buttons";
}

function gameModeToUiMode(mode: GameMode): UiMode {
  return mode === "pressure" ? "single" : "four";
}

function lanesForMode(mode: UiMode) {
  return mode === "single" ? [LANES[1]] : [LANES[1], LANES[2], LANES[3], LANES[4]];
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function sexLabel(sex: Sex) {
  const labels: Record<Sex, string> = {
    female: "Feminino",
    male: "Masculino",
    not_informed: "Não informado",
    other: "Outro",
  };
  return labels[sex];
}

const SEX_OPTIONS: Array<{ value: Sex; label: string }> = [
  { value: "not_informed", label: "Não informado" },
  { value: "female", label: "Feminino" },
  { value: "male", label: "Masculino" },
  { value: "other", label: "Outro" },
];

function isButtonEvent(event: RealtimeEvent): event is RealtimeButtonEvent {
  return "button_id" in event && event.mode === "buttons";
}

function isPressureEvent(event: RealtimeEvent): event is RealtimePressureEvent {
  return "pressure_raw" in event && event.mode === "pressure";
}

function isSessionEvent(event: RealtimeEvent): event is RealtimeSessionEvent {
  return event.realtime_type === "session" || (!isButtonEvent(event) && !isPressureEvent(event));
}

function sessionEventMatchesGameSession(event: RealtimeSessionEvent, session: GameSessionRead) {
  return (
    event.device_id === session.device_id &&
    event.session_id === session.id &&
    event.user_id === session.user_id &&
    event.hand === session.hand &&
    event.mode === session.mode
  );
}

function realtimeSequence(event: RealtimeEvent) {
  return "sequence" in event && typeof event.sequence === "number" ? event.sequence : null;
}

function describeRealtimeEvent(event: RealtimeEvent): LastInput {
  const now = Date.now();
  if (isButtonEvent(event)) {
    return {
      id: now,
      label: `B${event.button_id} ${event.event_type === "pressed" ? "pressionado" : "solto"}`,
      meta: `${event.hand} | ${event.timestamp_ms} ms`,
    };
  }

  if (isPressureEvent(event)) {
    const pressure = typeof event.pressure_kpa === "number" ? `${event.pressure_kpa.toFixed(2)} kPa` : "sem kPa";
    return {
      id: now,
      label: pressure,
      meta: `${event.hand} | raw ${event.pressure_raw}`,
    };
  }

  return {
    id: now,
    label: event.event_type ?? event.status ?? "sessão",
    meta: `${event.device_id} | ${event.timestamp_ms} ms`,
  };
}

function noteTopPercent(note: ActiveNote, now: number) {
  const progress = 1 - (note.hitAt - now) / NOTE_LEAD_MS;
  return progress * 100 - 8;
}

function noteHoldEndTopPercent(note: ActiveNote, now: number) {
  const progress = 1 - ((note.holdUntil ?? note.hitAt) - now) / NOTE_LEAD_MS;
  return progress * 100 - 8;
}

function seededChance(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function shuffledLanes(sessionId: string, beatIndex: number, lanes: number[]) {
  return [...lanes].sort(
    (left, right) =>
      seededChance(`${sessionId}-${beatIndex}-lane-${left}`) -
      seededChance(`${sessionId}-${beatIndex}-lane-${right}`),
  );
}

function buildNote(sessionId: string, beatIndex: number, laneId: number, gameStart: number, type: "tap" | "hold"): ActiveNote {
  const hitAt = gameStart + NOTE_LEAD_MS + beatIndex * BEAT_INTERVAL_MS;
  return {
    hitAt,
    holdUntil: type === "hold" ? hitAt + HOLD_NOTE_DURATION_MS : undefined,
    id: `${sessionId}-${beatIndex}-${laneId}`,
    laneId,
    status: "pending",
    type,
  };
}

function makeNotes(sessionId: string, beatIndex: number, mode: GameMode, gameStart: number, laneCooldowns: LaneCooldowns): ActiveNote[] {
  const hitAt = gameStart + NOTE_LEAD_MS + beatIndex * BEAT_INTERVAL_MS;
  const allLanes = mode === "pressure" ? [1] : [1, 2, 3, 4];
  const availableLanes = allLanes.filter((laneId) => beatIndex > (laneCooldowns[laneId] ?? -1));

  if (availableLanes.length === 0) {
    return [];
  }

  const holdRoll = seededChance(`${sessionId}-${beatIndex}-hold`);
  const gapRoll = seededChance(`${sessionId}-${beatIndex}-gap`);
  const shouldHold = beatIndex > 7 && holdRoll < (mode === "pressure" ? 0.06 : 0.08);

  if (shouldHold) {
    const chordRoll = seededChance(`${sessionId}-${beatIndex}-hold-chord`);
    const holdCount = mode === "pressure" || availableLanes.length === 1
      ? 1
      : chordRoll > 0.97 && availableLanes.length >= 3
        ? 3
        : chordRoll > 0.84
          ? 2
          : 1;
    const lanes = shuffledLanes(sessionId, beatIndex, availableLanes).slice(0, holdCount);
    for (const laneId of lanes) {
      laneCooldowns[laneId] = beatIndex + Math.ceil((hitAt + HOLD_NOTE_DURATION_MS - hitAt) / BEAT_INTERVAL_MS) + 1;
    }
    return lanes.map((laneId) => buildNote(sessionId, beatIndex, laneId, gameStart, "hold"));
  }

  if (gapRoll > 0.9) {
    return [];
  }

  const chordRoll = seededChance(`${sessionId}-${beatIndex}-tap-chord`);
  const tapCount = mode === "pressure" || availableLanes.length === 1
    ? 1
    : chordRoll > 0.9
      ? 2
      : 1;
  const preferredLane = FOUR_LANE_PATTERN[beatIndex % FOUR_LANE_PATTERN.length];
  const lanes = availableLanes.includes(preferredLane)
    ? [preferredLane, ...shuffledLanes(sessionId, beatIndex, availableLanes.filter((laneId) => laneId !== preferredLane))]
    : shuffledLanes(sessionId, beatIndex, availableLanes);

  return lanes.slice(0, tapCount).map((laneId) => buildNote(sessionId, beatIndex, laneId, gameStart, "tap"));
}

function percent(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return null;
  }
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2));
}

function buildGameplayMetrics(stats: ScoreStats): GameplayMetricsPayload {
  const totalStimuli = Object.values(stats.laneStats).reduce((total, lane) => total + lane.stimuli, 0);
  const totalResponses = stats.hits + stats.errors;
  const precisionByLane = Object.fromEntries(
    Object.entries(stats.laneStats).map(([laneId, lane]) => [laneId, percent(lane.hits, lane.stimuli) ?? 0]),
  );

  return {
    accuracy_rate: percent(stats.hits, totalStimuli),
    avg_reaction_ms: average(stats.reactionTimesMs),
    best_reaction_ms: stats.reactionTimesMs.length > 0 ? Math.min(...stats.reactionTimesMs) : null,
    error_rate: percent(stats.errors, totalResponses),
    errors: stats.errors,
    hits: stats.hits,
    max_combo: stats.maxCombo,
    missed_rate: percent(stats.missedStimuli, totalStimuli),
    missed_stimuli: stats.missedStimuli,
    precision_by_lane: precisionByLane,
    score: stats.score,
    total_stimuli: totalStimuli,
    worst_reaction_ms: stats.reactionTimesMs.length > 0 ? Math.max(...stats.reactionTimesMs) : null,
  };
}

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "--";
}

function formatMs(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value)} ms` : "--";
}

function averageRaw(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) {
    return 0;
  }
  const mean = averageRaw(values) ?? 0;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function pressureInputFromEvent(event: RealtimePressureEvent, wasActive: boolean, calibration: PressureCalibration) {
  const eventIsCalibrated = event.pressure_calibrated === true;
  const eventDeltaRaw = eventIsCalibrated ? numberOrNull(event.pressure_delta_raw) : null;
  const eventBaselineRaw = eventIsCalibrated ? numberOrNull(event.pressure_baseline_raw) : null;
  const localDeltaRaw = calibration.baselineRaw === null ? null : event.pressure_raw - calibration.baselineRaw;
  const eventBaselineDeltaRaw = eventBaselineRaw === null ? null : event.pressure_raw - eventBaselineRaw;
  const rawDelta = eventDeltaRaw ?? eventBaselineDeltaRaw ?? localDeltaRaw;

  if (rawDelta !== null) {
    const deltaRaw = Math.max(0, rawDelta);
    const eventHitThresholdRaw = eventIsCalibrated ? numberOrNull(event.pressure_hit_threshold_raw) : null;
    const eventReleaseThresholdRaw = eventIsCalibrated ? numberOrNull(event.pressure_release_threshold_raw) : null;
    const hitThresholdRaw = Math.max(1, Math.round(eventHitThresholdRaw ?? calibration.hitThresholdRaw));
    const releaseThresholdRaw = Math.min(
      hitThresholdRaw,
      Math.max(1, Math.round(eventReleaseThresholdRaw ?? calibration.releaseThresholdRaw)),
    );
    const thresholdRaw = wasActive ? releaseThresholdRaw : hitThresholdRaw;
    return {
      active: deltaRaw >= thresholdRaw,
      displayValue: deltaRaw,
    };
  }

  const pressureKpa = numberOrNull(event.pressure_kpa);
  return {
    active: pressureKpa !== null && pressureKpa >= FALLBACK_PRESSURE_HIT_KPA,
    displayValue: pressureKpa,
  };
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "--";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function formatApiError(value: string) {
  if (value.toLowerCase() === "not found") {
    return "Recurso não encontrado";
  }
  if (value === "active_session_exists") {
    return "Finalize o jogo ativo antes de continuar.";
  }
  if (value === "esp32_start_ack_timeout") {
    return "A ESP32 não confirmou o início da sessão. Tente iniciar novamente.";
  }
  return value;
}

function initialPressureCalibration(): PressureCalibration {
  return {
    baselineRaw: null,
    calibratedAt: null,
    hitThresholdRaw: DEFAULT_PRESSURE_HIT_DELTA_RAW,
    noiseRaw: null,
    releaseThresholdRaw: DEFAULT_PRESSURE_RELEASE_DELTA_RAW,
  };
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pressureCalibrationFromSessionEvent(event: RealtimeSessionEvent): PressureCalibration | null {
  const baselineRaw = numberOrNull(event.pressure_baseline_raw);
  if (baselineRaw === null) {
    return null;
  }

  const hitThresholdRaw = Math.max(
    1,
    Math.round(numberOrNull(event.pressure_hit_threshold_raw) ?? DEFAULT_PRESSURE_HIT_DELTA_RAW),
  );
  const releaseThresholdRaw = Math.max(
    1,
    Math.round(numberOrNull(event.pressure_release_threshold_raw) ?? Math.max(DEFAULT_PRESSURE_RELEASE_DELTA_RAW, hitThresholdRaw / 2)),
  );

  return {
    baselineRaw,
    calibratedAt: Date.now(),
    hitThresholdRaw,
    noiseRaw: numberOrNull(event.pressure_noise_raw),
    releaseThresholdRaw: Math.min(releaseThresholdRaw, hitThresholdRaw),
  };
}

function pressureCalibrationFromPressureEvent(event: RealtimePressureEvent, current: PressureCalibration): PressureCalibration | null {
  if (event.pressure_calibrated !== true) {
    return null;
  }

  const baselineRaw = numberOrNull(event.pressure_baseline_raw);
  if (baselineRaw === null) {
    return null;
  }

  const hitThresholdRaw = Math.max(
    1,
    Math.round(numberOrNull(event.pressure_hit_threshold_raw) ?? current.hitThresholdRaw),
  );
  const releaseThresholdRaw = Math.max(
    1,
    Math.round(numberOrNull(event.pressure_release_threshold_raw) ?? current.releaseThresholdRaw),
  );

  return {
    baselineRaw,
    calibratedAt: current.calibratedAt ?? Date.now(),
    hitThresholdRaw,
    noiseRaw: current.noiseRaw,
    releaseThresholdRaw: Math.min(releaseThresholdRaw, hitThresholdRaw),
  };
}

function pressureCalibrationChanged(previous: PressureCalibration, next: PressureCalibration) {
  return (
    previous.baselineRaw !== next.baselineRaw ||
    previous.hitThresholdRaw !== next.hitThresholdRaw ||
    previous.noiseRaw !== next.noiseRaw ||
    previous.releaseThresholdRaw !== next.releaseThresholdRaw
  );
}

function calibrationStateFromSessionEvent(event: RealtimeSessionEvent): CalibrationState | null {
  switch (event.status) {
    case "calibration_started":
      return { message: "Calibração em andamento. Mantenha o sensor sem pressão.", phase: "running" };
    case "calibration_completed": {
      const baseline = numberOrNull(event.pressure_baseline_raw);
      const threshold = numberOrNull(event.pressure_hit_threshold_raw);
      if (baseline !== null && threshold !== null) {
        return { message: `Calibração concluída. Base raw ${Math.round(baseline)} | pico +${Math.round(threshold)}.`, phase: "completed" };
      }
      return { message: "Calibração concluída.", phase: "completed" };
    }
    case "calibration_failed":
      return { message: "Falha na calibração. Verifique o sensor e tente novamente.", phase: "failed" };
    case "calibration_rejected":
      return { message: "Dispositivo ocupado. Finalize atividades ativas antes de calibrar.", phase: "rejected" };
    default:
      return null;
  }
}

function modeLabel(mode: GameMode) {
  return mode === "pressure" ? "1 faixa" : "4 faixas";
}

function handLabel(value: Hand) {
  return value === "left" ? "esquerda" : "direita";
}

function summarizeMetrics(metrics: GameplayMetricsRead[]) {
  const finishedSessions = metrics.length;
  const bestScore = Math.max(0, ...metrics.map((metric) => metric.score));
  const bestCombo = Math.max(0, ...metrics.map((metric) => metric.max_combo));
  const totalScore = metrics.reduce((total, metric) => total + metric.score, 0);
  const totalStimuli = metrics.reduce((total, metric) => total + metric.total_stimuli, 0);
  const totalHits = metrics.reduce((total, metric) => total + metric.hits, 0);
  const totalErrors = metrics.reduce((total, metric) => total + metric.errors, 0);
  const totalMissed = metrics.reduce((total, metric) => total + metric.missed_stimuli, 0);
  const reactionValues = metrics
    .map((metric) => metric.avg_reaction_ms)
    .filter((value): value is number => typeof value === "number");
  const bestReactionValues = metrics
    .map((metric) => metric.best_reaction_ms)
    .filter((value): value is number => typeof value === "number");
  const worstReactionValues = metrics
    .map((metric) => metric.worst_reaction_ms)
    .filter((value): value is number => typeof value === "number");

  return {
    averageAccuracy: percent(totalHits, totalStimuli),
    averageError: percent(totalErrors, totalHits + totalErrors),
    averageMissed: percent(totalMissed, totalStimuli),
    averageReaction: average(reactionValues),
    bestCombo,
    bestReaction: bestReactionValues.length > 0 ? Math.min(...bestReactionValues) : null,
    bestScore,
    finishedSessions,
    totalScore,
    worstReaction: worstReactionValues.length > 0 ? Math.max(...worstReactionValues) : null,
  };
}

export default function App() {
  const { navigate, route } = useRoute();
  const [users, setUsers] = useState<UserRead[]>([]);
  const [newUserName, setNewUserName] = useState("");
  const [newUserAge, setNewUserAge] = useState(35);
  const [newUserSex, setNewUserSex] = useState<Sex>("not_informed");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [uiMode, setUiMode] = useState<UiMode>("four");
  const [hand, setHand] = useState<Hand>("right");
  const [activeSession, setActiveSession] = useState<GameSessionRead | null>(null);
  const [pendingSession, setPendingSession] = useState<GameSessionRead | null>(null);
  const [notes, setNotes] = useState<ActiveNote[]>([]);
  const [stats, setStats] = useState<ScoreStats>(initialStats);
  const [dashboardMetrics, setDashboardMetrics] = useState<GameplayMetricsRead[]>([]);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [keyboardInputActive, setKeyboardInputActive] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const [pressedLanes, setPressedLanes] = useState<Record<number, boolean>>({});
  const [pressureValue, setPressureValue] = useState<number | null>(null);
  const [pressureActive, setPressureActive] = useState(false);
  const [sessionWarmupUntilMs, setSessionWarmupUntilMs] = useState<number | null>(null);
  const [gameMusicMuted, setGameMusicMuted] = useState(false);
  const [lastInputs, setLastInputs] = useState<LastInput[]>([]);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [sessionSignal, setSessionSignal] = useState("aguardando");
  const [calibrationState, setCalibrationState] = useState<CalibrationState>({ message: "Pronta para calibrar.", phase: "idle" });
  const [pressureCalibration, setPressureCalibration] = useState<PressureCalibration>(() => initialPressureCalibration());
  const [connectionStatus, setConnectionStatus] = useState<RealtimeConnectionStatus>("connecting");
  const [latencyDiagnostics, setLatencyDiagnostics] = useState<RealtimeLatencyDiagnostics>(() => ({
    inputCompensationMs: realtimeInputLatencyCompensationMs(),
    jitterMs: null,
    lastSequence: null,
    offsetMs: null,
    sampleCount: 0,
    transportDelayMs: null,
  }));
  const [loading, setLoading] = useState(true);
  const [apiBusy, setApiBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const activeSessionRef = useRef<GameSessionRead | null>(null);
  const pendingSessionRef = useRef<GameSessionRead | null>(null);
  const notesRef = useRef<ActiveNote[]>([]);
  const statsRef = useRef<ScoreStats>(stats);
  const pressedLanesRef = useRef<Record<number, boolean>>({});
  const pressureActiveRef = useRef(false);
  const pressureAboveThresholdRef = useRef(false);
  const pressureCalibrationRef = useRef<PressureCalibration>(pressureCalibration);
  const localGameStartRef = useRef<number | null>(null);
  const nextBeatIndexRef = useRef(0);
  const noteLaneCooldownsRef = useRef<LaneCooldowns>({});
  const feedbackIdRef = useRef(0);
  const realtimeClockOffsetsRef = useRef<number[]>([]);
  const realtimeInputCompensationMsRef = useRef(realtimeInputLatencyCompensationMs());
  const realtimeLastSequenceRef = useRef<Record<string, number>>({});
  const realtimeSessionStartedRef = useRef<Record<string, RealtimeSessionEvent>>({});
  const realtimeTransportDelaysRef = useRef<number[]>([]);
  const sessionWarmupUntilMsRef = useRef<number | null>(null);
  const gameMusicRef = useRef<HTMLAudioElement | null>(null);
  const lossStreakSoundRef = useRef<HTMLAudioElement | null>(null);
  const mistakeSoundRef = useRef<HTMLAudioElement | null>(null);
  const successSoundRef = useRef<HTMLAudioElement | null>(null);
  const upgradeStreakSoundRef = useRef<HTMLAudioElement | null>(null);

  const routeUserId = route.name === "patient" || route.name === "play" ? route.userId : "";
  const currentUserId = routeUserId || selectedUserId;
  const selectedUser = users.find((user) => user.id === currentUserId);
  const activeUiMode = activeSession ? gameModeToUiMode(activeSession.mode) : uiMode;
  const activeLanes = useMemo(() => lanesForMode(activeUiMode), [activeUiMode]);
  const laneGridStyle = useMemo<CSSProperties>(
    () => ({ gridTemplateColumns: `repeat(${activeLanes.length}, minmax(0, 1fr))` }),
    [activeLanes.length],
  );
  const patientMetrics = useMemo(
    () => dashboardMetrics.filter((metric) => metric.user_id === currentUserId),
    [currentUserId, dashboardMetrics],
  );
  const dashboardSummary = useMemo(() => summarizeMetrics(patientMetrics), [patientMetrics]);
  const globalSummary = useMemo(() => summarizeMetrics(dashboardMetrics), [dashboardMetrics]);

  const startGameMusic = useCallback(() => {
    if (!gameMusicRef.current) {
      gameMusicRef.current = new Audio(gameMusic);
      gameMusicRef.current.loop = true;
      gameMusicRef.current.volume = 0.05;
    }

    gameMusicRef.current.volume = 0.05;
    gameMusicRef.current.muted = gameMusicMuted;
    return gameMusicRef.current.play().catch(() => undefined);
  }, [gameMusicMuted]);

  const stopGameMusic = useCallback(() => {
    if (!gameMusicRef.current) {
      return;
    }

    gameMusicRef.current.pause();
    gameMusicRef.current.currentTime = 0;
  }, []);

  const handleGameMusicMutedChange = useCallback((muted: boolean) => {
    setGameMusicMuted(muted);
    if (gameMusicRef.current) {
      gameMusicRef.current.muted = muted;
      gameMusicRef.current.volume = 0.5;
    }
    if (successSoundRef.current) {
      successSoundRef.current.muted = muted;
    }
    if (mistakeSoundRef.current) {
      mistakeSoundRef.current.muted = muted;
    }
    if (upgradeStreakSoundRef.current) {
      upgradeStreakSoundRef.current.muted = muted;
    }
    if (lossStreakSoundRef.current) {
      lossStreakSoundRef.current.muted = muted;
    }
  }, []);

  const playGameSound = useCallback(
    (type: "success" | "mistake" | "upgradeStreak" | "lossStreak") => {
      if (gameMusicMuted || route.name !== "play") {
        return;
      }

      const soundConfig = {
        lossStreak: { ref: lossStreakSoundRef, src: lossStreakSound, volume: 0.62 },
        mistake: { ref: mistakeSoundRef, src: mistakeSound, volume: 0.48 },
        success: { ref: successSoundRef, src: successSound, volume: 0.55 },
        upgradeStreak: { ref: upgradeStreakSoundRef, src: upgradeStreakSound, volume: 0.66 },
      }[type];
      const sourceRef = soundConfig.ref;
      if (!sourceRef.current) {
        sourceRef.current = new Audio(soundConfig.src);
        sourceRef.current.volume = soundConfig.volume;
      }

      const sound = sourceRef.current.cloneNode(true) as HTMLAudioElement;
      sound.volume = sourceRef.current.volume;
      sound.muted = gameMusicMuted;
      void sound.play().catch(() => undefined);
    },
    [gameMusicMuted, route.name],
  );
  const elapsedSeconds = activeSession
    ? Math.max(0, Math.floor((Date.now() - Date.parse(activeSession.started_at)) / 1000))
    : 0;
  const sessionWarmupRemainingMs = sessionWarmupUntilMs
    ? Math.max(0, Math.ceil(sessionWarmupUntilMs - (nowMs || performance.now())))
    : 0;

  useEffect(() => {
    if (routeUserId) {
      setSelectedUserId(routeUserId);
    }
  }, [routeUserId]);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    pendingSessionRef.current = pendingSession;
  }, [pendingSession]);

  useEffect(() => {
    if (route.name === "play" && activeSession) {
      void startGameMusic();
      return;
    }

    stopGameMusic();
  }, [activeSession, route.name, startGameMusic, stopGameMusic]);

  useEffect(() => () => stopGameMusic(), [stopGameMusic]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  useEffect(() => {
    pressedLanesRef.current = pressedLanes;
  }, [pressedLanes]);

  useEffect(() => {
    pressureActiveRef.current = pressureActive;
  }, [pressureActive]);

  useEffect(() => {
    pressureCalibrationRef.current = pressureCalibration;
  }, [pressureCalibration]);

  useEffect(() => {
    sessionWarmupUntilMsRef.current = sessionWarmupUntilMs;
  }, [sessionWarmupUntilMs]);

  useEffect(() => {
    if (!["pending", "queued", "running"].includes(calibrationState.phase)) {
      return;
    }

    const phase = calibrationState.phase;
    const timeout = window.setTimeout(() => {
      setCalibrationState((current) =>
        current.phase === phase
          ? { message: "Tempo esgotado aguardando confirmação da ESP32.", phase: "failed" }
          : current,
      );
    }, PRESSURE_CALIBRATION_TIMEOUT_MS);

    return () => window.clearTimeout(timeout);
  }, [calibrationState.phase]);

  useEffect(() => {
    if (!pendingSession) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const currentPending = pendingSessionRef.current;
      if (!currentPending || currentPending.id !== pendingSession.id) {
        return;
      }

      pendingSessionRef.current = null;
      setPendingSession(null);
      setSessionSignal("ACK não recebido");
      setApiError("esp32_start_ack_timeout");
      setApiBusy(true);

      void finishGameSession(currentPending.id, { notes: "start_ack_timeout" })
        .catch((error) => {
          setApiError(error instanceof Error ? error.message : "erro_ao_cancelar_inicio");
        })
        .finally(() => {
          setApiBusy(false);
        });
    }, SESSION_START_ACK_TIMEOUT_MS);

    return () => window.clearTimeout(timeout);
  }, [pendingSession]);

  const pushFeedback = useCallback((label: string, tone: FeedbackTone, laneId = 1) => {
    feedbackIdRef.current += 1;
    const feedback: Feedback = {
      id: feedbackIdRef.current,
      label,
      laneId,
      tone,
    };
    setFeedbacks((current) => [...current.slice(-7), feedback]);
    window.setTimeout(() => {
      setFeedbacks((current) => current.filter((item) => item.id !== feedback.id));
    }, FEEDBACK_LIFETIME_MS);
  }, []);

  const isStaleRealtimeSequence = useCallback((event: RealtimeEvent) => {
    const sequence = realtimeSequence(event);
    if (sequence === null) {
      return false;
    }

    const key = `${event.device_id}:${event.source_topic ?? event.mode}`;
    const previousSequence = realtimeLastSequenceRef.current[key];
    if (typeof previousSequence === "number" && sequence <= previousSequence) {
      return true;
    }

    realtimeLastSequenceRef.current[key] = sequence;
    return false;
  }, []);

  const getCorrectedRealtimeInputTime = useCallback((event: RealtimeEvent, receivedAt = performance.now()) => {
    if (typeof event.timestamp_ms !== "number" || !Number.isFinite(event.timestamp_ms)) {
      return receivedAt;
    }

    const offsets = [...realtimeClockOffsetsRef.current, receivedAt - event.timestamp_ms].slice(-REALTIME_CLOCK_SAMPLE_LIMIT);
    realtimeClockOffsetsRef.current = offsets;

    const averageOffset = averageRaw(offsets) ?? offsets[offsets.length - 1] ?? 0;
    const jitterMs = standardDeviation(offsets);
    const inputCompensationMs = realtimeInputCompensationMsRef.current;
    const correctedInputTime = Math.min(receivedAt, event.timestamp_ms + averageOffset - inputCompensationMs);
    const transportDelayMs = Math.max(0, receivedAt - correctedInputTime);

    realtimeTransportDelaysRef.current = [...realtimeTransportDelaysRef.current, transportDelayMs].slice(
      -REALTIME_CLOCK_SAMPLE_LIMIT,
    );

    setLatencyDiagnostics({
      inputCompensationMs,
      jitterMs,
      lastSequence: realtimeSequence(event),
      offsetMs: averageOffset,
      sampleCount: offsets.length,
      transportDelayMs: averageRaw(realtimeTransportDelaysRef.current),
    });

    return correctedInputTime;
  }, []);

  const resetLocalGame = useCallback(() => {
    const now = performance.now();
    localGameStartRef.current = now;
    nextBeatIndexRef.current = 0;
    noteLaneCooldownsRef.current = {};
    notesRef.current = [];
    pressureAboveThresholdRef.current = false;
    realtimeClockOffsetsRef.current = [];
    realtimeTransportDelaysRef.current = [];
    setKeyboardInputActive(false);
    setNowMs(now);
    setNotes([]);
    setStats(initialStats());
    setPressedLanes({});
    setPressureValue(null);
    setPressureActive(false);
    setFeedbacks([]);
    setLatencyDiagnostics((current) => ({
      ...current,
      jitterMs: null,
      lastSequence: null,
      offsetMs: null,
      sampleCount: 0,
      transportDelayMs: null,
    }));
  }, []);

  const applyActiveSession = useCallback(
    (session: GameSessionRead) => {
      pendingSessionRef.current = null;
      setPendingSession(null);
      activeSessionRef.current = session;
      setActiveSession(session);
      setUiMode(gameModeToUiMode(session.mode));
      setHand(session.hand);
      setSelectedUserId(session.user_id);
      setSessionSignal("sessão ativa");
      resetLocalGame();
      setSessionWarmupUntilMs(performance.now() + SESSION_START_COUNTDOWN_MS);
    },
    [resetLocalGame],
  );

  const completePendingSessionStart = useCallback(
    (session: GameSessionRead) => {
      applyActiveSession(session);
      setApiError(null);
      pushFeedback("Vai", "neutral");
    },
    [applyActiveSession, pushFeedback],
  );

  const refreshUsers = useCallback(async () => {
    const loadedUsers = await listUsers();
    setUsers(loadedUsers);
    setSelectedUserId((current) => current || loadedUsers[0]?.id || "");
    return loadedUsers;
  }, []);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      setLoading(true);
      setApiError(null);
      try {
        const [loadedUsers, sessions] = await Promise.all([listUsers(), listActiveSessions()]);
        const metrics = await listGameplayMetrics().catch((metricsLoadError) => {
          setMetricsError(metricsLoadError instanceof Error ? metricsLoadError.message : "erro_ao_carregar_metricas");
          return [];
        });
        if (!mounted) {
          return;
        }
        setUsers(loadedUsers);
        setDashboardMetrics(metrics);
        setSelectedUserId((current) => current || routeUserId || sessions[0]?.user_id || loadedUsers[0]?.id || "");
        if (sessions[0]) {
          applyActiveSession(sessions[0]);
        }
      } catch (error) {
        if (mounted) {
          setApiError(error instanceof Error ? error.message : "erro_ao_carregar");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void boot();
    return () => {
      mounted = false;
    };
  }, [applyActiveSession, routeUserId]);

  const registerError = useCallback(
    (label = "Erro", laneId = 1) => {
      setStats((current) => ({ ...current, combo: 0, errors: current.errors + 1 }));
      playGameSound("mistake");
      pushFeedback(label, "miss", laneId);
    },
    [playGameSound, pushFeedback],
  );

  const awardHit = useCallback(
    (laneId: number, quality: HitQuality, reactionMs: number, pointsBonus = 0) => {
      const points = quality === "perfect" ? 120 : 80;
      playGameSound("success");
      setStats((current) => {
        const combo = current.combo + 1;
        return {
          ...current,
          combo,
          goods: current.goods + (quality === "good" ? 1 : 0),
          hits: current.hits + 1,
          laneStats: {
            ...current.laneStats,
            [laneId]: {
              hits: (current.laneStats[laneId]?.hits ?? 0) + 1,
              stimuli: current.laneStats[laneId]?.stimuli ?? 0,
            },
          },
          maxCombo: Math.max(current.maxCombo, combo),
          perfects: current.perfects + (quality === "perfect" ? 1 : 0),
          reactionTimesMs: [...current.reactionTimesMs, reactionMs],
          score: current.score + points + pointsBonus + Math.min(current.combo * 2, 50),
        };
      });
    },
    [playGameSound],
  );

  const releaseHold = useCallback(
    (laneId: number, inputTime = performance.now(), hitWindowMs = HIT_WINDOW_MS) => {
      const holdingNote = notesRef.current.find((note) => note.status === "holding" && note.laneId === laneId);
      if (!holdingNote) {
        return;
      }

      const holdUntil = holdingNote.holdUntil ?? holdingNote.hitAt;
      const completed = inputTime >= holdUntil - hitWindowMs;
      const nextNotes = notesRef.current.map((note) =>
        note.id === holdingNote.id
          ? { ...note, judgedAt: inputTime, status: completed ? "hit" as const : "miss" as const }
          : note,
      );
      notesRef.current = nextNotes;
      setNotes(nextNotes);

      if (completed) {
        awardHit(laneId, holdingNote.quality ?? "good", Math.max(0, Math.round(inputTime - holdingNote.hitAt)), 180);
        pushFeedback("Segurou", "hit", laneId);
        return;
      }

      registerError("Soltou", laneId);
    },
    [awardHit, pushFeedback, registerError],
  );

  const registerHit = useCallback(
    (laneId: number, inputTime = performance.now(), hitWindowMs = HIT_WINDOW_MS) => {
      if (notesRef.current.some((note) => note.status === "holding" && note.laneId === laneId)) {
        return;
      }

      const candidate = notesRef.current
        .filter((note) => note.status === "pending" && note.laneId === laneId)
        .map((note) => ({ note, delta: Math.abs(note.hitAt - inputTime) }))
        .filter(({ delta }) => delta <= hitWindowMs)
        .sort((left, right) => left.delta - right.delta)[0];

      if (!candidate) {
        registerError("Fora", laneId);
        return;
      }

      const quality: HitQuality = candidate.delta <= PERFECT_WINDOW_MS ? "perfect" : "good";
      const judgedAt = inputTime;
      const reactionMs = Math.round(candidate.delta);
      if (candidate.note.type === "hold") {
        const nextNotes = notesRef.current.map((note) =>
          note.id === candidate.note.id ? { ...note, judgedAt, quality, status: "holding" as const } : note,
        );
        notesRef.current = nextNotes;
        setNotes(nextNotes);
        pushFeedback("Segure", "hit", laneId);
        return;
      }

      const nextNotes = notesRef.current.map((note) =>
        note.id === candidate.note.id ? { ...note, judgedAt, quality, status: "hit" as const } : note,
      );
      notesRef.current = nextNotes;
      setNotes(nextNotes);
      awardHit(laneId, quality, reactionMs);
      pushFeedback(quality === "perfect" ? "Perfeito" : "Bom", "hit", laneId);
    },
    [awardHit, pushFeedback, registerError],
  );

  const recordRealtimeInput = useCallback((event: RealtimeEvent) => {
    const input = describeRealtimeEvent(event);
    setLastInputs((current) => [input, ...current].slice(0, 5));
  }, []);

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      const receivedAt = performance.now();
      recordRealtimeInput(event);

      if (isSessionEvent(event)) {
        setSessionSignal(event.event_type ?? event.status ?? "sessão");
        const nextCalibrationState = calibrationStateFromSessionEvent(event);
        if (nextCalibrationState) {
          setCalibrationState(nextCalibrationState);
        }
        if (event.status === "calibration_completed") {
          const nextPressureCalibration = pressureCalibrationFromSessionEvent(event);
          if (nextPressureCalibration) {
            setPressureCalibration(nextPressureCalibration);
          }
        }
        if (event.event_type === "session_started" && event.session_id) {
          realtimeSessionStartedRef.current = {
            ...realtimeSessionStartedRef.current,
            [event.session_id]: event,
          };

          const pending = pendingSessionRef.current;
          if (pending && sessionEventMatchesGameSession(event, pending)) {
            completePendingSessionStart(pending);
          }
        }
        return;
      }

      const session = activeSessionRef.current;
      if (
        !session ||
        event.session_id !== session.id ||
        event.hand !== session.hand ||
        event.mode !== session.mode
      ) {
        return;
      }

      if (isStaleRealtimeSequence(event)) {
        return;
      }

      const inputTime = getCorrectedRealtimeInputTime(event, receivedAt);
      const realtimeHitWindowMs = HIT_WINDOW_MS + REALTIME_JITTER_GRACE_MS;
      const isWarmingUp = Boolean(sessionWarmupUntilMsRef.current && receivedAt < sessionWarmupUntilMsRef.current);

      if (isButtonEvent(event)) {
        setPressedLanes((current) => ({ ...current, [event.button_id]: event.event_type === "pressed" }));
        if (isWarmingUp) {
          return;
        }
        if (event.event_type === "pressed") {
          registerHit(event.button_id, inputTime, realtimeHitWindowMs);
        } else {
          releaseHold(event.button_id, inputTime, realtimeHitWindowMs);
        }
        return;
      }

      if (isPressureEvent(event)) {
        let effectivePressureCalibration = pressureCalibrationRef.current;
        const eventPressureCalibration = pressureCalibrationFromPressureEvent(event, effectivePressureCalibration);
        if (eventPressureCalibration !== null) {
          effectivePressureCalibration = eventPressureCalibration;
          if (pressureCalibrationChanged(pressureCalibrationRef.current, eventPressureCalibration)) {
            pressureCalibrationRef.current = eventPressureCalibration;
            setPressureCalibration(eventPressureCalibration);
          }
        }

        const pressureInput = pressureInputFromEvent(event, pressureAboveThresholdRef.current, effectivePressureCalibration);
        setPressureValue(pressureInput.displayValue);

        const isAboveThreshold = pressureInput.active;
        setPressureActive(isAboveThreshold);
        if (isWarmingUp) {
          pressureAboveThresholdRef.current = isAboveThreshold;
          return;
        }
        if (isAboveThreshold && !pressureAboveThresholdRef.current) {
          registerHit(1, inputTime, realtimeHitWindowMs);
        } else if (!isAboveThreshold && pressureAboveThresholdRef.current) {
          releaseHold(1, inputTime, realtimeHitWindowMs);
        }
        pressureAboveThresholdRef.current = isAboveThreshold;
      }
    },
    [
      completePendingSessionStart,
      getCorrectedRealtimeInputTime,
      isStaleRealtimeSequence,
      recordRealtimeInput,
      registerHit,
      releaseHold,
    ],
  );

  useEffect(() => {
    const client = createNodeRedRealtimeClient(nodeRedRealtimeUrl(), {
      onError: (error) => setApiError(error.message),
      onMessage: handleRealtimeEvent,
      onStatus: setConnectionStatus,
    });

    return () => client.close();
  }, [handleRealtimeEvent]);

  useEffect(() => {
    if (!activeSession || !keyboardInputActive) {
      return;
    }

    const laneByKey: Record<string, number> = {
      "1": 1,
      "2": 2,
      "3": 3,
      "4": 4,
      a: 1,
      s: 2,
      d: 3,
      f: 4,
    };

    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      return ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      const isWarmingUp = Boolean(sessionWarmupUntilMsRef.current && performance.now() < sessionWarmupUntilMsRef.current);
      const isPressureKey = key === " " || key === "spacebar" || key === "1" || key === "a";
      if (activeSession.mode === "pressure") {
        if (!isPressureKey) {
          return;
        }
        event.preventDefault();
        setPressureActive(true);
        setPressureValue(pressureCalibrationRef.current.hitThresholdRaw);
        if (isWarmingUp) {
          return;
        }
        registerHit(1);
        return;
      }

      const laneId = laneByKey[key];
      if (!laneId) {
        return;
      }
      event.preventDefault();
      setPressedLanes((current) => ({ ...current, [laneId]: true }));
      if (isWarmingUp) {
        return;
      }
      registerHit(laneId);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      const isWarmingUp = Boolean(sessionWarmupUntilMsRef.current && performance.now() < sessionWarmupUntilMsRef.current);
      if (activeSession.mode === "pressure" && (key === " " || key === "spacebar" || key === "1" || key === "a")) {
        setPressureActive(false);
        setPressureValue(null);
        if (isWarmingUp) {
          return;
        }
        releaseHold(1);
        return;
      }

      const laneId = laneByKey[key];
      if (laneId) {
        setPressedLanes((current) => ({ ...current, [laneId]: false }));
        if (isWarmingUp) {
          return;
        }
        releaseHold(laneId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [activeSession, keyboardInputActive, registerHit, releaseHold]);

  useEffect(() => {
    if (!activeSession || route.name !== "play") {
      return;
    }

    let frame = 0;
    const tick = () => {
      const now = performance.now();
      const warmupUntil = sessionWarmupUntilMsRef.current;
      if (warmupUntil && now < warmupUntil) {
        localGameStartRef.current = null;
        nextBeatIndexRef.current = 0;
        if (notesRef.current.length > 0) {
          notesRef.current = [];
          setNotes([]);
        }
        setNowMs(now);
        frame = requestAnimationFrame(tick);
        return;
      }

      if (warmupUntil && now >= warmupUntil) {
        sessionWarmupUntilMsRef.current = null;
        setSessionWarmupUntilMs(null);
      }

      const gameStart = localGameStartRef.current ?? now;
      localGameStartRef.current = gameStart;
      setNowMs(now);

      const spawnedNotes: ActiveNote[] = [];
      while (gameStart + nextBeatIndexRef.current * BEAT_INTERVAL_MS <= now) {
        spawnedNotes.push(
          ...makeNotes(
            activeSession.id,
            nextBeatIndexRef.current,
            activeSession.mode,
            gameStart,
            noteLaneCooldownsRef.current,
          ),
        );
        nextBeatIndexRef.current += 1;
      }

      const missedByLane: Record<number, number> = {};
      const stimuliByLane = spawnedNotes.reduce<Record<number, number>>((counts, note) => {
        counts[note.laneId] = (counts[note.laneId] ?? 0) + 1;
        return counts;
      }, {});
      const completedHolds: ActiveNote[] = [];
      const next = [...notesRef.current, ...spawnedNotes]
        .map((note) => {
          if (note.status === "pending" && now - note.hitAt > MISS_GRACE_MS) {
            missedByLane[note.laneId] = (missedByLane[note.laneId] ?? 0) + 1;
            return { ...note, judgedAt: now, status: "miss" as const };
          }
          if (note.status === "holding" && now >= (note.holdUntil ?? note.hitAt)) {
            const isLaneHeld = activeSession.mode === "pressure"
              ? pressureActiveRef.current
              : Boolean(pressedLanesRef.current[note.laneId]);
            if (isLaneHeld) {
              completedHolds.push(note);
              return { ...note, judgedAt: now, status: "hit" as const };
            }
            missedByLane[note.laneId] = (missedByLane[note.laneId] ?? 0) + 1;
            return { ...note, judgedAt: now, status: "miss" as const };
          }
          return note;
        })
        .filter((note) => {
          if (note.status === "pending" || note.status === "holding") {
            return (note.holdUntil ?? note.hitAt) - now > -1_200;
          }
          return now - (note.judgedAt ?? note.hitAt) < NOTE_FADE_MS;
        });

      for (const note of completedHolds) {
        awardHit(note.laneId, note.quality ?? "good", Math.max(0, Math.round(now - note.hitAt)), 180);
        pushFeedback("Segurou", "hit", note.laneId);
      }

      const missed = Object.values(missedByLane).reduce((total, amount) => total + amount, 0);
      if (missed > 0) {
        playGameSound("mistake");
        setStats((currentStats) => ({
          ...currentStats,
          combo: 0,
          missedStimuli: currentStats.missedStimuli + missed,
        }));
        const firstMissedLane = Number(Object.keys(missedByLane)[0] ?? 1);
        pushFeedback("Errou", "miss", firstMissedLane);
      }

      if (Object.keys(stimuliByLane).length > 0) {
        setStats((currentStats) => {
          const laneStats = { ...currentStats.laneStats };
          for (const [laneIdText, amount] of Object.entries(stimuliByLane)) {
            const laneId = Number(laneIdText);
            laneStats[laneId] = {
              hits: laneStats[laneId]?.hits ?? 0,
              stimuli: (laneStats[laneId]?.stimuli ?? 0) + amount,
            };
          }
          return { ...currentStats, laneStats };
        });
      }

      notesRef.current = next;
      setNotes(next);

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [activeSession, awardHit, playGameSound, pushFeedback, route.name]);

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiBusy(true);
    setApiError(null);
    try {
      const user = await createUser({ age: newUserAge, name: newUserName.trim(), sex: newUserSex });
      const loadedUsers = await refreshUsers();
      setUsers([user, ...loadedUsers.filter((item) => item.id !== user.id)]);
      setSelectedUserId(user.id);
      setNewUserName("");
      setNewUserAge(35);
      setNewUserSex("not_informed");
      setCreateModalOpen(false);
      navigate({ name: "patient", userId: user.id });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "erro_ao_criar_usuario");
    } finally {
      setApiBusy(false);
    }
  }

  async function handleStartSession() {
    if (!currentUserId) {
      setApiError("selecione_um_paciente");
      return;
    }

    setApiBusy(true);
    setApiError(null);
    try {
      const session = await startGameSession({
        hand,
        mode: uiModeToGameMode(uiMode),
        user_id: currentUserId,
      });

      const alreadyAcknowledged = realtimeSessionStartedRef.current[session.id];
      if (alreadyAcknowledged && sessionEventMatchesGameSession(alreadyAcknowledged, session)) {
        completePendingSessionStart(session);
      } else {
        pendingSessionRef.current = session;
        setPendingSession(session);
        setSelectedUserId(session.user_id);
        setSessionSignal("aguardando ACK da ESP32");
        resetLocalGame();
      }

      navigate({ name: "play", userId: session.user_id });
    } catch (error) {
      if (error instanceof Error && error.message === "active_session_exists") {
        const sessions = await listActiveSessions();
        if (sessions[0]) {
          applyActiveSession(sessions[0]);
          navigate({ name: "play", userId: sessions[0].user_id });
        }
      } else {
        setApiError(error instanceof Error ? error.message : "erro_ao_iniciar");
      }
    } finally {
      setApiBusy(false);
    }
  }

  async function handleCalibratePressure() {
    setApiBusy(true);
    setApiError(null);
    setCalibrationState({ message: "Enviando comando de calibração.", phase: "pending" });
    try {
      await calibratePressure();
      setCalibrationState({ message: "Comando enviado. Aguardando ESP32.", phase: "queued" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "erro_ao_calibrar";
      if (message === "active_session_exists") {
        setCalibrationState({ message: "Finalize o jogo ativo antes de calibrar.", phase: "rejected" });
      } else {
        setCalibrationState({ message: formatApiError(message), phase: "failed" });
      }
      setApiError(message);
    } finally {
      setApiBusy(false);
    }
  }

  async function handleFinishSession() {
    if (!activeSession) {
      return;
    }

    setApiBusy(true);
    setApiError(null);
    try {
      const userId = activeSession.user_id;
      await finishGameSession(activeSession.id, {
        gameplay_metrics: buildGameplayMetrics(statsRef.current),
      });
      const metrics = await listGameplayMetrics().catch((metricsLoadError) => {
        setMetricsError(metricsLoadError instanceof Error ? metricsLoadError.message : "erro_ao_carregar_metricas");
        return dashboardMetrics;
      });
      setDashboardMetrics(metrics);
      if (metrics !== dashboardMetrics) {
        setMetricsError(null);
      }
      stopGameMusic();
      activeSessionRef.current = null;
      pendingSessionRef.current = null;
      setActiveSession(null);
      setPendingSession(null);
      setSessionSignal("finalizada");
      resetLocalGame();
      pushFeedback("Fim", "neutral");
      await refreshUsers();
      navigate({ name: "patient", userId });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "erro_ao_finalizar");
    } finally {
      setApiBusy(false);
    }
  }

  if (route.name === "benchmarks") {
    return <BenchmarkDashboard onBack={() => navigate({ name: "patients" })} />;
  }

  if (route.name === "play") {
    if (!selectedUser) {
      return (
        <ShellHeader
          apiError={apiError}
          onBenchmarks={() => navigate({ name: "benchmarks" })}
          onPatients={() => navigate({ name: "patients" })}
        >
          <EmptyState
            actionLabel="Voltar aos pacientes"
            message={loading ? "Carregando paciente." : "Paciente não encontrado."}
            onAction={() => navigate({ name: "patients" })}
          />
        </ShellHeader>
      );
    }

    if (!activeSession || activeSession.user_id !== selectedUser.id) {
      return (
        <ShellHeader
          apiError={apiError}
          onBenchmarks={() => navigate({ name: "benchmarks" })}
          onPatients={() => navigate({ name: "patients" })}
        >
          <GameSetup
            activeSession={activeSession}
            apiBusy={apiBusy}
            calibrationState={calibrationState}
            connectionStatus={connectionStatus}
            hand={hand}
            patient={selectedUser}
            pendingSession={pendingSession}
            sessionSignal={sessionSignal}
            uiMode={uiMode}
            onBack={() => navigate({ name: "patient", userId: selectedUser.id })}
            onCalibrate={handleCalibratePressure}
            onHandChange={setHand}
            onStart={handleStartSession}
            onUiModeChange={setUiMode}
          />
        </ShellHeader>
      );
    }

    return (
      <GameScreen
        activeLanes={activeLanes}
        activeUiMode={activeUiMode}
        apiBusy={apiBusy}
        apiError={apiError}
        elapsedSeconds={elapsedSeconds}
        feedbacks={feedbacks}
        hand={hand}
        latencyDiagnostics={latencyDiagnostics}
        musicMuted={gameMusicMuted}
        keyboardInputActive={keyboardInputActive}
        laneGridStyle={laneGridStyle}
        notes={notes}
        nowMs={nowMs}
        pressedLanes={pressedLanes}
        pressureActive={pressureActive}
        pressureValue={pressureValue}
        sessionWarmupRemainingMs={sessionWarmupRemainingMs}
        stats={stats}
        onFinish={handleFinishSession}
        onMusicMutedChange={handleGameMusicMutedChange}
        onStreakSound={playGameSound}
        onKeyboardInputChange={(enabled) => {
          setKeyboardInputActive(enabled);
          if (!enabled) {
            setPressedLanes({});
            setPressureActive(false);
            setPressureValue(null);
          }
        }}
      />
    );
  }

  if (route.name === "patient") {
    if (!selectedUser) {
      return (
        <ShellHeader
          apiError={apiError}
          onBenchmarks={() => navigate({ name: "benchmarks" })}
          onPatients={() => navigate({ name: "patients" })}
        >
          <EmptyState
            actionLabel="Voltar aos pacientes"
            message={loading ? "Carregando paciente." : "Paciente não encontrado."}
            onAction={() => navigate({ name: "patients" })}
          />
        </ShellHeader>
      );
    }

    return (
      <ShellHeader
        apiError={apiError}
        onBenchmarks={() => navigate({ name: "benchmarks" })}
        onPatients={() => navigate({ name: "patients" })}
      >
        <PatientDashboard
          activeSession={activeSession}
          metrics={patientMetrics}
          patient={selectedUser}
          summary={dashboardSummary}
          onPlay={() => navigate({ name: "play", userId: selectedUser.id })}
        />
      </ShellHeader>
    );
  }

  return (
    <ShellHeader
      apiError={apiError}
      onBenchmarks={() => navigate({ name: "benchmarks" })}
      onPatients={() => navigate({ name: "patients" })}
    >
      <PatientsHome
        createModalOpen={createModalOpen}
        globalSummary={globalSummary}
        loading={loading}
        metricsError={metricsError}
        metrics={dashboardMetrics}
        newUserAge={newUserAge}
        newUserName={newUserName}
        newUserSex={newUserSex}
        patients={users}
        submitting={apiBusy}
        onCloseCreate={() => setCreateModalOpen(false)}
        onCreate={handleCreateUser}
        onNewUserAgeChange={setNewUserAge}
        onNewUserNameChange={setNewUserName}
        onNewUserSexChange={setNewUserSex}
        onOpenCreate={() => setCreateModalOpen(true)}
        onSelectPatient={(userId) => navigate({ name: "patient", userId })}
      />
    </ShellHeader>
  );
}

function ShellHeader({
  apiError,
  children,
  onBenchmarks,
  onPatients,
}: {
  apiError: string | null;
  children: React.ReactNode;
  onBenchmarks: () => void;
  onPatients: () => void;
}) {
  return (
    <main className="app-shell">
      <header className="app-topbar">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button className="brand-lockup text-left" type="button" onClick={onPatients}>
            <img className="brand-logo" src={logo} alt="" aria-hidden="true" />
            <span className="brand-title">Hand Rehab</span>
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="secondary-button"
              type="button"
              onClick={onBenchmarks}
            >
              <BarChart3 aria-hidden className="mr-2 h-5 w-5" />
              Métricas de Buffer
            </button>
          </div>
        </div>
        {apiError ? <p className="notice mt-3">{formatApiError(apiError)}</p> : null}
      </header>
      {children}
    </main>
  );
}

function PatientsHome({
  createModalOpen,
  globalSummary,
  loading,
  metricsError,
  metrics,
  newUserAge,
  newUserName,
  newUserSex,
  patients,
  submitting,
  onCloseCreate,
  onCreate,
  onNewUserAgeChange,
  onNewUserNameChange,
  onNewUserSexChange,
  onOpenCreate,
  onSelectPatient,
}: {
  createModalOpen: boolean;
  globalSummary: ReturnType<typeof summarizeMetrics>;
  loading: boolean;
  metricsError: string | null;
  metrics: GameplayMetricsRead[];
  newUserAge: number;
  newUserName: string;
  newUserSex: Sex;
  patients: UserRead[];
  submitting: boolean;
  onCloseCreate: () => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onNewUserAgeChange: (value: number) => void;
  onNewUserNameChange: (value: string) => void;
  onNewUserSexChange: (value: Sex) => void;
  onOpenCreate: () => void;
  onSelectPatient: (userId: string) => void;
}) {
  const sessionsByUser = useMemo(() => {
    return metrics.reduce<Record<string, GameplayMetricsRead[]>>((groups, metric) => {
      groups[metric.user_id] = [...(groups[metric.user_id] ?? []), metric];
      return groups;
    }, {});
  }, [metrics]);

  return (
    <>
      <section className="page-panel">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <Users aria-hidden className="h-10 w-10 text-[color:var(--dark-goldenrod)]" />
              <h2 className="page-heading">Lista de pacientes</h2>
            </div>
            <p className="page-subtitle">
              {patients.length} pacientes cadastrados | {globalSummary.finishedSessions} sessões finalizadas
            </p>
          </div>
          <button
            className="primary-button min-w-40"
            type="button"
            onClick={onOpenCreate}
          >
            <UserPlus aria-hidden className="mr-2 h-5 w-5" />
            Criar paciente
          </button>
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={Target} label="Taxa geral de acertos" value={formatPercent(globalSummary.averageAccuracy)} />
          <Metric icon={Clock3} label="Reação média geral" value={formatMs(globalSummary.averageReaction)} />
          <Metric icon={Trophy} label="Melhor score" value={globalSummary.bestScore.toLocaleString("pt-BR")} />
          <Metric icon={Activity} label="Sessões" value={globalSummary.finishedSessions} />
        </div>
        {metricsError ? (
          <p className="mt-4 text-sm font-semibold text-[color:var(--muted)]">
            Métricas indisponíveis agora; pacientes e jogo continuam disponíveis.
          </p>
        ) : null}
      </section>

      <section className="content-band">
        {loading ? <p className="text-sm font-semibold text-[color:var(--muted)]">Carregando pacientes.</p> : null}
        {!loading && patients.length === 0 ? (
          <EmptyState actionLabel="Criar paciente" message="Nenhum paciente cadastrado ainda." onAction={onOpenCreate} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {patients.map((patient) => {
              const patientMetrics = sessionsByUser[patient.id] ?? [];
              const summary = summarizeMetrics(patientMetrics);
              const lastSession = patientMetrics[0];
              return (
                <button
                  className="patient-card transition"
                  key={patient.id}
                  type="button"
                  onClick={() => onSelectPatient(patient.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-xl font-extrabold text-[color:var(--platinum)]">{patient.name}</h3>
                      <p className="mt-1 text-sm font-medium text-[color:var(--muted)]">
                        {patient.age} anos | {sexLabel(patient.sex)}
                      </p>
                    </div>
                    <span className="patient-pill">
                      {summary.finishedSessions} sessões
                    </span>
                  </div>
                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <CompactStat label="Acertos" value={formatPercent(summary.averageAccuracy)} />
                    <CompactStat label="Reação" value={formatMs(summary.averageReaction)} />
                    <CompactStat label="Score" value={summary.totalScore.toLocaleString("pt-BR")} />
                  </div>
                  <p className="mt-5 text-xs font-semibold text-[color:var(--muted)]">
                    Última sessão: {lastSession ? formatDateTime(lastSession.finished_at) : "sem histórico"}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {createModalOpen ? (
        <CreatePatientModal
          age={newUserAge}
          name={newUserName}
          sex={newUserSex}
          submitting={submitting}
          onAgeChange={onNewUserAgeChange}
          onClose={onCloseCreate}
          onNameChange={onNewUserNameChange}
          onSexChange={onNewUserSexChange}
          onSubmit={onCreate}
        />
      ) : null}
    </>
  );
}

function CreatePatientModal({
  age,
  name,
  sex,
  submitting,
  onAgeChange,
  onClose,
  onNameChange,
  onSexChange,
  onSubmit,
}: {
  age: number;
  name: string;
  sex: Sex;
  submitting: boolean;
  onAgeChange: (value: number) => void;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onSexChange: (value: Sex) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="modal-backdrop">
      <form className="modal-surface" onSubmit={onSubmit}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-2xl font-extrabold text-[color:var(--platinum)]">
            <UserPlus aria-hidden className="h-6 w-6 text-[color:var(--dark-goldenrod)]" />
            Criar paciente
          </h2>
          <button className="secondary-button min-h-9 px-3" type="button" onClick={onClose}>
            <X aria-hidden className="mr-2 h-4 w-4" />
            Fechar
          </button>
        </div>
        <label className="mt-5 block">
          <span className="form-label">Nome</span>
          <input
            className="form-control"
            disabled={submitting}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </label>
        <div className="mt-3 grid grid-cols-[100px_1fr] gap-3">
          <label>
            <span className="form-label">Idade</span>
            <input
              className="form-control"
              disabled={submitting}
              min={0}
              type="number"
              value={age}
              onChange={(event) => onAgeChange(Number(event.target.value))}
            />
          </label>
          <label>
            <span className="form-label">Sexo</span>
            <SexSelect
              disabled={submitting}
              value={sex}
              onChange={onSexChange}
            />
          </label>
        </div>
        <button
          className="primary-button mt-5 w-full disabled:opacity-50"
          disabled={submitting || name.trim().length === 0}
          type="submit"
        >
          <Save aria-hidden className="mr-2 h-5 w-5" />
          Salvar paciente
        </button>
      </form>
    </div>
  );
}

function SexSelect({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: Sex;
  onChange: (value: Sex) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = SEX_OPTIONS.find((option) => option.value === value) ?? SEX_OPTIONS[0];

  function handleSelect(nextValue: Sex) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div className="custom-select">
      <button
        aria-expanded={open}
        className="custom-select-trigger"
        disabled={disabled}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected.label}</span>
        <ChevronDown
          aria-hidden
          className={classNames("h-5 w-5 transition", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="custom-select-menu">
          {SEX_OPTIONS.map((option) => (
            <button
              className={classNames("custom-select-option", option.value === value && "selected")}
              key={option.value}
              type="button"
              onClick={() => handleSelect(option.value)}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check aria-hidden className="h-4 w-4" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PatientDashboard({
  activeSession,
  metrics,
  patient,
  summary,
  onPlay,
}: {
  activeSession: GameSessionRead | null;
  metrics: GameplayMetricsRead[];
  patient: UserRead;
  summary: ReturnType<typeof summarizeMetrics>;
  onPlay: () => void;
}) {
  return (
    <>
      <section className="page-panel">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="brand-eyebrow">{patient.age} anos | {sexLabel(patient.sex)}</p>
            <div className="mt-2 flex items-center gap-3">
              <Users aria-hidden className="h-10 w-10 text-[color:var(--dark-goldenrod)]" />
              <h2 className="page-heading">{patient.name}</h2>
            </div>
          </div>
          <button
            className="primary-button min-w-36"
            type="button"
            onClick={onPlay}
          >
            <Gamepad2 aria-hidden className="mr-2 h-5 w-5" />
            {activeSession?.user_id === patient.id ? "Continuar jogo" : "Jogar"}
          </button>
        </div>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={Target} label="Taxa de acertos" value={formatPercent(summary.averageAccuracy)} />
          <Metric icon={Gauge} label="Taxa de erros" value={formatPercent(summary.averageError)} />
          <Metric icon={Activity} label="Estímulos perdidos" value={formatPercent(summary.averageMissed)} />
          <Metric icon={Clock3} label="Reação média" value={formatMs(summary.averageReaction)} />
          <Metric icon={Trophy} label="Melhor reação" value={formatMs(summary.bestReaction)} />
          <Metric icon={Clock3} label="Pior reação" value={formatMs(summary.worstReaction)} />
          <Metric icon={Target} label="Maior sequência" value={summary.bestCombo} />
          <Metric icon={Trophy} label="Score total" value={summary.totalScore.toLocaleString("pt-BR")} />
        </div>
      </section>

      <section className="content-band grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="data-surface">
          <div className="border-b border-[color:var(--line)] p-5">
            <h3 className="flex items-center gap-2 text-lg font-extrabold text-[color:var(--platinum)]">
              <BarChart3 aria-hidden className="h-5 w-5 text-[color:var(--dark-goldenrod)]" />
              Sessões finalizadas
            </h3>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[1.2fr_88px_88px_92px_92px_92px_92px] bg-[rgba(239,239,239,0.06)] px-5 py-3 text-xs font-extrabold uppercase text-[color:var(--muted)]">
                <span>Sessão</span>
                <span className="text-right">Acertos</span>
                <span className="text-right">Erros</span>
                <span className="text-right">Perdidos</span>
                <span className="text-right">Reação</span>
                <span className="text-right">Combo</span>
                <span className="text-right">Score</span>
              </div>
              {metrics.length === 0 ? (
                <p className="px-5 py-7 text-sm font-semibold text-[color:var(--muted)]">Nenhuma sessão finalizada com métricas ainda.</p>
              ) : (
                metrics.map((metric) => (
                  <div
                    className="grid grid-cols-[1.2fr_88px_88px_92px_92px_92px_92px] border-t border-[color:var(--line)] px-5 py-4 text-sm text-[color:var(--platinum)]"
                    key={metric.session_id}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-extrabold">{formatDateTime(metric.finished_at)}</p>
                      <p className="text-xs font-semibold text-[color:var(--muted)]">{modeLabel(metric.mode)} | mão {handLabel(metric.hand)}</p>
                    </div>
                    <span className="self-center text-right tabular-nums">{formatPercent(metric.accuracy_rate)}</span>
                    <span className="self-center text-right tabular-nums">{formatPercent(metric.error_rate)}</span>
                    <span className="self-center text-right tabular-nums">{formatPercent(metric.missed_rate)}</span>
                    <span className="self-center text-right tabular-nums">{formatMs(metric.avg_reaction_ms)}</span>
                    <span className="self-center text-right tabular-nums">{metric.max_combo}</span>
                    <span className="self-center text-right tabular-nums">{metric.score}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <aside className="subtle-panel p-5">
          <h3 className="flex items-center gap-2 text-lg font-extrabold text-[color:var(--platinum)]">
            <HandIcon aria-hidden className="h-5 w-5 text-[color:var(--dark-goldenrod)]" />
            Precisão por dedo
          </h3>
          <div className="mt-4 space-y-4">
            {metrics.filter((metric) => metric.mode === "buttons").length === 0 ? (
              <p className="text-sm font-semibold text-[color:var(--muted)]">Sem sessões de botões ainda.</p>
            ) : (
              metrics
                .filter((metric) => metric.mode === "buttons")
                .slice(0, 5)
                .map((metric) => (
                  <div className="rounded-lg bg-[rgba(239,239,239,0.06)] p-3 shadow-sm" key={metric.session_id}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-extrabold text-[color:var(--platinum)]">{formatDateTime(metric.finished_at)}</p>
                      <span className="text-xs font-semibold text-[color:var(--muted)]">{metric.score} pts</span>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {[1, 2, 3, 4].map((laneId) => (
                        <div className="text-center" key={laneId}>
                          <div className="mx-auto h-3 w-8 rounded-full" style={{ backgroundColor: LANES[laneId].color }} />
                          <p className="mt-1 text-xs font-extrabold tabular-nums text-[color:var(--platinum)]">
                            {formatPercent(metric.precision_by_lane[String(laneId)] ?? null)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
            )}
          </div>
        </aside>
      </section>
    </>
  );
}

function GameSetup({
  activeSession,
  apiBusy,
  calibrationState,
  connectionStatus,
  hand,
  patient,
  pendingSession,
  sessionSignal,
  uiMode,
  onBack,
  onCalibrate,
  onHandChange,
  onStart,
  onUiModeChange,
}: {
  activeSession: GameSessionRead | null;
  apiBusy: boolean;
  calibrationState: CalibrationState;
  connectionStatus: RealtimeConnectionStatus;
  hand: Hand;
  patient: UserRead;
  pendingSession: GameSessionRead | null;
  sessionSignal: string;
  uiMode: UiMode;
  onBack: () => void;
  onCalibrate: () => void;
  onHandChange: (value: Hand) => void;
  onStart: () => void;
  onUiModeChange: (value: UiMode) => void;
}) {
  const calibrationBusy = calibrationState.phase === "pending" || calibrationState.phase === "queued" || calibrationState.phase === "running";
  const startPending = pendingSession !== null;
  const controlsDisabled = apiBusy || calibrationBusy || startPending;
  const calibrationDisabled = apiBusy || calibrationBusy || activeSession !== null || startPending;
  const displayedUiMode = pendingSession ? gameModeToUiMode(pendingSession.mode) : uiMode;
  const displayedHand = pendingSession?.hand ?? hand;
  const websocketOpen = connectionStatus === "open";
  const startLabel = apiBusy ? "Enviando" : startPending ? "Sincronizando" : "Iniciar jogo";

  return (
    <section className="min-h-[calc(100vh-73px)] p-8">
      <div className="game-setup-panel">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <button className="ghost-button px-0" type="button" onClick={onBack}>
              <ArrowLeft aria-hidden className="mr-2 h-4 w-4" />
              Voltar ao dashboard
            </button>
            <h2 className="page-heading mt-5 flex items-center gap-3">
              <Gamepad2 aria-hidden className="h-10 w-10 text-[color:var(--dark-goldenrod)]" />
              Preparar jogo
            </h2>
            <p className="page-subtitle">{patient.name}</p>
          </div>
          <div className="setup-context">
            <p className="brand-eyebrow">Sessão</p>
            <p className="mt-2 text-sm font-semibold text-[color:var(--platinum)]">
              API {backendApiUrl().replace(/^https?:\/\//, "")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="status-pill">
                <span className={classNames("status-dot", !websocketOpen && "off")} />
                WS {connectionStatus}
              </span>
              <span className="status-pill">
                <span className={classNames("status-dot", !startPending && "off")} />
                {sessionSignal}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-4 sm:grid-cols-2">
            <ChoiceButton active={uiMode === "single"} disabled={controlsDisabled} icon={Gauge} label="1 faixa" meta="Pressão" onClick={() => onUiModeChange("single")} />
            <ChoiceButton active={uiMode === "four"} disabled={controlsDisabled} icon={SlidersHorizontal} label="4 faixas" meta="Botões" onClick={() => onUiModeChange("four")} />
            <ChoiceButton active={hand === "left"} disabled={controlsDisabled} icon={HandIcon} label="Mão esquerda" meta="left" onClick={() => onHandChange("left")} />
            <ChoiceButton active={hand === "right"} disabled={controlsDisabled} icon={HandIcon} label="Mão direita" meta="right" onClick={() => onHandChange("right")} />
          </div>

          <aside className="start-panel">
            <div>
              <p className="flex items-center gap-2 text-xs font-extrabold uppercase text-[rgba(239,239,239,0.68)]">
                <Gamepad2 aria-hidden className="h-4 w-4 text-[color:var(--dark-goldenrod)]" />
                {startPending ? "Aguardando ESP32" : "Pronto para iniciar"}
              </p>
            <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
                {displayedUiMode === "single" ? "Modo de pressão" : "Modo de botões"} | mão {handLabel(displayedHand)}
              </p>
            </div>
            <button
              className="start-button"
              disabled={controlsDisabled}
              type="button"
              onClick={onStart}
            >
              <Gamepad2 aria-hidden className="h-5 w-5" />
              {startLabel}
            </button>
            {startPending ? (
              <p className="text-xs font-semibold leading-5 text-[color:var(--muted)]">
                Aguardando ACK session_started pelo WebSocket.
              </p>
            ) : null}
            <div className="grid gap-2">
              <button
                className="secondary-button w-full disabled:opacity-50"
                disabled={calibrationDisabled}
                type="button"
                onClick={onCalibrate}
              >
                <Gauge aria-hidden className="mr-2 h-4 w-4" />
                Calibrar pressão
              </button>
              <p className="text-xs font-semibold leading-5 text-[color:var(--muted)]">
                {activeSession ? "Finalize o jogo ativo antes de calibrar." : calibrationState.message}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function randomMissDrift(noteId: string) {
  let hash = 0;
  for (let index = 0; index < noteId.length; index += 1) {
    hash = (hash * 31 + noteId.charCodeAt(index)) % 1000;
  }
  return (hash % 2 === 0 ? -1 : 1) * 12;
}

function comboTier(combo: number) {
  if (combo >= 40) {
    return "legend";
  }
  if (combo >= 25) {
    return "super";
  }
  if (combo >= 12) {
    return "hot";
  }
  if (combo >= 5) {
    return "warm";
  }
  return "idle";
}

function comboMultiplier(combo: number) {
  if (combo >= 40) {
    return 8;
  }
  if (combo >= 25) {
    return 4;
  }
  if (combo >= 12) {
    return 3;
  }
  if (combo >= 5) {
    return 2;
  }
  return 1;
}

function GameScreen({
  activeLanes,
  activeUiMode,
  apiBusy,
  apiError,
  elapsedSeconds,
  feedbacks,
  hand,
  latencyDiagnostics,
  musicMuted,
  keyboardInputActive,
  laneGridStyle,
  notes,
  nowMs,
  pressedLanes,
  pressureActive,
  pressureValue,
  sessionWarmupRemainingMs,
  stats,
  onFinish,
  onMusicMutedChange,
  onStreakSound,
  onKeyboardInputChange,
}: {
  activeLanes: LaneDefinition[];
  activeUiMode: UiMode;
  apiBusy: boolean;
  apiError: string | null;
  elapsedSeconds: number;
  feedbacks: Feedback[];
  hand: Hand;
  latencyDiagnostics: RealtimeLatencyDiagnostics;
  musicMuted: boolean;
  keyboardInputActive: boolean;
  laneGridStyle: CSSProperties;
  notes: ActiveNote[];
  nowMs: number;
  pressedLanes: Record<number, boolean>;
  pressureActive: boolean;
  pressureValue: number | null;
  sessionWarmupRemainingMs: number;
  stats: ScoreStats;
  onFinish: () => void;
  onMusicMutedChange: (muted: boolean) => void;
  onStreakSound: (type: "upgradeStreak" | "lossStreak") => void;
  onKeyboardInputChange: (enabled: boolean) => void;
}) {
  const previousComboRef = useRef(stats.combo);
  const previousMultiplierRef = useRef(comboMultiplier(stats.combo));
  const [comboBreakId, setComboBreakId] = useState(0);
  const isComboBreak = comboBreakId > 0;

  useEffect(() => {
    const previousMultiplier = previousMultiplierRef.current;
    const nextMultiplier = comboMultiplier(stats.combo);
    if (nextMultiplier > previousMultiplier) {
      onStreakSound("upgradeStreak");
    }
    if (previousComboRef.current >= 3 && stats.combo === 0) {
      setComboBreakId((current) => current + 1);
      onStreakSound("lossStreak");
    }
    previousComboRef.current = stats.combo;
    previousMultiplierRef.current = nextMultiplier;
  }, [onStreakSound, stats.combo]);

  useEffect(() => {
    if (!isComboBreak) {
      return;
    }

    const timeout = window.setTimeout(() => setComboBreakId(0), 720);
    return () => window.clearTimeout(timeout);
  }, [isComboBreak]);

  const currentComboTier = comboTier(stats.combo);
  const currentMultiplier = comboMultiplier(stats.combo);
  const warmupSeconds = Math.ceil(sessionWarmupRemainingMs / 1000);

  return (
    <main className="h-screen overflow-hidden bg-[color:var(--prussian-blue)] text-white">
      <section className="relative h-full w-full overflow-hidden">
        <div className="game-hud">
          <div className="score-strip">
            <HudStat icon={Trophy} label="Pontos" value={stats.score.toLocaleString("pt-BR")} />
            <HudStat
              broken={isComboBreak}
              icon={Target}
              label="Combo"
              pulseKey={stats.combo}
              tier={currentComboTier}
              value={stats.combo}
            />
            <HudStat icon={Activity} label="Acertos" pulseKey={stats.hits} tier="hit" value={stats.hits} />
            <HudStat icon={Clock3} label="Tempo" value={formatElapsed(elapsedSeconds)} />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              aria-label={musicMuted ? "Desmutar trilha" : "Mutar trilha"}
              aria-pressed={musicMuted}
              className={classNames("audio-toggle", musicMuted && "muted")}
              type="button"
              onClick={() => onMusicMutedChange(!musicMuted)}
            >
              {musicMuted ? (
                <VolumeX aria-hidden className="h-4 w-4" />
              ) : (
                <Volume2 aria-hidden className="h-4 w-4" />
              )}
              {musicMuted ? "Mudo" : "Som"}
            </button>
            <button
              aria-pressed={keyboardInputActive}
              className={classNames("keyboard-toggle", keyboardInputActive && "active")}
              type="button"
              onClick={() => onKeyboardInputChange(!keyboardInputActive)}
            >
              <Keyboard aria-hidden className="h-4 w-4" />
              Teclado
            </button>
            <span className="game-pill">
              {activeUiMode === "single" ? "1 faixa" : "4 faixas"}
            </span>
            <span className="game-pill">
              {hand === "left" ? "Mão esquerda" : "Mão direita"}
            </span>
            <span className="game-pill tabular-nums">
              Lat {formatMs(latencyDiagnostics.transportDelayMs)}
            </span>
            <span className="game-pill tabular-nums">
              Jit {formatMs(latencyDiagnostics.jitterMs)}
            </span>
            <span className="game-pill tabular-nums">
              Seq {latencyDiagnostics.lastSequence ?? "--"}
            </span>
            <button
              className="finish-game-button"
              disabled={apiBusy}
              type="button"
              onClick={onFinish}
            >
              <X aria-hidden className="h-4 w-4" />
              Finalizar
            </button>
          </div>
        </div>

        <div className="combo-stage" aria-hidden="true">
          {currentMultiplier > 1 ? (
            <div className={classNames("combo-multiplier", `tier-${currentComboTier}`)} key={`combo-${stats.combo}`}>
              <span className="combo-multiplier-kicker">{stats.combo} hits</span>
              <span className="combo-multiplier-value">x{currentMultiplier}</span>
              <span className="combo-multiplier-label">Combo</span>
              <span className="combo-multiplier-spark spark-a" />
              <span className="combo-multiplier-spark spark-b" />
              <span className="combo-multiplier-spark spark-c" />
              <span className="combo-multiplier-spark spark-d" />
            </div>
          ) : null}
          {isComboBreak ? (
            <div className="combo-break-overlay" key={`break-${comboBreakId}`}>
              <span>Combo perdido</span>
            </div>
          ) : null}
          {sessionWarmupRemainingMs > 0 ? (
            <div className="combo-break-overlay" key="session-warmup">
              <span className="tabular-nums">{warmupSeconds}</span>
            </div>
          ) : null}
        </div>

        <div className="rhythm-track absolute inset-0 overflow-hidden bg-[rgba(14,20,40,0.9)]">
          <img className="game-watermark-logo" src={logo} alt="" aria-hidden="true" />
          <div className="absolute inset-0 grid" style={laneGridStyle}>
            {activeLanes.map((lane) => (
              <div
                className="relative border-x border-white/10"
                key={lane.id}
                style={{
                  background: `linear-gradient(180deg, ${lane.soft}, rgba(14, 20, 40, 0.34) 44%, ${lane.soft})`,
                }}
              >
                <div className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2" style={{ backgroundColor: lane.line }} />
              </div>
            ))}
          </div>

          <div className="game-notes-layer absolute inset-0 grid" style={laneGridStyle}>
            {activeLanes.map((lane) => (
              <div className="relative" key={lane.id}>
                {notes
                  .filter((note) => note.laneId === lane.id)
                  .map((note) => {
                    const isMiss = note.status === "miss";
                    const isHit = note.status === "hit";
                    const isHolding = note.status === "holding";
                    const isHold = note.type === "hold";
                    const visualTime = isHit || isHolding ? note.judgedAt ?? nowMs : nowMs;
                    const top = noteTopPercent(note, visualTime);
                    const holdEndTop = isHold ? noteHoldEndTopPercent(note, isHolding ? nowMs : visualTime) : top;
                    const missDrift = isMiss ? randomMissDrift(note.id) : 0;
                    return (
                      <div
                        className="game-note-position absolute inset-x-0 top-0 h-full"
                        key={note.id}
                        style={
                          {
                            "--hold-end-top": `${Math.max(0, holdEndTop)}%`,
                            "--miss-drift": `${missDrift}px`,
                            "--note-color": lane.color,
                            "--note-top": `${top}%`,
                          } as CSSProperties
                        }
                      >
                        {isHold && !isHit ? (
                          <div
                            className={classNames(
                              "game-hold-trail absolute left-1/2 w-[min(34%,40px)] -translate-x-1/2 rounded-full",
                              isHolding && "holding",
                              isMiss && "miss",
                            )}
                          />
                        ) : null}
                        <div
                        className={classNames(
                          "game-note absolute left-1/2 h-12 w-[min(70%,92px)] rounded-full sm:h-14",
                          isHold && "hold",
                          isHolding && "holding",
                          isMiss && "miss",
                          isHit && "hit",
                        )}
                        />
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>

          <div className="absolute bottom-[8%] left-0 right-0 h-px bg-white/35" />
          <div className="absolute bottom-[5%] left-0 right-0 z-20 grid" style={laneGridStyle}>
            {activeLanes.map((lane) => {
              const isLaneActive = activeUiMode === "single" ? pressureActive : Boolean(pressedLanes[lane.id]);
              return (
                <div className="flex justify-center" key={lane.id}>
                  <div
                    className="flex h-12 w-[min(70%,92px)] items-center justify-center rounded-full border-2 bg-[color:var(--prussian-blue)] text-xs font-semibold text-white transition sm:h-14"
                    style={{
                      borderColor: lane.color,
                      boxShadow: isLaneActive ? `0 0 34px ${lane.color}` : "0 6px 18px rgba(0, 0, 0, 0.3)",
                    }}
                  >
                    {activeUiMode === "single" ? (
                      <span className="tabular-nums">{pressureValue === null ? "--" : pressureValue.toFixed(1)}</span>
                    ) : (
                      lane.id
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pointer-events-none absolute bottom-[5%] left-0 right-0 z-30 grid" style={laneGridStyle}>
            {activeLanes.map((lane) => {
              const laneHits = feedbacks.filter((feedback) => feedback.laneId === lane.id && feedback.tone === "hit").slice(-3);
              return (
                <div className="relative flex h-14 justify-center overflow-visible" key={lane.id}>
                  {laneHits.map((feedback) => (
                    <div
                      className="neon-hit-burst"
                      key={feedback.id}
                      style={{ "--burst-color": lane.color } as CSSProperties}
                    >
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="pointer-events-none absolute bottom-[5%] left-0 right-0 z-30 grid" style={laneGridStyle}>
            {activeLanes.map((lane) => {
              const laneFeedbacks = feedbacks.filter((feedback) => feedback.laneId === lane.id).slice(-6);
              return (
                <div className="relative flex h-14 justify-center overflow-visible" key={lane.id}>
                  {laneFeedbacks.map((feedback, index) => (
                    <div
                      className={classNames(
                        "game-feedback-pop",
                        feedback.tone === "hit" && "success",
                        feedback.tone === "miss" && "fail",
                        feedback.tone === "neutral" && "neutral",
                      )}
                      key={feedback.id}
                      style={
                        {
                          "--feedback-stack": laneFeedbacks.length - index - 1,
                        } as CSSProperties
                      }
                    >
                      {feedback.label}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {apiError ? (
          <div className="absolute bottom-3 right-3 z-40 rounded-lg bg-[rgba(143,57,133,0.14)] px-3 py-2 text-sm font-semibold text-white shadow-sm">
            {formatApiError(apiError)}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function EmptyState({ actionLabel, message, onAction }: { actionLabel: string; message: string; onAction: () => void }) {
  return (
    <section className="flex min-h-[55vh] flex-col items-center justify-center bg-[rgba(239,239,239,0.04)] px-5 text-center">
      <p className="text-lg font-extrabold text-[color:var(--platinum)]">{message}</p>
      <button className="primary-button mt-4" type="button" onClick={onAction}>
        {actionLabel}
      </button>
    </section>
  );
}

function ChoiceButton({
  active,
  disabled,
  icon: Icon,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: IconType;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      className={classNames(
        "h-24 rounded-lg p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "bg-[color:var(--grape-soda)] text-white shadow-sm"
          : "bg-[rgba(239,239,239,0.06)] text-[color:var(--platinum)] hover:bg-[rgba(239,239,239,0.1)]",
      )}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      <Icon aria-hidden className="mb-3 h-5 w-5 text-[color:var(--dark-goldenrod)]" />
      <span className="block text-sm font-semibold">{label}</span>
      <span className={classNames("mt-1 block text-xs", active ? "text-[rgba(239,239,239,0.72)]" : "text-[color:var(--muted)]")}>{meta}</span>
    </button>
  );
}

function HudStat({
  broken = false,
  icon: Icon,
  label,
  pulseKey,
  tier = "idle",
  value,
}: {
  broken?: boolean;
  icon: IconType;
  label: string;
  pulseKey?: number | string;
  tier?: "idle" | "warm" | "hot" | "super" | "legend" | "hit";
  value: number | string;
}) {
  return (
    <div className={classNames("hud-stat", `tier-${tier}`, pulseKey !== undefined && "hud-stat-pulse", broken && "combo-broken")}>
      <Icon aria-hidden className="hud-stat-icon h-4 w-4" />
      <div>
        <p className="hud-stat-label">{label}</p>
        <p className="hud-stat-value tabular-nums" key={pulseKey ?? value}>{value}</p>
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  variant = "light",
}: {
  icon: IconType;
  label: string;
  value: number | string;
  variant?: "light" | "dark";
}) {
  return (
    <div className={classNames("metric-card", variant === "dark" && "dark")}>
      <div className="flex items-center justify-between gap-3">
        <p className="metric-label">{label}</p>
        <span className="metric-icon-chip">
          <Icon aria-hidden className="h-5 w-5" />
        </span>
      </div>
      <p className="metric-value tabular-nums">{value}</p>
    </div>
  );
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="compact-stat">
      <p className="compact-stat-label">{label}</p>
      <p className="compact-stat-value">{value}</p>
    </div>
  );
}
