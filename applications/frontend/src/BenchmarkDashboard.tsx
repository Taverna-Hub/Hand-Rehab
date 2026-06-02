import { useCallback, useEffect, useMemo, useState } from "react";
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
    running: "em execucao",
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
    <main className="min-h-screen bg-[#f4f7fb] px-4 py-5 text-slate-900">
      <div className="mx-auto w-full max-w-7xl">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Telemetria tecnica</p>
            <h1 className="mt-1 text-3xl font-semibold text-slate-950">Metricas de Buffer</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Benchmarks isolados da partida com N=100, N=5000 e N=20000 para Ring Buffer e deslocamento O(n).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:border-slate-500"
              type="button"
              onClick={onBack}
            >
              Jogo
            </button>
            <button
              className="h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={busy || selectedRun?.status === "running"}
              type="button"
              onClick={handleStartBenchmark}
            >
              Iniciar benchmark
            </button>
            <button
              className="h-10 rounded-lg border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition hover:border-rose-400 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-300"
              disabled={busy || selectedRun?.status !== "running"}
              type="button"
              onClick={handleCancelBenchmark}
            >
              Encerrar
            </button>
          </div>
        </header>

        {error ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        ) : null}

        <section className="mt-5 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-950">Runs recentes</h2>
              <button
                className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-40"
                disabled={busy}
                type="button"
                onClick={() => void refreshRuns()}
              >
                Atualizar
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {runs.map((run) => (
                <button
                  className={classNames(
                    "w-full rounded-lg border p-3 text-left transition",
                    selectedRun?.id === run.id
                      ? "border-slate-900 bg-slate-950 text-white"
                      : "border-slate-200 bg-white text-slate-800 hover:border-slate-400",
                  )}
                  key={run.id}
                  type="button"
                  onClick={() => void loadRun(run.id)}
                >
                  <span className="block text-sm font-semibold">{formatDate(run.started_at)}</span>
                  <span className={classNames("mt-1 block text-xs", selectedRun?.id === run.id ? "text-slate-300" : "text-slate-500")}>
                    {statusLabel(run.status)} | {run.result_count}/{run.expected_results}
                  </span>
                </button>
              ))}
              {runs.length === 0 ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Sem benchmarks.</p> : null}
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
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-950">Run {selectedRun.id.slice(0, 8)}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {selectedRun.device_id} | {selectedRun.iterations} iteracoes | {selectedRun.last_status ?? "aguardando"}
                      </p>
                    </div>
                    {selectedRun.error ? <span className="text-sm font-semibold text-rose-600">{selectedRun.error}</span> : null}
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full bg-slate-950 transition-all" style={{ width: `${completion}%` }} />
                  </div>
                </div>

                <LatencyChart metric="latency_us_avg" run={selectedRun} title="Latencia media por operacao" />
                <LatencyChart metric="latency_us_max" run={selectedRun} title="Latencia maxima por operacao" />
                <BenchmarkTable run={selectedRun} />
              </>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
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
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-2 truncate text-xl font-semibold tabular-nums text-slate-950">{value}</p>
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
    inefficient_shift_buffer: "#dc2626",
    ring_buffer: "#2563eb",
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <div className="flex flex-wrap gap-3 text-xs font-semibold text-slate-600">
          {run.strategies.map((strategy) => (
            <span className="inline-flex items-center gap-2" key={strategy}>
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colors[strategy] }} />
              {strategyLabel(strategy)}
            </span>
          ))}
        </div>
      </div>
      <svg className="mt-4 h-auto w-full" role="img" viewBox={`0 0 ${width} ${height}`}>
        <line stroke="#cbd5e1" x1={left} x2={width - 12} y1={height - bottom} y2={height - bottom} />
        <line stroke="#cbd5e1" x1={left} x2={left} y1={top} y2={height - bottom} />
        {[0, 0.5, 1].map((ratio) => {
          const y = top + innerHeight - ratio * innerHeight;
          return (
            <g key={ratio}>
              <line stroke="#e2e8f0" x1={left} x2={width - 12} y1={y} y2={y} />
              <text fill="#64748b" fontSize="12" textAnchor="end" x={left - 8} y={y + 4}>
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
              <text fill="#475569" fontSize="12" fontWeight="600" textAnchor="middle" x={groupX} y={height - 16}>
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
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4">
        <h2 className="text-lg font-semibold text-slate-950">Heap, duracao e drops</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
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
          <tbody className="divide-y divide-slate-100">
            {sortedResults.map((result) => (
              <tr key={result.id}>
                <td className="px-4 py-3 font-semibold text-slate-900">{strategyLabel(result.strategy)}</td>
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
                <td className="px-4 py-6 text-center text-slate-500" colSpan={8}>
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
