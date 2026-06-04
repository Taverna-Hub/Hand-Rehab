import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  backendApiUrl,
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
const MISS_GRACE_MS = 300;
const NOTE_FADE_MS = 650;
const DEFAULT_THRESHOLD_KPA = 0.5;

const FOUR_LANE_PATTERN = [1, 2, 3, 4, 2, 4, 1, 3, 1, 4, 2, 3];

type NoteStatus = "pending" | "hit" | "miss";
type HitQuality = "perfect" | "good";
type FeedbackTone = "hit" | "miss" | "neutral";
type AppScreen = "setup" | "dashboard" | "benchmarks";

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

interface Feedback {
  id: number;
  label: string;
  tone: FeedbackTone;
}

const LANES: Record<number, LaneDefinition> = {
  1: { id: 1, label: "Azul", color: "#2563eb", soft: "rgba(37, 99, 235, 0.18)", line: "rgba(96, 165, 250, 0.58)" },
  2: { id: 2, label: "Vermelho", color: "#dc2626", soft: "rgba(220, 38, 38, 0.18)", line: "rgba(248, 113, 113, 0.58)" },
  3: { id: 3, label: "Verde", color: "#16a34a", soft: "rgba(22, 163, 74, 0.18)", line: "rgba(74, 222, 128, 0.58)" },
  4: { id: 4, label: "Amarelo", color: "#eab308", soft: "rgba(234, 179, 8, 0.2)", line: "rgba(250, 204, 21, 0.66)" },
};

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

type ViteImportMeta = ImportMeta & {
  env?: {
    VITE_NODE_RED_WS_URL?: string;
  };
};

