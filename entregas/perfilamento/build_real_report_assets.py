from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[2]
PLOTS_DIR = ROOT / "entregas" / "graficos" / "real"

# Dados reais — run 762ba7a6-41a5-42ee-99fa-b5a1c23023f6 (ESP32 físico)
# Fonte: tabela benchmark_results no PostgreSQL do MVP
Ns = [100, 5_000, 20_000]

# Duração total de 100 iterações de sliding_insert (µs)
ring_duration = [72, 75, 85]
ineff_duration = [400, 16_862, 67_397]

# Latência média por iteração (µs) — arredondada pelo firmware
ring_lat_avg = [0, 0, 0]
ineff_lat_avg = [4, 168, 673]

# Latência máxima registrada entre as 100 iterações (µs)
ring_lat_max = [1, 1, 10]
ineff_lat_max = [4, 195, 700]

RING_COLOR = "#2563eb"
INEFF_COLOR = "#dc2626"
GRID_ALPHA = 0.20

RING_LABEL = "Ring Buffer — O(1)"
INEFF_LABEL = "Deslocamento — O(n)"


def save(name: str) -> None:
    PLOTS_DIR.mkdir(parents=True, exist_ok=True)
    for ext in ("png", "svg"):
        plt.savefig(PLOTS_DIR / f"{name}.{ext}", dpi=180, bbox_inches="tight")
    plt.close()


def x_ticks(ax) -> None:
    ax.set_xscale("log")
    ax.set_xticks(Ns)
    ax.set_xticklabels(["100", "5.000", "20.000"])
    ax.set_xlabel("N amostras no buffer")


# 1. Duração total (100 iterações)
def plot_duracao_total() -> None:
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.plot(Ns, ineff_duration, "o-", color=INEFF_COLOR, lw=2.2, label=INEFF_LABEL)
    ax.plot(Ns, ring_duration, "o-", color=RING_COLOR, lw=2.2, label=RING_LABEL)

    for n, v_i, v_r in zip(Ns, ineff_duration, ring_duration):
        ax.annotate(
            f"×{v_i // v_r}",
            xy=(n, v_i),
            xytext=(0, 9),
            textcoords="offset points",
            ha="center",
            fontsize=8.5,
            color=INEFF_COLOR,
            fontweight="bold",
        )

    x_ticks(ax)
    ax.set_ylabel("Duração total (µs) — 100 iterações")
    ax.set_title(
        "Custo total de 100 sliding_inserts por escala de N", fontweight="bold", pad=10
    )
    ax.legend(frameon=False)
    ax.grid(True, alpha=GRID_ALPHA)
    save("aa-duracao-total")


# 2. Latência média por iteração
def plot_latencia_media() -> None:
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.plot(Ns, ineff_lat_avg, "o-", color=INEFF_COLOR, lw=2.2, label=INEFF_LABEL)
    ax.plot(Ns, ring_lat_avg, "o-", color=RING_COLOR, lw=2.2, label=RING_LABEL)
    x_ticks(ax)
    ax.set_ylabel("Latência média por iteração (µs)")
    ax.set_title("Latência média do sliding_insert", fontweight="bold", pad=10)
    ax.legend(frameon=False)
    ax.grid(True, alpha=GRID_ALPHA)
    save("aa-latencia-media")


# 3. Média vs. pico (jitter)
def plot_pico_vs_media() -> None:
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.plot(
        Ns,
        ineff_lat_max,
        "s--",
        color=INEFF_COLOR,
        lw=2.2,
        label=f"{INEFF_LABEL} — máx.",
    )
    ax.plot(
        Ns, ring_lat_max, "s--", color=RING_COLOR, lw=2.2, label=f"{RING_LABEL} — máx."
    )
    ax.plot(
        Ns,
        ineff_lat_avg,
        "o-",
        color=INEFF_COLOR,
        lw=1.4,
        alpha=0.5,
        label=f"{INEFF_LABEL} — média",
    )
    ax.plot(
        Ns,
        ring_lat_avg,
        "o-",
        color=RING_COLOR,
        lw=1.4,
        alpha=0.5,
        label=f"{RING_LABEL} — média",
    )
    x_ticks(ax)
    ax.set_ylabel("Latência (µs)")
    ax.set_title(
        "Média vs. pico de latência — previsibilidade temporal",
        fontweight="bold",
        pad=10,
    )
    ax.legend(frameon=False, fontsize=8.5, ncol=2)
    ax.grid(True, alpha=GRID_ALPHA)
    save("aa-latencia-pico-vs-media")


#  4. Razão de custo (barras)
def plot_razao_custo() -> None:
    ratios = [i / r for i, r in zip(ineff_duration, ring_duration)]
    labels = ["N=100", "N=5.000", "N=20.000"]

    fig, ax = plt.subplots(figsize=(6, 4))
    bars = ax.bar(
        labels, ratios, color=INEFF_COLOR, width=0.45, edgecolor="white", linewidth=0.8
    )
    for bar, val in zip(bars, ratios):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 5,
            f"{val:.0f}×",
            ha="center",
            fontsize=12,
            fontweight="bold",
            color=INEFF_COLOR,
        )
    ax.set_ylabel("Razão de custo  (deslocamento / ring buffer)")
    ax.set_title(
        "Crescimento relativo do custo: O(n) vs. O(1)", fontweight="bold", pad=10
    )
    ax.grid(axis="y", alpha=GRID_ALPHA)
    ax.set_ylim(0, max(ratios) * 1.20)
    save("aa-razao-custo")


#  5. Medido vs. previsão teórica
def plot_medido_vs_teoria() -> None:
    pred_ineff = [ineff_duration[0] * n / Ns[0] for n in Ns]
    pred_ring = [ring_duration[0]] * 3

    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.plot(
        Ns,
        ineff_duration,
        "o-",
        color=INEFF_COLOR,
        lw=2.2,
        label=f"{INEFF_LABEL} — medido",
    )
    ax.plot(
        Ns,
        pred_ineff,
        "--",
        color=INEFF_COLOR,
        lw=1.4,
        alpha=0.5,
        label=f"{INEFF_LABEL} — previsão Θ(N)",
    )
    ax.plot(
        Ns,
        ring_duration,
        "o-",
        color=RING_COLOR,
        lw=2.2,
        label=f"{RING_LABEL} — medido",
    )
    ax.plot(
        Ns,
        pred_ring,
        "--",
        color=RING_COLOR,
        lw=1.4,
        alpha=0.5,
        label=f"{RING_LABEL} — previsão O(1)",
    )
    x_ticks(ax)
    ax.set_ylabel("Duração total (µs) — 100 iterações")
    ax.set_title(
        "Medido vs. previsão teórica de crescimento", fontweight="bold", pad=10
    )
    ax.legend(frameon=False, fontsize=8.5, ncol=2)
    ax.grid(True, alpha=GRID_ALPHA)
    save("aa-medido-vs-teoria")


def main() -> None:
    plot_duracao_total()
    plot_latencia_media()
    plot_pico_vs_media()
    plot_razao_custo()
    plot_medido_vs_teoria()
    print(f"5 gráficos gerados em {PLOTS_DIR}")


if __name__ == "__main__":
    main()
