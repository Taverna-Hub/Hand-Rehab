from __future__ import annotations

import math
import random
from dataclasses import dataclass


SEED = 20260603
SCENARIOS = ("baseline", "network_jitter", "stress")
SAMPLE_COUNTS = (100, 5000, 20000)
STRATEGIES = ("ring_buffer", "inefficient_shift_buffer")
REPLICATES = 5
ITERATIONS = 100
OPERATION = "sliding_insert"


@dataclass(frozen=True)
class BenchmarkRow:
    scenario: str
    replicate: int
    run_id: str
    strategy: str
    sample_count: int
    iterations: int
    operation: str
    duration_total_us: int
    latency_us_avg: float
    latency_us_max: int
    free_heap_before_bytes: int
    free_heap_after_bytes: int
    min_free_heap_bytes: int
    dropped_samples: int
    mqtt_publish_latency_us: int
    source: str


def scenario_factor(scenario: str) -> float:
    if scenario == "baseline":
        return 1.0
    if scenario == "network_jitter":
        return 1.18
    return 1.42


def latency_profile(strategy: str, sample_count: int, scenario: str, rng: random.Random) -> tuple[float, int, int]:
    factor = scenario_factor(scenario)
    if strategy == "ring_buffer":
        base = 7.6 + math.log10(sample_count) * 0.9
        jitter = rng.uniform(-0.45, 0.65)
        average = max(7.0, min(15.5, (base + jitter) * factor))
        maximum = int(round(average * rng.uniform(1.45, 1.9)))
        mqtt = int(round(1100 * factor + rng.uniform(-90, 170)))
        return round(average, 3), maximum, mqtt

    base = 10.0 + sample_count / 230.0
    jitter = rng.uniform(-2.0, 3.4)
    average = max(10.0, min(180.0, (base + jitter) * factor))
    maximum = int(round(average * rng.uniform(1.75, 2.25)))
    mqtt = int(round(1250 * factor + sample_count / 17.0 + rng.uniform(-80, 260)))
    return round(average, 3), maximum, mqtt


def heap_profile(strategy: str, sample_count: int, scenario: str, rng: random.Random) -> tuple[int, int, int]:
    base_heap = 185_800 if strategy == "ring_buffer" else 185_250
    sample_pressure = sample_count / (42 if strategy == "ring_buffer" else 24)
    network_penalty = {"baseline": 0, "network_jitter": 130, "stress": 310}[scenario]
    extra_pressure = 0 if strategy == "ring_buffer" else rng.randint(80, 240)
    before = int(base_heap - network_penalty - sample_pressure - rng.randint(0, 110))
    after = int(before - rng.randint(45, 180) - extra_pressure)
    minimum = int(min(before, after) - rng.randint(25, 80))
    return before, after, minimum


def drop_profile(strategy: str, sample_count: int, scenario: str, rng: random.Random) -> int:
    scenario_penalty = {"baseline": 0, "network_jitter": 1, "stress": 2}[scenario]
    scale_penalty = 0 if sample_count <= 100 else (1 if sample_count <= 5000 else 2)
    if strategy == "ring_buffer":
        return max(0, scenario_penalty + scale_penalty - 1 + rng.choice([0, 0, 1]))
    return max(0, scenario_penalty + scale_penalty + rng.choice([0, 1, 1]))


def build_rows() -> list[BenchmarkRow]:
    rng = random.Random(SEED)
    rows: list[BenchmarkRow] = []
    for scenario in SCENARIOS:
        for replicate in range(1, REPLICATES + 1):
            for strategy in STRATEGIES:
                for sample_count in SAMPLE_COUNTS:
                    latency_avg, latency_max, mqtt_latency = latency_profile(strategy, sample_count, scenario, rng)
                    heap_before, heap_after, min_heap = heap_profile(strategy, sample_count, scenario, rng)
                    duration = int(round(latency_avg * ITERATIONS * rng.uniform(0.96, 1.08)))
                    run_id = f"emulated-{scenario}-{replicate:02d}-{strategy}-{sample_count}"
                    rows.append(
                        BenchmarkRow(
                            scenario=scenario,
                            replicate=replicate,
                            run_id=run_id,
                            strategy=strategy,
                            sample_count=sample_count,
                            iterations=ITERATIONS,
                            operation=OPERATION,
                            duration_total_us=duration,
                            latency_us_avg=latency_avg,
                            latency_us_max=latency_max,
                            free_heap_before_bytes=heap_before,
                            free_heap_after_bytes=heap_after,
                            min_free_heap_bytes=min_heap,
                            dropped_samples=drop_profile(strategy, sample_count, scenario, rng),
                            mqtt_publish_latency_us=mqtt_latency,
                            source="mqtt_flow_emulated_no_esp32",
                        )
                    )
    return rows
