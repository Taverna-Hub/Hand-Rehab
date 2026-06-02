from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest


async def create_user(client):
    response = await client.post("/api/v1/users", json={"name": "Paciente", "age": 34, "sex": "not_informed"})
    assert response.status_code == 201, response.text
    return response.json()


async def create_session(
    client,
    user_id: str,
    mode: str = "buttons",
    hand: str = "right",
    started_at: str | None = None,
):
    payload = {
        "user_id": user_id,
        "hand": hand,
        "mode": mode,
    }
    if started_at is not None:
        payload["started_at"] = started_at

    response = await client.post(
        "/api/v1/game-sessions/start",
        json=payload,
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.anyio
async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.anyio
async def test_users_crud_minimum(client):
    user = await create_user(client)
    assert user["name"] == "Paciente"

    listing = await client.get("/api/v1/users")
    assert listing.status_code == 200
    assert len(listing.json()) == 1

    fetched = await client.get(f"/api/v1/users/{user['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == user["id"]


@pytest.mark.anyio
async def test_user_required_fields_and_sex_validation(client):
    missing = await client.post("/api/v1/users", json={"name": "Paciente"})
    assert missing.status_code == 422

    invalid = await client.post("/api/v1/users", json={"name": "Paciente", "age": 34, "sex": "x"})
    assert invalid.status_code == 422


@pytest.mark.anyio
async def test_create_and_get_sessions_with_modes_and_hands(client):
    user = await create_user(client)
    buttons = await create_session(client, user["id"], mode="buttons", hand="right")
    await client.patch(f"/api/v1/game-sessions/{buttons['id']}/finish", json={})
    pressure = await create_session(client, user["id"], mode="pressure", hand="left")

    assert buttons["status"] == "running"
    assert buttons["duration_seconds"] is None
    assert buttons["scheduled_finish_at"] is None
    assert buttons["device_id"] == "esp32-001"
    assert pressure["hand"] == "left"
    assert pressure["mode"] == "pressure"

    fetched = await client.get(f"/api/v1/game-sessions/{buttons['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["user_id"] == user["id"]


@pytest.mark.anyio
async def test_reject_second_active_session_and_list_active_sessions(client):
    user = await create_user(client)
    first = await create_session(client, user["id"], mode="buttons", hand="right")

    active = await client.get("/api/v1/game-sessions/active")
    assert active.status_code == 200
    assert [session["id"] for session in active.json()] == [first["id"]]

    second = await client.post(
        "/api/v1/game-sessions/start",
        json={"user_id": user["id"], "hand": "left", "mode": "pressure"},
    )
    assert second.status_code == 409
    assert second.json() == {"detail": "active_session_exists"}

    finish = await client.patch(f"/api/v1/game-sessions/{first['id']}/finish", json={})
    assert finish.status_code == 200

    after_finish = await client.get("/api/v1/game-sessions/active")
    assert after_finish.status_code == 200
    assert after_finish.json() == []

    replacement = await create_session(client, user["id"], mode="pressure", hand="left")
    assert replacement["status"] == "running"


@pytest.mark.anyio
async def test_reject_session_without_existing_user(client):
    response = await client.post(
        "/api/v1/game-sessions/start",
        json={
            "user_id": "00000000-0000-0000-0000-000000000000",
            "hand": "right",
            "mode": "buttons",
        },
    )
    assert response.status_code == 404


@pytest.mark.anyio
async def test_reject_invalid_hand_and_mode(client):
    user = await create_user(client)
    base = {"user_id": user["id"], "hand": "right", "mode": "buttons"}

    invalid_hand = await client.post("/api/v1/game-sessions/start", json={**base, "hand": "center"})
    invalid_mode = await client.post("/api/v1/game-sessions/start", json={**base, "mode": "full"})

    assert invalid_hand.status_code == 422
    assert invalid_mode.status_code == 422


@pytest.mark.anyio
async def test_start_publishes_mqtt_command(client, mqtt_publisher):
    user = await create_user(client)
    session = await create_session(client, user["id"], mode="buttons", hand="right")

    assert mqtt_publisher.messages == [
        {
            "topic": "rehab/devices/esp32-001/commands/start_session",
            "payload": {
                "session_id": session["id"],
                "user_id": user["id"],
                "hand": "right",
                "mode": "buttons",
            },
        }
    ]


@pytest.mark.anyio
async def test_finish_calculates_duration_and_publishes_mqtt(client, mqtt_publisher):
    user = await create_user(client)
    started_at = datetime.now(timezone.utc) - timedelta(seconds=75)
    session = await create_session(client, user["id"], started_at=started_at.isoformat())

    response = await client.patch(f"/api/v1/game-sessions/{session['id']}/finish", json={})

    assert response.status_code == 200, response.text
    finished = response.json()
    assert finished["status"] == "finished"
    assert finished["finished_at"] is not None
    assert finished["duration_seconds"] >= 75
    assert mqtt_publisher.messages[-1] == {
        "topic": "rehab/devices/esp32-001/commands/end_session",
        "payload": {
            "device_id": "esp32-001",
            "session_id": session["id"],
            "user_id": user["id"],
            "hand": "right",
            "mode": "buttons",
        },
    }


@pytest.mark.anyio
async def test_finish_persists_gameplay_metrics_for_dashboard(client):
    user = await create_user(client)
    session = await create_session(client, user["id"], mode="buttons", hand="right")

    response = await client.patch(
        f"/api/v1/game-sessions/{session['id']}/finish",
        json={
            "gameplay_metrics": {
                "total_stimuli": 12,
                "hits": 9,
                "errors": 2,
                "missed_stimuli": 3,
                "score": 1250,
                "max_combo": 5,
                "avg_reaction_ms": 143.7,
                "best_reaction_ms": 72,
                "worst_reaction_ms": 246,
                "accuracy_rate": 75,
                "error_rate": 18.18,
                "missed_rate": 25,
                "precision_by_lane": {"1": 100, "2": 50, "3": 75, "4": 66.67},
            }
        },
    )
    dashboard = await client.get("/api/v1/metrics/gameplay/sessions")

    assert response.status_code == 200, response.text
    assert dashboard.status_code == 200, dashboard.text
    payload = dashboard.json()
    assert len(payload) == 1
    assert payload[0]["session_id"] == session["id"]
    assert payload[0]["user_name"] == user["name"]
    assert payload[0]["score"] == 1250
    assert payload[0]["hits"] == 9
    assert payload[0]["missed_stimuli"] == 3
    assert payload[0]["accuracy_rate"] == 75
    assert payload[0]["precision_by_lane"]["1"] == 100


@pytest.mark.anyio
async def test_finish_rejects_already_finished_session_without_extra_mqtt(client, mqtt_publisher):
    user = await create_user(client)
    session = await create_session(client, user["id"])

    first = await client.patch(f"/api/v1/game-sessions/{session['id']}/finish", json={})
    assert first.status_code == 200
    message_count = len(mqtt_publisher.messages)
    first_finished_at = first.json()["finished_at"]

    second = await client.patch(f"/api/v1/game-sessions/{session['id']}/finish", json={})
    assert second.status_code == 409
    assert second.json() == {"detail": "session_not_running"}
    assert len(mqtt_publisher.messages) == message_count

    fetched = await client.get(f"/api/v1/game-sessions/{session['id']}")
    assert fetched.json()["finished_at"] == first_finished_at


@pytest.mark.anyio
async def test_ingest_compatible_button_batch(client):
    user = await create_user(client)
    session = await create_session(client, user["id"], mode="buttons", hand="right")
    response = await client.post(
        "/api/v1/ingest/batches/buttons",
        json={
            "device_id": "esp32-001",
            "session_id": session["id"],
            "user_id": user["id"],
            "hand": "right",
            "mode": "buttons",
            "batch_id": "buttons-batch-001",
            "strategy": "ring_buffer",
            "sequence_start": 1,
            "sequence_end": 2,
            "created_at_ms": 123900,
            "performance": {
                "insert_latency_us_avg": 8,
                "insert_latency_us_max": 15,
                "mqtt_publish_latency_us": 1200,
                "free_heap_bytes": 185320,
                "min_free_heap_bytes": 184900,
                "buffer_capacity": 64,
                "buffer_used": 2,
                "dropped_samples": 0,
            },
            "events": [
                {"button_id": 1, "event_type": "pressed", "timestamp_ms": 123456, "sequence": 1},
                {"button_id": 2, "event_type": "released", "timestamp_ms": 123700, "sequence": 2},
            ],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["accepted"] is True
    assert response.json()["persisted_events"] == 2


@pytest.mark.anyio
async def test_ingest_button_batch_is_idempotent_for_same_session_and_batch_id(client):
    user = await create_user(client)
    session = await create_session(client, user["id"], mode="buttons", hand="right")
    payload = {
        "device_id": "esp32-001",
        "session_id": session["id"],
        "user_id": user["id"],
        "hand": "right",
        "mode": "buttons",
        "batch_id": "buttons-batch-idempotent",
        "strategy": "ring_buffer",
        "events": [{"button_id": 1, "event_type": "pressed", "timestamp_ms": 123456, "sequence": 1}],
    }

    first = await client.post("/api/v1/ingest/batches/buttons", json=payload)
    second = await client.post("/api/v1/ingest/batches/buttons", json=payload)
    summary = await client.get(f"/api/v1/metrics/sessions/{session['id']}/summary")

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["accepted"] is True
    assert second.json()["telemetry_batch_id"] == first.json()["telemetry_batch_id"]
    assert second.json()["persisted_events"] == 0
    assert summary.json()["button_event_count"] == 1


@pytest.mark.anyio
async def test_ingest_compatible_pressure_batch(client):
    user = await create_user(client)
    session = await create_session(client, user["id"], mode="pressure", hand="left")
    response = await client.post(
        "/api/v1/ingest/batches/pressure",
        json={
            "device_id": "esp32-001",
            "session_id": session["id"],
            "user_id": user["id"],
            "hand": "left",
            "mode": "pressure",
            "batch_id": "pressure-batch-001",
            "strategy": "ring_buffer",
            "sequence_start": 1,
            "sequence_end": 2,
            "created_at_ms": 123900,
            "performance": {"insert_latency_us_avg": 7, "insert_latency_us_max": 13, "dropped_samples": 1},
            "samples": [
                {"pressure_raw": 84532, "pressure_kpa": None, "timestamp_ms": 123456, "sequence": 1},
                {"pressure_raw": 84610, "pressure_kpa": 1.2, "timestamp_ms": 123500, "sequence": 2},
            ],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["accepted"] is True
    assert response.json()["persisted_readings"] == 2


@pytest.mark.anyio
async def test_ingest_pressure_batch_is_idempotent_for_same_session_and_batch_id(client):
    user = await create_user(client)
    session = await create_session(client, user["id"], mode="pressure", hand="left")
    payload = {
        "device_id": "esp32-001",
        "session_id": session["id"],
        "user_id": user["id"],
        "hand": "left",
        "mode": "pressure",
        "batch_id": "pressure-batch-idempotent",
        "strategy": "ring_buffer",
        "samples": [{"pressure_raw": 84610, "pressure_kpa": 1.2, "timestamp_ms": 123500, "sequence": 1}],
    }

    first = await client.post("/api/v1/ingest/batches/pressure", json=payload)
    second = await client.post("/api/v1/ingest/batches/pressure", json=payload)
    summary = await client.get(f"/api/v1/metrics/sessions/{session['id']}/summary")

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["accepted"] is True
    assert second.json()["telemetry_batch_id"] == first.json()["telemetry_batch_id"]
    assert second.json()["persisted_readings"] == 0
    assert summary.json()["pressure_reading_count"] == 1


@pytest.mark.anyio
async def test_ingest_rejects_numeric_strings(client):
    user = await create_user(client)
    session = await create_session(client, user["id"], mode="buttons", hand="right")
    response = await client.post(
        "/api/v1/ingest/batches/buttons",
        json={
            "device_id": "esp32-001",
            "session_id": session["id"],
            "user_id": user["id"],
            "hand": "right",
            "mode": "buttons",
            "batch_id": "buttons-batch-strings",
            "strategy": "ring_buffer",
            "sequence_start": "1",
            "events": [{"button_id": 1, "event_type": "pressed", "timestamp_ms": "123456"}],
        },
    )
    assert response.status_code == 422


@pytest.mark.anyio
async def test_incompatible_batches_are_not_persisted(client):
    user = await create_user(client)
    pressure_session = await create_session(client, user["id"], mode="pressure", hand="left")
    await client.patch(f"/api/v1/game-sessions/{pressure_session['id']}/finish", json={})
    buttons_session = await create_session(client, user["id"], mode="buttons", hand="right")

    button_response = await client.post(
        "/api/v1/ingest/batches/buttons",
        json={
            "device_id": "esp32-001",
            "session_id": pressure_session["id"],
            "user_id": user["id"],
            "hand": "left",
            "mode": "buttons",
            "batch_id": "bad-buttons",
            "strategy": "ring_buffer",
            "events": [{"button_id": 1, "event_type": "pressed", "timestamp_ms": 1}],
        },
    )
    pressure_response = await client.post(
        "/api/v1/ingest/batches/pressure",
        json={
            "device_id": "esp32-001",
            "session_id": buttons_session["id"],
            "user_id": user["id"],
            "hand": "right",
            "mode": "pressure",
            "batch_id": "bad-pressure",
            "strategy": "ring_buffer",
            "samples": [{"pressure_raw": 10, "timestamp_ms": 1}],
        },
    )

    assert button_response.status_code == 200
    assert pressure_response.status_code == 200
    assert button_response.json()["accepted"] is False
    assert pressure_response.json()["accepted"] is False

    pressure_summary = await client.get(f"/api/v1/metrics/sessions/{pressure_session['id']}/summary")
    buttons_summary = await client.get(f"/api/v1/metrics/sessions/{buttons_session['id']}/summary")
    assert pressure_summary.json()["button_event_count"] == 0
    assert buttons_summary.json()["pressure_reading_count"] == 0


@pytest.mark.anyio
async def test_metrics_by_session_and_user(client):
    user = await create_user(client)
    session = await create_session(client, user["id"], mode="buttons", hand="right")
    await client.post(
        "/api/v1/ingest/batches/buttons",
        json={
            "device_id": "esp32-001",
            "session_id": session["id"],
            "user_id": user["id"],
            "hand": "right",
            "mode": "buttons",
            "batch_id": "buttons-batch-001",
            "strategy": "ring_buffer",
            "performance": {"insert_latency_us_avg": 8, "insert_latency_us_max": 15, "dropped_samples": 2},
            "events": [{"button_id": 1, "event_type": "pressed", "timestamp_ms": 123456, "sequence": 1}],
        },
    )

    session_summary = await client.get(f"/api/v1/metrics/sessions/{session['id']}/summary")
    user_summary = await client.get(f"/api/v1/metrics/users/{user['id']}/summary")

    assert session_summary.status_code == 200
    assert session_summary.json()["button_event_count"] == 1
    assert session_summary.json()["pressure_reading_count"] == 0
    assert session_summary.json()["dropped_samples"] == 2

    assert user_summary.status_code == 200
    assert user_summary.json()["total_sessions"] == 1
    assert user_summary.json()["sessions_by_mode"]["buttons"] == 1
    assert user_summary.json()["sessions_by_hand"]["right"] == 1
    assert user_summary.json()["total_button_events"] == 1


@pytest.mark.anyio
async def test_pressure_metric_decimals_are_returned_as_json_numbers(client):
    user = await create_user(client)
    session = await create_session(client, user["id"], mode="pressure", hand="left")
    response = await client.post(
        "/api/v1/ingest/batches/pressure",
        json={
            "device_id": "esp32-001",
            "session_id": session["id"],
            "user_id": user["id"],
            "hand": "left",
            "mode": "pressure",
            "batch_id": "pressure-number-batch",
            "strategy": "ring_buffer",
            "performance": {"insert_latency_us_avg": 7.5, "insert_latency_us_max": 13},
            "samples": [{"pressure_raw": 84610, "pressure_kpa": 1.2, "timestamp_ms": 123500, "sequence": 1}],
        },
    )
    assert response.status_code == 200, response.text

    summary = await client.get(f"/api/v1/metrics/sessions/{session['id']}/summary")
    payload = summary.json()
    assert isinstance(payload["insert_latency_us_avg"], float)
    assert isinstance(payload["pressure_kpa_avg"], float)
    assert payload["pressure_kpa_avg"] == 1.2


@pytest.mark.anyio
async def test_users_and_sessions_are_documented_in_openapi(client):
    response = await client.get("/openapi.json")
    assert response.status_code == 200
    paths = response.json()["paths"]

    assert paths["/api/v1/users"]["get"]["summary"] == "Listar usuarios"
    assert paths["/api/v1/game-sessions"]["get"]["summary"] == "Listar sessoes de jogo"
    assert paths["/api/v1/game-sessions/active"]["get"]["summary"] == "Listar sessoes ativas"
    assert "409" in paths["/api/v1/game-sessions/start"]["post"]["responses"]
    assert "409" in paths["/api/v1/game-sessions/{session_id}/finish"]["patch"]["responses"]


@pytest.mark.anyio
async def test_start_benchmark_publishes_mqtt_command(client, mqtt_publisher):
    response = await client.post("/api/v1/benchmarks/runs", json={})

    assert response.status_code == 201, response.text
    run = response.json()
    assert run["status"] == "running"
    assert run["device_id"] == "esp32-001"
    assert run["sample_counts"] == [100, 5000, 20000]
    assert run["strategies"] == ["ring_buffer", "inefficient_shift_buffer"]
    assert run["expected_results"] == 6
    assert mqtt_publisher.messages == [
        {
            "topic": "rehab/devices/esp32-001/commands/start_benchmark",
            "payload": {
                "run_id": run["id"],
                "sample_counts": [100, 5000, 20000],
                "iterations": 100,
                "strategies": ["ring_buffer", "inefficient_shift_buffer"],
                "operation": "sliding_insert",
            },
        }
    ]


@pytest.mark.anyio
async def test_benchmark_rejects_active_game_session(client):
    user = await create_user(client)
    await create_session(client, user["id"], mode="buttons", hand="right")

    response = await client.post("/api/v1/benchmarks/runs", json={})

    assert response.status_code == 409
    assert response.json() == {"detail": "active_session_exists"}


@pytest.mark.anyio
async def test_benchmark_rejects_second_active_benchmark_until_cancelled(client):
    first = await client.post("/api/v1/benchmarks/runs", json={})
    second = await client.post("/api/v1/benchmarks/runs", json={})

    assert first.status_code == 201, first.text
    assert second.status_code == 409
    assert second.json() == {"detail": "active_benchmark_exists"}

    cancel = await client.patch(
        "/api/v1/benchmarks/runs/active/cancel",
        json={"reason": "esp_not_connected"},
    )
    replacement = await client.post("/api/v1/benchmarks/runs", json={})

    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["status"] == "cancelled"
    assert cancel.json()["error"] == "esp_not_connected"
    assert cancel.json()["finished_at"] is not None
    assert replacement.status_code == 201, replacement.text


@pytest.mark.anyio
async def test_cancel_benchmark_by_id_requires_running_run(client):
    run_response = await client.post("/api/v1/benchmarks/runs", json={})
    run = run_response.json()

    first = await client.patch(f"/api/v1/benchmarks/runs/{run['id']}/cancel", json={})
    second = await client.patch(f"/api/v1/benchmarks/runs/{run['id']}/cancel", json={})

    assert first.status_code == 200, first.text
    assert first.json()["status"] == "cancelled"
    assert second.status_code == 409
    assert second.json() == {"detail": "benchmark_not_running"}


@pytest.mark.anyio
async def test_benchmark_results_are_idempotent_and_complete_run(client):
    run_response = await client.post("/api/v1/benchmarks/runs", json={})
    run = run_response.json()

    first_payload = {
        "run_id": run["id"],
        "device_id": "esp32-001",
        "strategy": "ring_buffer",
        "sample_count": 100,
        "iterations": 100,
        "operation": "sliding_insert",
        "duration_total_us": 1200,
        "latency_us_avg": 12.5,
        "latency_us_max": 25,
        "free_heap_before_bytes": 185000,
        "free_heap_after_bytes": 184900,
        "min_free_heap_bytes": 184700,
        "dropped_samples": 0,
        "timestamp_ms": 123456,
    }
    first = await client.post("/api/v1/benchmarks/results", json=first_payload)
    duplicate = await client.post("/api/v1/benchmarks/results", json=first_payload)

    assert first.status_code == 200, first.text
    assert duplicate.status_code == 200, duplicate.text
    assert first.json()["persisted_results"] == 1
    assert duplicate.json()["benchmark_result_id"] == first.json()["benchmark_result_id"]
    assert duplicate.json()["persisted_results"] == 1

    for strategy in ["ring_buffer", "inefficient_shift_buffer"]:
        for sample_count in [100, 5000, 20000]:
            payload = {
                **first_payload,
                "strategy": strategy,
                "sample_count": sample_count,
                "duration_total_us": sample_count + (1 if strategy == "ring_buffer" else 10),
                "latency_us_avg": 4.5 if strategy == "ring_buffer" else 40.5,
                "latency_us_max": 9 if strategy == "ring_buffer" else 90,
            }
            response = await client.post("/api/v1/benchmarks/results", json=payload)
            assert response.status_code == 200, response.text

    fetched = await client.get(f"/api/v1/benchmarks/runs/{run['id']}")
    assert fetched.status_code == 200, fetched.text
    payload = fetched.json()
    assert payload["status"] == "completed"
    assert payload["finished_at"] is not None
    assert len(payload["results"]) == 6
    assert isinstance(payload["results"][0]["latency_us_avg"], float)


@pytest.mark.anyio
async def test_benchmark_completed_status_before_last_results_is_reconciled(client):
    run_response = await client.post("/api/v1/benchmarks/runs", json={})
    run = run_response.json()

    def result_payload(strategy: str, sample_count: int) -> dict:
        return {
            "run_id": run["id"],
            "device_id": "esp32-001",
            "strategy": strategy,
            "sample_count": sample_count,
            "iterations": 100,
            "operation": "sliding_insert",
            "duration_total_us": sample_count,
            "latency_us_avg": 4.5 if strategy == "ring_buffer" else 40.5,
            "latency_us_max": 9 if strategy == "ring_buffer" else 90,
            "free_heap_before_bytes": 185000,
            "free_heap_after_bytes": 184900,
            "min_free_heap_bytes": 184700,
            "dropped_samples": 0,
            "timestamp_ms": 123456,
        }

    for strategy, sample_count in [
        ("ring_buffer", 100),
        ("inefficient_shift_buffer", 100),
        ("ring_buffer", 5000),
        ("inefficient_shift_buffer", 5000),
    ]:
        response = await client.post("/api/v1/benchmarks/results", json=result_payload(strategy, sample_count))
        assert response.status_code == 200, response.text

    completed_status = await client.post(
        "/api/v1/benchmarks/status",
        json={
            "run_id": run["id"],
            "device_id": "esp32-001",
            "status": "completed",
            "timestamp_ms": 123,
        },
    )
    assert completed_status.status_code == 200, completed_status.text
    assert completed_status.json()["run_status"] == "running"

    for strategy in ["ring_buffer", "inefficient_shift_buffer"]:
        response = await client.post("/api/v1/benchmarks/results", json=result_payload(strategy, 20000))
        assert response.status_code == 200, response.text

    fetched = await client.get(f"/api/v1/benchmarks/runs/{run['id']}")
    assert fetched.status_code == 200, fetched.text
    payload = fetched.json()
    assert payload["status"] == "completed"
    assert payload["last_status"] == "completed"
    assert payload["finished_at"] is not None
    assert len(payload["results"]) == 6


@pytest.mark.anyio
async def test_benchmark_status_can_fail_run(client):
    run_response = await client.post("/api/v1/benchmarks/runs", json={})
    run = run_response.json()

    response = await client.post(
        "/api/v1/benchmarks/status",
        json={
            "run_id": run["id"],
            "device_id": "esp32-001",
            "status": "busy",
            "error": "benchmark_requires_idle_device",
            "timestamp_ms": 123,
        },
    )
    fetched = await client.get(f"/api/v1/benchmarks/runs/{run['id']}")

    assert response.status_code == 200, response.text
    assert response.json()["run_status"] == "failed"
    assert fetched.json()["status"] == "failed"
    assert fetched.json()["error"] == "benchmark_requires_idle_device"
