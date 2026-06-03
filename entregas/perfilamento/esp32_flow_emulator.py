from __future__ import annotations

import argparse
import csv
import json
import socket
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from benchmark_model import ITERATIONS, SAMPLE_COUNTS, build_rows


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "entregas" / "perfilamento" / "raw" / "mqtt_flow_emulated_benchmark_results.csv"
SOURCE = "mqtt_flow_emulated_no_esp32"


def encode_mqtt_string(value: str) -> bytes:
    data = value.encode("utf-8")
    if len(data) > 65535:
        raise ValueError("MQTT string is too long")
    return len(data).to_bytes(2, "big") + data


def encode_remaining_length(length: int) -> bytes:
    encoded = bytearray()
    while True:
        byte = length % 128
        length //= 128
        if length > 0:
            byte |= 0x80
        encoded.append(byte)
        if length == 0:
            return bytes(encoded)


class MinimalMqttClient:
    """Small MQTT 3.1.1 QoS 0 publisher used to avoid external dependencies."""

    def __init__(self, host: str, port: int, client_id: str) -> None:
        self.host = host
        self.port = port
        self.client_id = client_id
        self.sock: socket.socket | None = None

    def __enter__(self) -> "MinimalMqttClient":
        self.sock = socket.create_connection((self.host, self.port), timeout=8)
        variable_header = encode_mqtt_string("MQTT") + bytes([4, 2]) + (60).to_bytes(2, "big")
        payload = encode_mqtt_string(self.client_id)
        packet = bytes([0x10]) + encode_remaining_length(len(variable_header) + len(payload)) + variable_header + payload
        self.sock.sendall(packet)
        response = self._recv_exact(4)
        if len(response) < 4 or response[0] != 0x20 or response[3] != 0:
            raise RuntimeError(f"MQTT broker refused connection: {response!r}")
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        if self.sock is not None:
            try:
                self.sock.sendall(bytes([0xE0, 0x00]))
            finally:
                self.sock.close()
                self.sock = None

    def publish_json(self, topic: str, payload: dict[str, Any]) -> int:
        if self.sock is None:
            raise RuntimeError("MQTT client is not connected")
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        variable_header = encode_mqtt_string(topic)
        packet = bytes([0x30]) + encode_remaining_length(len(variable_header) + len(body)) + variable_header + body
        start_ns = time.perf_counter_ns()
        self.sock.sendall(packet)
        return max(0, round((time.perf_counter_ns() - start_ns) / 1000))

    def _recv_exact(self, size: int) -> bytes:
        if self.sock is None:
            raise RuntimeError("MQTT client is not connected")
        chunks = bytearray()
        while len(chunks) < size:
            chunk = self.sock.recv(size - len(chunks))
            if not chunk:
                break
            chunks.extend(chunk)
        return bytes(chunks)


def request_json(method: str, url: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=12) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed with HTTP {error.code}: {details}") from error


def create_benchmark_run(backend_url: str, device_id: str) -> dict[str, Any]:
    return request_json(
        "POST",
        f"{backend_url.rstrip('/')}/api/v1/benchmarks/runs",
        {
            "device_id": device_id,
            "sample_counts": list(SAMPLE_COUNTS),
            "iterations": ITERATIONS,
        },
    )


def get_benchmark_run(backend_url: str, run_id: str) -> dict[str, Any]:
    return request_json("GET", f"{backend_url.rstrip('/')}/api/v1/benchmarks/runs/{run_id}")


def wait_for_benchmark_completion(backend_url: str, run_id: str, timeout_seconds: int) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    last_run: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        last_run = get_benchmark_run(backend_url, run_id)
        expected_results = int(last_run.get("expected_results", 0))
        result_count = len(last_run.get("results", []))
        if last_run.get("status") == "completed" and result_count >= expected_results:
            return last_run
        time.sleep(0.5)
    if last_run is None:
        raise RuntimeError(f"benchmark run {run_id} was not readable")
    result_count = len(last_run.get("results", []))
    raise RuntimeError(
        f"benchmark run {run_id} did not complete within {timeout_seconds}s "
        f"(status={last_run.get('status')}, results={result_count}/{last_run.get('expected_results')})"
    )


