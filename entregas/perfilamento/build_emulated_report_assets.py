from __future__ import annotations

import json
from pathlib import Path

import matplotlib
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "entregas" / "perfilamento" / "raw"
PLOTS_DIR = ROOT / "entregas" / "graficos"
SOURCE_CSV = RAW_DIR / "mqtt_flow_emulated_benchmark_results.csv"
SUMMARY_CSV = RAW_DIR / "mqtt_flow_emulated_benchmark_summary.csv"
MANIFEST_JSON = RAW_DIR / "mqtt_flow_emulated_benchmark_manifest.json"

STRATEGY_LABELS = {
    "ring_buffer": "Ring Buffer O(1)",
    "inefficient_shift_buffer": "Deslocamento O(n)",
}
STRATEGY_COLORS = {
    "ring_buffer": "#2563eb",
    "inefficient_shift_buffer": "#dc2626",
}
SCENARIO_LABELS = {
    "baseline": "Baseline",
    "network_jitter": "Jitter de rede",
    "stress": "Estresse",
}


def load_dataset() -> pd.DataFrame:
    if not SOURCE_CSV.exists():
        raise FileNotFoundError(f"Dataset not found: {SOURCE_CSV}")
    data = pd.read_csv(SOURCE_CSV)
    required = {
        "scenario",
        "replicate",
        "strategy",
        "sample_count",
        "latency_us_avg",
        "latency_us_max",
        "dropped_samples",
        "min_free_heap_bytes",
        "mqtt_publish_latency_us",
        "backend_run_id",
    }
    missing = required.difference(data.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")
    return data


def summarize(data: pd.DataFrame) -> pd.DataFrame:
    summary = (
        data.groupby(["scenario", "strategy"], as_index=False)
        .agg(
            records=("strategy", "size"),
            latency_us_avg_mean=("latency_us_avg", "mean"),
            latency_us_avg_std=("latency_us_avg", "std"),
            latency_us_max_mean=("latency_us_max", "mean"),
            dropped_samples_mean=("dropped_samples", "mean"),
            min_free_heap_bytes_mean=("min_free_heap_bytes", "mean"),
            mqtt_publish_latency_us_mean=("mqtt_publish_latency_us", "mean"),
            backend_runs=("backend_run_id", "nunique"),
        )
        .round(3)
    )
    return summary


def grouped_by_n(data: pd.DataFrame, metric: str) -> pd.DataFrame:
    return (
        data.groupby(["scenario", "sample_count", "strategy"], as_index=False)[metric]
        .mean()
        .sort_values(["scenario", "sample_count", "strategy"])
    )


def save_current_figure(name: str) -> None:
    PLOTS_DIR.mkdir(parents=True, exist_ok=True)
    for suffix in ("png", "svg"):
        path = PLOTS_DIR / f"{name}.{suffix}"
        plt.savefig(path, dpi=180, bbox_inches="tight")
    plt.close()


def plot_metric_by_n(
    data: pd.DataFrame, metric: str, ylabel: str, title: str, output_name: str
) -> None:
    grouped = grouped_by_n(data, metric)
    scenarios = list(SCENARIO_LABELS)
    fig, axes = plt.subplots(1, len(scenarios), figsize=(13.5, 4.8), sharey=True)
    for axis, scenario in zip(axes, scenarios):
        scenario_data = grouped[grouped["scenario"] == scenario]
        for strategy, label in STRATEGY_LABELS.items():
            series = scenario_data[scenario_data["strategy"] == strategy]
            axis.plot(
                series["sample_count"],
                series[metric],
                marker="o",
                linewidth=2,
                label=label,
                color=STRATEGY_COLORS[strategy],
            )
        axis.set_title(SCENARIO_LABELS[scenario])
        axis.set_xlabel("N amostras")
        axis.grid(True, alpha=0.25)
        axis.set_xscale("log")
        axis.set_xticks([100, 5000, 20000])
        axis.set_xticklabels(["100", "5.000", "20.000"])
    axes[0].set_ylabel(ylabel)
    handles, labels = axes[0].get_legend_handles_labels()
    fig.suptitle(title, y=0.98, fontsize=14, fontweight="bold")
    fig.legend(
        handles,
        labels,
        loc="upper center",
        bbox_to_anchor=(0.5, 0.91),
        ncol=2,
        frameon=False,
    )
    fig.subplots_adjust(top=0.76, bottom=0.14, wspace=0.24)
    save_current_figure(output_name)


def plot_drops(data: pd.DataFrame) -> None:
    plot_metric_by_n(
        data,
        "dropped_samples",
        "Drops medios",
        "Drops emulados por escala de N",
        "aa-drops-by-n",
    )


def plot_ratio(data: pd.DataFrame) -> pd.DataFrame:
    grouped = grouped_by_n(data, "latency_us_avg")
    pivot = grouped.pivot_table(
        index=["scenario", "sample_count"], columns="strategy", values="latency_us_avg"
    )
    pivot["ratio"] = pivot["inefficient_shift_buffer"] / pivot["ring_buffer"]
    ratio = pivot.reset_index()[["scenario", "sample_count", "ratio"]]

    fig, axis = plt.subplots(figsize=(9, 4.8))
    scenarios = list(SCENARIO_LABELS)
    sample_counts = sorted(ratio["sample_count"].unique())
    width = 0.22
    x_base = range(len(sample_counts))
    for index, scenario in enumerate(scenarios):
        values = [
            ratio[
                (ratio["scenario"] == scenario)
                & (ratio["sample_count"] == sample_count)
            ]["ratio"].iloc[0]
            for sample_count in sample_counts
        ]
        x_values = [x + (index - 1) * width for x in x_base]
        axis.bar(x_values, values, width=width, label=SCENARIO_LABELS[scenario])
    axis.set_xticks(list(x_base))
    axis.set_xticklabels(
        [f"N={sample_count:,}".replace(",", ".") for sample_count in sample_counts]
    )
    axis.set_ylabel("Razao ineficiente / ring buffer")
    axis.set_title("Crescimento relativo da estrategia O(n)", fontweight="bold", pad=14)
    axis.grid(axis="y", alpha=0.25)
    axis.legend(frameon=False, loc="upper left")
    fig.subplots_adjust(top=0.88, bottom=0.14)
    save_current_figure("aa-inefficient-vs-ring-ratio-bars")
    return ratio.round(3)


def write_manifest(
    data: pd.DataFrame, summary: pd.DataFrame, ratio: pd.DataFrame
) -> None:
    manifest = {
        "source": "mqtt_flow_emulated_no_esp32",
        "source_csv": str(SOURCE_CSV.relative_to(ROOT)).replace("\\", "/"),
        "summary_csv": str(SUMMARY_CSV.relative_to(ROOT)).replace("\\", "/"),
        "row_count": int(len(data)),
        "summary_count": int(len(summary)),
        "scenario_count": int(data["scenario"].nunique()),
        "backend_run_count": int(data["backend_run_id"].nunique()),
        "sample_counts": sorted(int(item) for item in data["sample_count"].unique()),
        "strategies": sorted(str(item) for item in data["strategy"].unique()),
        "ratio_by_scenario_and_n": ratio.to_dict(orient="records"),
        "note": "Algorithm timings are emulated; MQTT publication, Node-RED routing, backend ingestion and persistence were exercised.",
    }
    MANIFEST_JSON.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main() -> None:
    data = load_dataset()
    summary = summarize(data)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    summary.to_csv(SUMMARY_CSV, index=False)

    plot_metric_by_n(
        data,
        "latency_us_avg",
        "Latencia media (us)",
        "Latencia media emulada por escala de N",
        "aa-latency-avg-by-n",
    )
    plot_metric_by_n(
        data,
        "latency_us_max",
        "Latencia maxima media (us)",
        "Picos de latencia emulados por escala de N",
        "aa-latency-max-by-n",
    )
    plot_metric_by_n(
        data,
        "min_free_heap_bytes",
        "Heap minimo medio (bytes)",
        "Heap minimo emulado por escala de N",
        "aa-min-heap-by-n",
    )
    plot_metric_by_n(
        data,
        "mqtt_publish_latency_us",
        "Latencia de publish MQTT (us)",
        "Publish MQTT local medido pelo emulador",
        "aa-mqtt-latency-by-n",
    )
    plot_drops(data)
    ratio = plot_ratio(data)
    write_manifest(data, summary, ratio)
    print(f"Generated assets from {len(data)} emulated MQTT-flow rows.")


if __name__ == "__main__":
    main()