function nodeRedRealtimeUrl() {
  const viteEnv = (import.meta as ViteImportMeta).env;
  if (viteEnv?.VITE_NODE_RED_WS_URL) {
    return viteEnv.VITE_NODE_RED_WS_URL;
  }

  return `ws://${window.location.hostname || "localhost"}:1880/ws/realtime`;
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

function connectionLabel(status: RealtimeConnectionStatus) {
  const labels: Record<RealtimeConnectionStatus, string> = {
    closed: "WS fechado",
    connecting: "WS conectando",
    error: "WS erro",
    open: "WS aberto",
  };
  return labels[status];
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

function isButtonEvent(event: RealtimeEvent): event is RealtimeButtonEvent {
  return "button_id" in event && event.mode === "buttons";
}

function isPressureEvent(event: RealtimeEvent): event is RealtimePressureEvent {
  return "pressure_raw" in event && event.mode === "pressure";
}

function isSessionEvent(event: RealtimeEvent): event is RealtimeSessionEvent {
  return event.realtime_type === "session" || (!isButtonEvent(event) && !isPressureEvent(event));
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
  return Math.min(88, Math.max(4, progress * 82 + 4));
}

function makeNote(sessionId: string, beatIndex: number, mode: GameMode, gameStart: number): ActiveNote {
  const laneId = mode === "pressure" ? 1 : FOUR_LANE_PATTERN[beatIndex % FOUR_LANE_PATTERN.length];
  return {
    hitAt: gameStart + NOTE_LEAD_MS + beatIndex * BEAT_INTERVAL_MS,
    id: `${sessionId}-${beatIndex}`,
    laneId,
    status: "pending",
  };
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

function modeLabel(mode: GameMode) {
  return mode === "pressure" ? "1 faixa" : "4 faixas";
}

function handLabel(value: Hand) {
  return value === "left" ? "esquerda" : "direita";
}

export default function App() {
  const [users, setUsers] = useState<UserRead[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [newUserName, setNewUserName] = useState("Paciente Teste");
  const [newUserAge, setNewUserAge] = useState(35);
  const [newUserSex, setNewUserSex] = useState<Sex>("not_informed");
  const [uiMode, setUiMode] = useState<UiMode>("four");
  const [hand, setHand] = useState<Hand>("right");
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD_KPA);
  const [activeSession, setActiveSession] = useState<GameSessionRead | null>(null);
  const [notes, setNotes] = useState<ActiveNote[]>([]);
  const [stats, setStats] = useState<ScoreStats>(initialStats);
  const [dashboardMetrics, setDashboardMetrics] = useState<GameplayMetricsRead[]>([]);
  const [nowMs, setNowMs] = useState(0);
  const [pressedLanes, setPressedLanes] = useState<Record<number, boolean>>({});
  const [pressureValue, setPressureValue] = useState<number | null>(null);
  const [pressureActive, setPressureActive] = useState(false);
  const [lastInputs, setLastInputs] = useState<LastInput[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [sessionSignal, setSessionSignal] = useState("aguardando");
  const [connectionStatus, setConnectionStatus] = useState<RealtimeConnectionStatus>("connecting");
  const [loading, setLoading] = useState(true);
  const [apiBusy, setApiBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [screen, setScreen] = useState<AppScreen>("setup");

  const activeSessionRef = useRef<GameSessionRead | null>(null);
  const notesRef = useRef<ActiveNote[]>([]);
  const statsRef = useRef<ScoreStats>(stats);
  const thresholdRef = useRef(DEFAULT_THRESHOLD_KPA);
  const pressureAboveThresholdRef = useRef(false);
  const localGameStartRef = useRef<number | null>(null);
  const nextBeatIndexRef = useRef(0);
  const feedbackIdRef = useRef(0);

  const activeUiMode = activeSession ? gameModeToUiMode(activeSession.mode) : uiMode;
  const activeLanes = useMemo(() => lanesForMode(activeUiMode), [activeUiMode]);
  const laneGridStyle = useMemo<CSSProperties>(
    () => ({ gridTemplateColumns: `repeat(${activeLanes.length}, minmax(0, 1fr))` }),
    [activeLanes.length],
  );
  const selectedUser = users.find((user) => user.id === selectedUserId);
  const dashboardSummary = useMemo(() => {
    const finishedSessions = dashboardMetrics.length;
    const bestScore = Math.max(0, ...dashboardMetrics.map((metric) => metric.score));
    const bestCombo = Math.max(0, ...dashboardMetrics.map((metric) => metric.max_combo));
    const totalScore = dashboardMetrics.reduce((total, metric) => total + metric.score, 0);
    const totalStimuli = dashboardMetrics.reduce((total, metric) => total + metric.total_stimuli, 0);
    const totalHits = dashboardMetrics.reduce((total, metric) => total + metric.hits, 0);
    const totalErrors = dashboardMetrics.reduce((total, metric) => total + metric.errors, 0);
    const totalMissed = dashboardMetrics.reduce((total, metric) => total + metric.missed_stimuli, 0);
    const reactionValues = dashboardMetrics
      .map((metric) => metric.avg_reaction_ms)
      .filter((value): value is number => typeof value === "number");
    const bestReactionValues = dashboardMetrics
      .map((metric) => metric.best_reaction_ms)
      .filter((value): value is number => typeof value === "number");
    const worstReactionValues = dashboardMetrics
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
  }, [dashboardMetrics]);
  const elapsedSeconds = activeSession
    ? Math.max(0, Math.floor((Date.now() - Date.parse(activeSession.started_at)) / 1000))
    : 0;

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  useEffect(() => {
    thresholdRef.current = threshold;
  }, [threshold]);

  const pushFeedback = useCallback((label: string, tone: FeedbackTone) => {
    feedbackIdRef.current += 1;
    setFeedback({ id: feedbackIdRef.current, label, tone });
  }, []);

  const resetLocalGame = useCallback(() => {
    const now = performance.now();
    localGameStartRef.current = now;
    nextBeatIndexRef.current = 0;
    notesRef.current = [];
    pressureAboveThresholdRef.current = false;
    setNowMs(now);
    setNotes([]);
    setStats(initialStats());
    setPressedLanes({});
    setPressureValue(null);
    setPressureActive(false);
    setFeedback(null);
  }, []);

  const applyActiveSession = useCallback(
    (session: GameSessionRead) => {
      setActiveSession(session);
      setUiMode(gameModeToUiMode(session.mode));
      setHand(session.hand);
      setSelectedUserId(session.user_id);
      setSessionSignal("sessão ativa");
      resetLocalGame();
    },
    [resetLocalGame],
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
        const [loadedUsers, sessions, metrics] = await Promise.all([
          listUsers(),
          listActiveSessions(),
          listGameplayMetrics(),
        ]);
        if (!mounted) {
          return;
        }
        setUsers(loadedUsers);
        setDashboardMetrics(metrics);
        setSelectedUserId((current) => current || sessions[0]?.user_id || loadedUsers[0]?.id || "");
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
  }, [applyActiveSession]);

  const registerError = useCallback(
    (label = "Erro") => {
      setStats((current) => ({ ...current, combo: 0, errors: current.errors + 1 }));
      pushFeedback(label, "miss");
    },
    [pushFeedback],
  );

  const registerHit = useCallback(
    (laneId: number, inputTime = performance.now()) => {
      const candidate = notesRef.current
        .filter((note) => note.status === "pending" && note.laneId === laneId)
        .map((note) => ({ note, delta: Math.abs(note.hitAt - inputTime) }))
        .filter(({ delta }) => delta <= HIT_WINDOW_MS)
        .sort((left, right) => left.delta - right.delta)[0];

      if (!candidate) {
        registerError("Fora");
        return;
      }

      const quality: HitQuality = candidate.delta <= PERFECT_WINDOW_MS ? "perfect" : "good";
      const points = quality === "perfect" ? 120 : 80;
      const judgedAt = inputTime;
      const reactionMs = Math.round(candidate.delta);
      const nextNotes = notesRef.current.map((note) =>
        note.id === candidate.note.id ? { ...note, judgedAt, quality, status: "hit" as const } : note,
      );
      notesRef.current = nextNotes;
      setNotes(nextNotes);
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
          score: current.score + points + Math.min(current.combo * 2, 50),
        };
      });
      pushFeedback(quality === "perfect" ? "Perfeito" : "Bom", "hit");
    },
    [pushFeedback, registerError],
  );

  const recordRealtimeInput = useCallback((event: RealtimeEvent) => {
    const input = describeRealtimeEvent(event);
    setLastInputs((current) => [input, ...current].slice(0, 5));
  }, []);

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      recordRealtimeInput(event);

      if (isSessionEvent(event)) {
        setSessionSignal(event.event_type ?? event.status ?? "sessão");
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

      if (isButtonEvent(event)) {
        setPressedLanes((current) => ({ ...current, [event.button_id]: event.event_type === "pressed" }));
        if (event.event_type === "pressed") {
          registerHit(event.button_id);
        }
        return;
      }

      if (isPressureEvent(event)) {
        const pressureKpa = typeof event.pressure_kpa === "number" ? event.pressure_kpa : null;
        setPressureValue(pressureKpa);

        if (pressureKpa === null) {
          return;
        }

        const isAboveThreshold = pressureKpa >= thresholdRef.current;
        setPressureActive(isAboveThreshold);
        if (isAboveThreshold && !pressureAboveThresholdRef.current) {
          registerHit(1);
        }
        pressureAboveThresholdRef.current = isAboveThreshold;
      }
    },
    [recordRealtimeInput, registerHit],
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
    if (!activeSession) {
      return;
    }

    let frame = 0;
    const tick = () => {
      const now = performance.now();
      const gameStart = localGameStartRef.current ?? now;
      localGameStartRef.current = gameStart;
      setNowMs(now);

      const spawnedNotes: ActiveNote[] = [];
      while (gameStart + nextBeatIndexRef.current * BEAT_INTERVAL_MS <= now) {
        spawnedNotes.push(makeNote(activeSession.id, nextBeatIndexRef.current, activeSession.mode, gameStart));
        nextBeatIndexRef.current += 1;
      }

      setNotes((current) => {
        let missed = 0;
        const stimuliByLane = spawnedNotes.reduce<Record<number, number>>((counts, note) => {
          counts[note.laneId] = (counts[note.laneId] ?? 0) + 1;
          return counts;
        }, {});
        const next = [...current, ...spawnedNotes]
          .map((note) => {
            if (note.status === "pending" && now - note.hitAt > MISS_GRACE_MS) {
              missed += 1;
              return { ...note, judgedAt: now, status: "miss" as const };
            }
            return note;
          })
          .filter((note) => {
            if (note.status === "pending") {
              return note.hitAt - now > -1_200;
            }
            return now - (note.judgedAt ?? note.hitAt) < NOTE_FADE_MS;
          });

        if (missed > 0) {
          setStats((currentStats) => ({
            ...currentStats,
            combo: 0,
            missedStimuli: currentStats.missedStimuli + missed,
          }));
          pushFeedback("Perdeu", "miss");
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
        return next;
      });

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [activeSession, pushFeedback]);

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiBusy(true);
    setApiError(null);
    try {
      const user = await createUser({ age: newUserAge, name: newUserName.trim(), sex: newUserSex });
      const loadedUsers = await refreshUsers();
      setUsers([user, ...loadedUsers.filter((item) => item.id !== user.id)]);
      setSelectedUserId(user.id);
      setNewUserName("Paciente Teste");
      setNewUserAge(35);
      setNewUserSex("not_informed");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "erro_ao_criar_usuario");
    } finally {
      setApiBusy(false);
    }
  }

  async function handleStartSession() {
    if (!selectedUserId) {
      setApiError("selecione_um_paciente");
      return;
    }

    setApiBusy(true);
    setApiError(null);
    try {
      const session = await startGameSession({
        hand,
        mode: uiModeToGameMode(uiMode),
        user_id: selectedUserId,
      });
      applyActiveSession(session);
      pushFeedback("Vai", "neutral");
    } catch (error) {
      if (error instanceof Error && error.message === "active_session_exists") {
        const sessions = await listActiveSessions();
        if (sessions[0]) {
          applyActiveSession(sessions[0]);
        }
      } else {
        setApiError(error instanceof Error ? error.message : "erro_ao_iniciar");
      }
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
      await finishGameSession(activeSession.id, {
        gameplay_metrics: buildGameplayMetrics(statsRef.current),
      });
      const metrics = await listGameplayMetrics();
      setDashboardMetrics(metrics);
      setActiveSession(null);
      setSessionSignal("finalizada");
      setScreen("dashboard");
      resetLocalGame();
      pushFeedback("Fim", "neutral");
      await refreshUsers();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "erro_ao_finalizar");
    } finally {
      setApiBusy(false);
    }
  }

  if (!activeSession && screen === "dashboard") {
    return (
      <main className="min-h-screen bg-[#f4f7fb] px-4 py-5 text-slate-900">
        <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-6xl flex-col gap-4">
          <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Hand Rehab</p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-950">Dashboard</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={connectionStatus} />
              <button
                className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={apiBusy}
                type="button"
                onClick={() => setScreen("benchmarks")}
              >
                Métricas de Buffer
              </button>
              <button
                className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={apiBusy}
                type="button"
                onClick={() => setScreen("setup")}
              >
                Configurar sessão
              </button>
            </div>
          </header>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Taxa de acertos" value={formatPercent(dashboardSummary.averageAccuracy)} />
            <Metric label="Taxa de erros" value={formatPercent(dashboardSummary.averageError)} />
            <Metric label="Estímulos perdidos" value={formatPercent(dashboardSummary.averageMissed)} />
            <Metric label="Reação média" value={formatMs(dashboardSummary.averageReaction)} />
            <Metric label="Melhor reação" value={formatMs(dashboardSummary.bestReaction)} />
            <Metric label="Pior reação" value={formatMs(dashboardSummary.worstReaction)} />
            <Metric label="Maior sequencia" value={dashboardSummary.bestCombo} />
            <Metric label="Sessões realizadas" value={dashboardSummary.finishedSessions} />
          </section>

          <section className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Sessões finalizadas</h2>
                  <p className="mt-1 text-sm text-slate-500">Histórico salvo ao encerrar o jogo.</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  Score total {dashboardSummary.totalScore.toLocaleString("pt-BR")}
                </span>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[760px]">
                  <div className="grid grid-cols-[1.35fr_88px_88px_92px_92px_92px_92px] bg-slate-50 px-4 py-2 text-xs font-semibold uppercase text-slate-500">
                    <span>Paciente</span>
                    <span className="text-right">Acertos</span>
                    <span className="text-right">Erros</span>
                    <span className="text-right">Perdidos</span>
                    <span className="text-right">Reação</span>
                    <span className="text-right">Combo</span>
                    <span className="text-right">Score</span>
                  </div>
                  {dashboardMetrics.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-slate-500">Nenhuma sessão finalizada com métricas ainda.</p>
                  ) : (
                    dashboardMetrics.map((metric) => (
                      <div
                        className="grid grid-cols-[1.35fr_88px_88px_92px_92px_92px_92px] border-t border-slate-100 px-4 py-3 text-sm"
                        key={metric.session_id}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{metric.user_name}</p>
                          <p className="text-xs text-slate-500">
                            {formatDateTime(metric.finished_at)} | {modeLabel(metric.mode)} | mão {handLabel(metric.hand)}
                          </p>
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

            <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">Precisão por dedo</h2>
              <p className="mt-1 text-sm text-slate-500">Últimas sessões com 4 faixas.</p>
              <div className="mt-4 space-y-4">
                {dashboardMetrics.filter((metric) => metric.mode === "buttons").length === 0 ? (
                  <p className="text-sm text-slate-500">Sem sessões de botões ainda.</p>
                ) : (
                  dashboardMetrics
                    .filter((metric) => metric.mode === "buttons")
                    .slice(0, 4)
                    .map((metric) => (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" key={metric.session_id}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-semibold text-slate-900">{metric.user_name}</p>
                          <span className="text-xs text-slate-500">{formatDateTime(metric.finished_at)}</span>
                        </div>
                        <div className="mt-3 grid grid-cols-4 gap-2">
                          {[1, 2, 3, 4].map((laneId) => (
                            <div className="text-center" key={laneId}>
                              <div
                                className="mx-auto h-3 w-8 rounded-full"
                                style={{ backgroundColor: LANES[laneId].color }}
                              />
                              <p className="mt-1 text-xs font-semibold tabular-nums text-slate-700">
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

          {apiError ? <p className="text-sm font-semibold text-rose-600">{apiError}</p> : null}
        </div>
      </main>
    );
  }

  if (!activeSession && screen === "benchmarks") {
    return <BenchmarkDashboard onBack={() => setScreen("setup")} />;
  }

  if (!activeSession) {
    return (
      <main className="min-h-screen bg-[#f4f7fb] px-4 py-5 text-slate-900">
        <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-5xl flex-col justify-center">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="flex min-h-[420px] flex-col justify-between rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h1 className="text-3xl font-semibold text-slate-950">Hand Rehab</h1>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                      Configure paciente, modo e mão antes de iniciar. Depois a pista ocupa a tela inteira.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={connectionStatus} />
                    <button
                      className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:border-slate-500"
                      type="button"
                      onClick={() => setScreen("dashboard")}
                    >
                      Dashboard
                    </button>
                    <button
                      className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:border-slate-500"
                      type="button"
                      onClick={() => setScreen("benchmarks")}
                    >
                      Métricas
                    </button>
                  </div>
                </div>

                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  <ChoiceButton
                    active={uiMode === "single"}
                    disabled={apiBusy}
                    label="1 faixa"
                    meta="Pressão"
                    onClick={() => setUiMode("single")}
                  />
                  <ChoiceButton
                    active={uiMode === "four"}
                    disabled={apiBusy}
                    label="4 faixas"
                    meta="Botões"
                    onClick={() => setUiMode("four")}
                  />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <ChoiceButton
                    active={hand === "left"}
                    disabled={apiBusy}
                    label="Mão esquerda"
                    meta="left"
                    onClick={() => setHand("left")}
                  />
                  <ChoiceButton
                    active={hand === "right"}
                    disabled={apiBusy}
                    label="Mão direita"
                    meta="right"
                    onClick={() => setHand("right")}
                  />
                </div>

                <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-semibold uppercase text-slate-500" htmlFor="threshold">
                      Limiar da pressão
                    </label>
                    <span className="text-sm font-semibold tabular-nums text-slate-900">{threshold.toFixed(2)} kPa</span>
                  </div>
                  <input
                    className="mt-3 w-full accent-slate-900 disabled:opacity-40"
                    disabled={apiBusy || uiMode !== "single"}
                    id="threshold"
                    max={3}
                    min={0.1}
                    step={0.1}
                    type="range"
                    value={threshold}
                    onChange={(event) => setThreshold(Number(event.target.value))}
                  />
                </div>
              </div>

              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">Conexões</p>
                <p className="mt-1">API {backendApiUrl().replace(/^https?:\/\//, "")}</p>
                <p>Node-RED {sessionSignal}</p>
              </div>
            </section>

            <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500" htmlFor="patient">
                  Paciente
                </label>
                <select
                  className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 disabled:bg-slate-100"
                  disabled={apiBusy || users.length === 0}
                  id="patient"
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                >
                  {users.length === 0 ? (
                    <option value="">Nenhum paciente</option>
                  ) : (
                    users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} | {user.age} anos
                      </option>
                    ))
                  )}
                </select>
                {selectedUser ? (
                  <p className="mt-2 text-xs text-slate-500">
                    {sexLabel(selectedUser.sex)} | {selectedUser.id.slice(0, 8)}
                  </p>
                ) : null}
              </div>

              <form className="mt-5 border-t border-slate-100 pt-4" onSubmit={handleCreateUser}>
                <label>
                  <span className="text-xs font-semibold uppercase text-slate-500">Novo paciente</span>
                  <input
                    className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none transition focus:border-slate-400 disabled:bg-slate-100"
                    disabled={apiBusy}
                    value={newUserName}
                    onChange={(event) => setNewUserName(event.target.value)}
                  />
                </label>
                <div className="mt-2 grid grid-cols-[76px_1fr] gap-2">
                  <input
                    className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none transition focus:border-slate-400 disabled:bg-slate-100"
                    disabled={apiBusy}
                    min={0}
                    type="number"
                    value={newUserAge}
                    onChange={(event) => setNewUserAge(Number(event.target.value))}
                  />
                  <select
                    className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 disabled:bg-slate-100"
                    disabled={apiBusy}
                    value={newUserSex}
                    onChange={(event) => setNewUserSex(event.target.value as Sex)}
                  >
                    <option value="not_informed">Não informado</option>
                    <option value="female">Feminino</option>
                    <option value="male">Masculino</option>
                    <option value="other">Outro</option>
                  </select>
                </div>
                <button
                  className="mt-2 h-10 w-full rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
                  disabled={apiBusy || newUserName.trim().length === 0}
                  type="submit"
                >
                  Criar paciente
                </button>
              </form>

              <button
                className="mt-5 h-12 w-full rounded-lg bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={loading || apiBusy || !selectedUserId}
                type="button"
                onClick={handleStartSession}
              >
                Iniciar jogo
              </button>

              {apiError ? <p className="mt-3 text-sm font-semibold text-rose-600">{apiError}</p> : null}
            </aside>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-[#101622] text-white">
      <section className="relative h-full w-full overflow-hidden">
        <div className="absolute left-0 right-0 top-0 z-30 flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="flex flex-wrap gap-2">
            <Metric label="Pontos" value={stats.score.toLocaleString("pt-BR")} variant="dark" />
            <Metric label="Combo" value={stats.combo} variant="dark" />
            <Metric label="Acertos" value={stats.hits} variant="dark" />
            <Metric label="Tempo" value={formatElapsed(elapsedSeconds)} variant="dark" />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <span className="rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-slate-200">
              {activeUiMode === "single" ? "1 faixa" : "4 faixas"}
            </span>
            <span className="rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-slate-200">
              {hand === "left" ? "Mão esquerda" : "Mão direita"}
            </span>
            <button
              className="h-9 rounded-lg border border-white/20 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={apiBusy}
              type="button"
              onClick={handleFinishSession}
            >
              Finalizar
            </button>
          </div>
        </div>

        <div className="absolute bottom-3 left-3 z-30 hidden max-w-xs rounded-lg border border-white/10 bg-slate-950/60 p-3 text-xs text-slate-300 shadow-sm sm:block">
          <div className="flex items-center justify-between gap-3">
            <span>{connectionLabel(connectionStatus)}</span>
            <span>{sessionSignal}</span>
          </div>
          <div className="mt-2 space-y-1">
            {lastInputs.slice(0, 3).map((input) => (
              <div className="flex items-center justify-between gap-3" key={input.id}>
                <span className="truncate font-medium text-slate-100">{input.label}</span>
                <span className="shrink-0 text-slate-400">{input.meta}</span>
              </div>
            ))}
            {lastInputs.length === 0 ? <p className="text-slate-500">Sem inputs</p> : null}
          </div>
        </div>

        <div className="rhythm-track absolute inset-x-2 bottom-0 top-20 overflow-hidden border border-white/15 bg-slate-950/85 sm:inset-x-10 sm:top-24 lg:inset-x-[12vw]">
          <div className="absolute inset-0 grid" style={laneGridStyle}>
            {activeLanes.map((lane) => (
              <div
                className="relative border-x border-white/10"
                key={lane.id}
                style={{
                  background: `linear-gradient(180deg, ${lane.soft}, rgba(15, 23, 42, 0.3) 44%, ${lane.soft})`,
                }}
              >
                <div
                  className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2"
                  style={{ backgroundColor: lane.line }}
                />
              </div>
            ))}
          </div>

          <div className="absolute inset-0 grid" style={laneGridStyle}>
            {activeLanes.map((lane) => (
              <div className="relative" key={lane.id}>
                {notes
                  .filter((note) => note.laneId === lane.id)
                  .map((note) => {
                    const top = noteTopPercent(note, nowMs);
                    const isMiss = note.status === "miss";
                    const isHit = note.status === "hit";
                    return (
                      <div
                        className={classNames(
                          "absolute left-1/2 h-9 w-[min(70%,78px)] -translate-x-1/2 rounded-full border transition-opacity sm:h-11",
                          isMiss && "opacity-30",
                          isHit && "opacity-75",
                        )}
                        key={note.id}
                        style={{
                          backgroundColor: isMiss ? "rgba(148, 163, 184, 0.6)" : lane.color,
                          borderColor: "rgba(255, 255, 255, 0.72)",
                          boxShadow: isHit ? `0 0 28px ${lane.color}` : `0 8px 26px rgba(0, 0, 0, 0.32)`,
                          top: `${top}%`,
                        }}
                      />
                    );
                  })}
              </div>
            ))}
          </div>

          <div className="absolute bottom-[12%] left-0 right-0 h-px bg-white/35" />
          <div className="absolute bottom-[5%] left-0 right-0 grid px-3" style={laneGridStyle}>
            {activeLanes.map((lane) => {
              const isLaneActive = activeUiMode === "single" ? pressureActive : Boolean(pressedLanes[lane.id]);
              return (
                <div className="flex justify-center" key={lane.id}>
                  <div
                    className="flex h-12 w-[min(76%,92px)] items-center justify-center rounded-full border-2 bg-slate-950 text-xs font-semibold text-white transition sm:h-14"
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
        </div>

        {feedback ? (
          <div
            className={classNames(
              "pointer-events-none absolute left-1/2 top-28 z-40 -translate-x-1/2 rounded-full border px-5 py-2 text-sm font-bold shadow-sm",
              feedback.tone === "hit" && "border-emerald-200 bg-emerald-50 text-emerald-700",
              feedback.tone === "miss" && "border-rose-200 bg-rose-50 text-rose-700",
              feedback.tone === "neutral" && "border-slate-200 bg-white text-slate-800",
            )}
          >
            {feedback.label}
          </div>
        ) : null}

        {apiError ? (
          <div className="absolute bottom-3 right-3 z-40 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm">
            {apiError}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function ChoiceButton({
  active,
  disabled,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      className={classNames(
        "h-20 rounded-lg border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-slate-900 bg-slate-950 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-800 hover:border-slate-400",
      )}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      <span className="block text-sm font-semibold">{label}</span>
      <span className={classNames("mt-1 block text-xs", active ? "text-slate-300" : "text-slate-500")}>{meta}</span>
    </button>
  );
}

function StatusPill({ status }: { status: RealtimeConnectionStatus }) {
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        status === "open"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-600",
      )}
    >
      <span className={classNames("h-2 w-2 rounded-full", status === "open" ? "bg-emerald-500" : "bg-slate-400")} />
      {connectionLabel(status)}
    </span>
  );
}

function Metric({ label, value, variant = "light" }: { label: string; value: number | string; variant?: "light" | "dark" }) {
  return (
    <div
      className={classNames(
        "rounded-lg border px-3 py-2 shadow-sm",
        variant === "dark" ? "border-white/10 bg-slate-950/60 text-white" : "border-slate-200 bg-white text-slate-950",
      )}
    >
      <p className={classNames("text-xs font-semibold uppercase", variant === "dark" ? "text-slate-400" : "text-slate-500")}>
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{value}</p>
    </div>
  );
}