def timestamp_ms() -> int:
    return int(time.time() * 1000)


def benchmark_payload(row: Any, run_id: str, device_id: str) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "device_id": device_id,
        "strategy": row.strategy,
        "sample_count": row.sample_count,
        "iterations": row.iterations,
        "operation": row.operation,
        "duration_total_us": row.duration_total_us,
        "latency_us_avg": row.latency_us_avg,
        "latency_us_max": row.latency_us_max,
        "free_heap_before_bytes": row.free_heap_before_bytes,
        "free_heap_after_bytes": row.free_heap_after_bytes,
        "min_free_heap_bytes": row.min_free_heap_bytes,
        "dropped_samples": row.dropped_samples,
        "timestamp_ms": timestamp_ms(),
    }


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def selected_rows(scenarios: list[str], replicates: int) -> list[Any]:
    wanted = set(scenarios)
    return [
        row
        for row in build_rows()
        if row.scenario in wanted and row.replicate <= replicates
    ]


def run_emulation(args: argparse.Namespace) -> list[dict[str, Any]]:
    rows = selected_rows(args.scenario, args.replicates)
    evidence: list[dict[str, Any]] = []
    groups = sorted({(row.scenario, row.replicate) for row in rows})

    if args.dry_run:
        for row in rows:
            record = asdict(row)
            record.update({"backend_run_id": "", "mqtt_publish_latency_us": 0, "source": SOURCE})
            evidence.append(record)
        return evidence

    with MinimalMqttClient(args.mqtt_host, args.mqtt_port, args.client_id) as mqtt:
        for scenario, replicate in groups:
            run = create_benchmark_run(args.backend_url, args.device_id)
            run_id = run["id"]
            status_topic = f"rehab/devices/{args.device_id}/benchmark/status"
            results_topic = f"rehab/devices/{args.device_id}/benchmark/results"
            mqtt.publish_json(
                status_topic,
                {"run_id": run_id, "device_id": args.device_id, "status": "started", "timestamp_ms": timestamp_ms()},
            )

            for row in [item for item in rows if item.scenario == scenario and item.replicate == replicate]:
                publish_latency = mqtt.publish_json(results_topic, benchmark_payload(row, run_id, args.device_id))
                record = asdict(row)
                record.update(
                    {
                        "run_id": row.run_id,
                        "backend_run_id": run_id,
                        "mqtt_publish_latency_us": publish_latency,
                        "source": SOURCE,
                    }
                )
                evidence.append(record)
                if args.delay_ms:
                    time.sleep(args.delay_ms / 1000)

            mqtt.publish_json(
                status_topic,
                {"run_id": run_id, "device_id": args.device_id, "status": "completed", "timestamp_ms": timestamp_ms()},
            )
            final_run = wait_for_benchmark_completion(args.backend_url, run_id, args.ingest_timeout_seconds)
            result_count = len(final_run.get("results", []))
            print(f"{scenario} replicate {replicate}: run={run_id} status={final_run['status']} results={result_count}")

    return evidence


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Emula uma ESP32 publicando benchmarks pelo fluxo MQTT real.")
    parser.add_argument("--backend-url", default="http://localhost:8000")
    parser.add_argument("--mqtt-host", default="localhost")
    parser.add_argument("--mqtt-port", type=int, default=1883)
    parser.add_argument("--device-id", default="esp32-001")
    parser.add_argument("--client-id", default="esp32-flow-emulator")
    parser.add_argument("--scenario", action="append", choices=["baseline", "network_jitter", "stress"], default=None)
    parser.add_argument("--replicates", type=int, default=1)
    parser.add_argument("--delay-ms", type=int, default=20)
    parser.add_argument("--ingest-timeout-seconds", type=int, default=30)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.scenario is None:
        args.scenario = ["baseline", "network_jitter", "stress"]
    if args.replicates < 1 or args.replicates > 5:
        raise SystemExit("--replicates must be between 1 and 5")
    return args


def main() -> None:
    args = parse_args()
    evidence = run_emulation(args)
    write_csv(args.output, evidence)
    mode = "planned" if args.dry_run else "published"
    print(f"{mode} {len(evidence)} benchmark rows into {args.output}")


if __name__ == "__main__":
    main()
