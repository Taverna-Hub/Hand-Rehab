from pathlib import Path

Import("env")


REQUIRED_KEYS = (
    "WIFI_SSID",
    "WIFI_PASSWORD",
    "MQTT_BROKER",
    "MQTT_PORT",
    "MQTT_CLIENT_ID",
)


def find_repo_env():
    current = Path(env["PROJECT_DIR"]).resolve()
    for path in (current, *current.parents):
        candidate = path / ".env"
        if candidate.exists():
            return candidate
    return None


def parse_env_file(path):
    values = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        values[key] = value

    return values


def c_string(value):
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'\\"{escaped}\\"'


env_path = find_repo_env()
if env_path is None:
    raise RuntimeError("Arquivo .env nao encontrado na raiz do repositorio.")

env_values = parse_env_file(env_path)
missing = [key for key in REQUIRED_KEYS if not env_values.get(key)]
if missing:
    raise RuntimeError(f"Variaveis ausentes no .env: {', '.join(missing)}")

env.Append(
    CPPDEFINES=[
        ("WIFI_SSID", c_string(env_values["WIFI_SSID"])),
        ("WIFI_PASSWORD", c_string(env_values["WIFI_PASSWORD"])),
        ("MQTT_BROKER", c_string(env_values["MQTT_BROKER"])),
        ("MQTT_PORT", env_values["MQTT_PORT"]),
        ("MQTT_CLIENT_ID", c_string(env_values["MQTT_CLIENT_ID"])),
    ]
)
