import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, Gauge, Play, RefreshCw, Square, Table2 } from "lucide-react";
import {
  backendApiUrl,
  cancelBenchmarkRun,
  getBenchmarkRun,
  listBenchmarkRuns,
  startBenchmarkRun,
  type BenchmarkResultRead,
  type BenchmarkRunListItem,
  type BenchmarkRunRead,
  type BenchmarkStatus,
  type BenchmarkStrategy,
} from "./api/backendClient";

type MetricKey = "latency_us_avg" | "latency_us_max";

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function statusLabel(status: BenchmarkStatus) {
  const labels: Record<BenchmarkStatus, string> = {
    cancelled: "cancelado",
    completed: "concluido",
    failed: "falhou",
    running: "em execução",
  };
  return labels[status];
}

function strategyLabel(strategy: BenchmarkStrategy) {
  return strategy === "ring_buffer" ? "Ring Buffer" : "Shift O(n)";
}

function formatDate(value: string | null) {
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

function resultFor(run: BenchmarkRunRead, sampleCount: number, strategy: BenchmarkStrategy) {
  return run.results.find((result) => result.sample_count === sampleCount && result.strategy === strategy);
}

export function BenchmarkDashboard({ onBack }: { onBack: () => void }) {
  const [runs, setRuns] = useState<BenchmarkRunListItem[]>([]);
  const [selectedRun, setSelectedRun] = useState<BenchmarkRunRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRun = useCallback(async (runId: string) => {
    const run = await getBenchmarkRun(runId);
    setSelectedRun(run);
    return run;
  }, []);

  const refreshRuns = useCallback(
    async (preferredRunId?: string) => {
      const loadedRuns = await listBenchmarkRuns();
      setRuns(loadedRuns);
      const nextRunId = preferredRunId ?? selectedRun?.id ?? loadedRuns[0]?.id;
      if (nextRunId) {
        await loadRun(nextRunId);
      } else {
        setSelectedRun(null);
      }
    },
    [loadRun, selectedRun?.id],
  );

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  useEffect(() => {
    if (!selectedRun || selectedRun.status !== "running") {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const run = await loadRun(selectedRun.id);
        if (run.status !== "running") {
          await refreshRuns(run.id);
        }
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : "erro_ao_atualizar_benchmark");
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [loadRun, refreshRuns, selectedRun]);

  const resultCount = selectedRun?.results.length ?? 0;
  const completion = selectedRun ? Math.round((resultCount / selectedRun.expected_results) * 100) : 0;

  async function handleStartBenchmark() {
    setBusy(true);
    setError(null);
    try {
      const run = await startBenchmarkRun();
      setSelectedRun(run);
      await refreshRuns(run.id);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "erro_ao_iniciar_benchmark");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelBenchmark() {
    if (!selectedRun || selectedRun.status !== "running") {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const run = await cancelBenchmarkRun(selectedRun.id, "cancelled_from_dashboard");
      setSelectedRun(run);
      await refreshRuns(run.id);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "erro_ao_cancelar_benchmark");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell px-8 py-7">
      <div className="w-full">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="brand-eyebrow">Telemetria tecnica</p>
            <h1 className="page-heading mt-2">Métricas de Buffer</h1>
            <p className="page-subtitle max-w-2xl">
              Benchmarks isolados da partida com N=100, N=5000 e N=20000 para Ring Buffer e deslocamento O(n).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="secondary-button"
              type="button"
              onClick={onBack}
            >
              <ArrowLeft aria-hidden className="mr-2 h-5 w-5" />
              Jogo
            </button>
            <button
              className="primary-button disabled:opacity-50"
              disabled={busy || selectedRun?.status === "running"}
              type="button"
              onClick={handleStartBenchmark}
            >
              <Play aria-hidden className="mr-2 h-5 w-5" />
              Iniciar benchmark
            </button>
            <button
              className="secondary-button disabled:opacity-45"
              disabled={busy || selectedRun?.status !== "running"}
              type="button"
              onClick={handleCancelBenchmark}
            >
              <Square aria-hidden className="mr-2 h-5 w-5" />
              Encerrar
            </button>
          </div>
        </header>

        {error ? (
          <div className="notice mt-5">
            {error}
          </div>
        ) : null}

        <section className="mt-7 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="data-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-extrabold text-[color:var(--platinum)]">Runs recentes</h2>
              <button
                className="secondary-button min-h-8 px-3 text-xs disabled:opacity-40"
                disabled={busy}
                type="button"
                onClick={() => void refreshRuns()}
              >
                <RefreshCw aria-hidden className="mr-2 h-4 w-4" />
                Atualizar
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {runs.map((run) => (
                <button
                  className={classNames(
                    "w-full rounded-lg p-3 text-left transition",
                    selectedRun?.id === run.id
                      ? "bg-[color:var(--grape-soda)] text-white"
                      : "bg-[rgba(239,239,239,0.06)] text-[color:var(--platinum)] hover:bg-[rgba(239,239,239,0.1)]",
                  )}
                  key={run.id}
                  type="button"
                  onClick={() => void loadRun(run.id)}
                >
                  <span className="block text-sm font-semibold">{formatDate(run.started_at)}</span>
                  <span className={classNames("mt-1 block text-xs", selectedRun?.id === run.id ? "text-[rgba(239,239,239,0.7)]" : "text-[color:var(--muted)]")}>
                    {statusLabel(run.status)} | {run.result_count}/{run.expected_results}
                  </span>
                </button>
              ))}
              {runs.length === 0 ? <p className="rounded-lg bg-[rgba(239,239,239,0.06)] p-3 text-sm font-semibold text-[color:var(--muted)]">Sem benchmarks.</p> : null}
            </div>
          </aside>

          <section className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <InfoCard label="Status" value={selectedRun ? statusLabel(selectedRun.status) : "--"} />
              <InfoCard label="Resultados" value={selectedRun ? `${resultCount}/${selectedRun.expected_results}` : "--"} />
              <InfoCard label="Progresso" value={selectedRun ? `${completion}%` : "--"} />
              <InfoCard label="API" value={backendApiUrl().replace(/^https?:\/\//, "")} />
            </div>

            {selectedRun ? (
              <>
                <div className="data-surface p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="flex items-center gap-2 text-lg font-extrabold text-[color:var(--platinum)]">
                        <Gauge aria-hidden className="h-5 w-5 text-[color:var(--dark-goldenrod)]" />
                        Run {selectedRun.id.slice(0, 8)}
                      </h2>
                      <p className="mt-1 text-sm font-semibold text-[color:var(--muted)]">
                        {selectedRun.device_id} | {selectedRun.iterations} iterações | {selectedRun.last_status ?? "aguardando"}
                      </p>
                    </div>
                    {selectedRun.error ? <span className="text-sm font-semibold text-[color:var(--grape-soda)]">{selectedRun.error}</span> : null}
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-[rgba(239,239,239,0.08)]">
                    <div className="h-full bg-[color:var(--dark-goldenrod)] transition-all" style={{ width: `${completion}%` }} />
                  </div>
                </div>

                <LatencyChart metric="latency_us_avg" run={selectedRun} title="Latência média por operação" />
                <LatencyChart metric="latency_us_max" run={selectedRun} title="Latência máxima por operação" />
                <BenchmarkTable run={selectedRun} />
              </>
            ) : (
              <div className="data-surface p-8 text-center text-sm font-semibold text-[color:var(--muted)]">
                Inicie um benchmark para preencher a dashboard.
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <p className="metric-label">{label}</p>
      <p className="metric-value truncate tabular-nums">{value}</p>
    </div>
  );
}

function LatencyChart({ metric, run, title }: { metric: MetricKey; run: BenchmarkRunRead; title: string }) {
  const maxValue = useMemo(
    () => Math.max(1, run.results.reduce((current, result) => Math.max(current, Number(result[metric])), 0)),
    [metric, run.results],
  );
  const width = 720;
  const height = 270;
  const left = 58;
  const top = 24;
  const bottom = 42;
  const innerWidth = width - left - 18;
  const innerHeight = height - top - bottom;
  const groupWidth = innerWidth / Math.max(1, run.sample_counts.length);
  const barWidth = Math.min(34, groupWidth / 3);
  const colors: Record<BenchmarkStrategy, string> = {
    inefficient_shift_buffer: "rgba(143, 57, 133, 1)",
    ring_buffer: "rgba(182, 143, 64, 1)",
  };

  return (
    <div className="data-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-[color:var(--platinum)]">
          <BarChart3 aria-hidden className="h-5 w-5 text-[color:var(--dark-goldenrod)]" />
          {title}
        </h2>
        <div className="flex flex-wrap gap-3 text-xs font-extrabold text-[color:var(--muted)]">
          {run.strategies.map((strategy) => (
            <span className="inline-flex items-center gap-2" key={strategy}>
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colors[strategy] }} />
              {strategyLabel(strategy)}
            </span>
          ))}
        </div>
      </div>
      <svg className="mt-4 h-auto w-full" role="img" viewBox={`0 0 ${width} ${height}`}>
        <line stroke="rgba(239, 239, 239, 0.18)" x1={left} x2={width - 12} y1={height - bottom} y2={height - bottom} />
        <line stroke="rgba(239, 239, 239, 0.18)" x1={left} x2={left} y1={top} y2={height - bottom} />
        {[0, 0.5, 1].map((ratio) => {
          const y = top + innerHeight - ratio * innerHeight;
          return (
            <g key={ratio}>
              <line stroke="rgba(239, 239, 239, 0.08)" x1={left} x2={width - 12} y1={y} y2={y} />
              <text fill="rgba(239, 239, 239, 0.58)" fontSize="12" textAnchor="end" x={left - 8} y={y + 4}>
                {Math.round(maxValue * ratio)}
              </text>
            </g>
          );
        })}
        {run.sample_counts.map((sampleCount, sampleIndex) => {
          const groupX = left + sampleIndex * groupWidth + groupWidth / 2;
          return (
            <g key={sampleCount}>
              {run.strategies.map((strategy, strategyIndex) => {
                const result = resultFor(run, sampleCount, strategy);
                const value = result ? Number(result[metric]) : 0;
                const barHeight = (value / maxValue) * innerHeight;
                const x = groupX - barWidth + strategyIndex * (barWidth + 6);
                const y = top + innerHeight - barHeight;
                return (
                  <rect
                    fill={colors[strategy]}
                    height={barHeight}
                    key={strategy}
                    rx="3"
                    width={barWidth}
                    x={x}
                    y={y}
                  />
                );
              })}
              <text fill="rgba(239, 239, 239, 0.7)" fontSize="12" fontWeight="700" textAnchor="middle" x={groupX} y={height - 16}>
                N={sampleCount}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function BenchmarkTable({ run }: { run: BenchmarkRunRead }) {
  const sortedResults = [...run.results].sort((left, right) => {
    if (left.sample_count !== right.sample_count) {
      return left.sample_count - right.sample_count;
    }
    return left.strategy.localeCompare(right.strategy);
  });

  return (
    <div className="data-surface">
      <div className="border-b border-[color:var(--line)] p-5">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-[color:var(--platinum)]">
          <Table2 aria-hidden className="h-5 w-5 text-[color:var(--dark-goldenrod)]" />
          Heap, duração e drops
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[rgba(239,239,239,0.06)] text-xs font-extrabold uppercase text-[color:var(--muted)]">
            <tr>
              <th className="px-4 py-3">Estrategia</th>
              <th className="px-4 py-3">N</th>
              <th className="px-4 py-3">Media us</th>
              <th className="px-4 py-3">Max us</th>
              <th className="px-4 py-3">Total us</th>
              <th className="px-4 py-3">Heap antes</th>
              <th className="px-4 py-3">Heap depois</th>
              <th className="px-4 py-3">Drops</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(239,239,239,0.08)] text-[color:var(--platinum)]">
            {sortedResults.map((result) => (
              <tr key={result.id}>
                <td className="px-4 py-3 font-extrabold">{strategyLabel(result.strategy)}</td>
                <td className="px-4 py-3 tabular-nums">{result.sample_count}</td>
                <td className="px-4 py-3 tabular-nums">{result.latency_us_avg.toFixed(2)}</td>
                <td className="px-4 py-3 tabular-nums">{result.latency_us_max}</td>
                <td className="px-4 py-3 tabular-nums">{result.duration_total_us}</td>
                <td className="px-4 py-3 tabular-nums">{result.free_heap_before_bytes ?? "--"}</td>
                <td className="px-4 py-3 tabular-nums">{result.free_heap_after_bytes ?? "--"}</td>
                <td className="px-4 py-3 tabular-nums">{result.dropped_samples}</td>
              </tr>
            ))}
            {sortedResults.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center font-semibold text-[color:var(--muted)]" colSpan={8}>
                  Aguardando resultados da ESP32.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
