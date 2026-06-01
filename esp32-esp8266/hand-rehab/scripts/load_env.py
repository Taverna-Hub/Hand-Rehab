from pathlib import Path

Import("env")


def find_firmware_env():
    project_dir = Path(env["PROJECT_DIR"]).resolve()
    for current in (project_dir, *project_dir.parents):
        candidate = current / ".env"
        if candidate.exists():
            return candidate
        if (current / ".git").exists():
            break
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


env_path = find_firmware_env()
if env_path is None:
    print("Arquivo .env do firmware/repositorio nao encontrado. Usando include/secrets.h ou valores placeholder do firmware.")
else:
    env_values = parse_env_file(env_path)
    mqtt_host = env_values.get("FIRMWARE_MQTT_HOST") or env_values.get("MQTT_BROKER")
    mqtt_port = env_values.get("FIRMWARE_MQTT_PORT") or env_values.get("MQTT_PORT")
    device_id = env_values.get("DEVICE_ID") or env_values.get("MQTT_CLIENT_ID")

    defines = []
    if env_values.get("WIFI_SSID"):
        defines.append(("WIFI_SSID", c_string(env_values["WIFI_SSID"])))
    if env_values.get("WIFI_PASSWORD"):
        defines.append(("WIFI_PASSWORD", c_string(env_values["WIFI_PASSWORD"])))
    if mqtt_host:
        defines.append(("MQTT_HOST", c_string(mqtt_host)))
        defines.append(("MQTT_BROKER", c_string(mqtt_host)))
    if mqtt_port:
        defines.append(("MQTT_PORT", mqtt_port))
    if device_id:
        defines.append(("DEVICE_ID", c_string(device_id)))
        defines.append(("MQTT_CLIENT_ID", c_string(device_id)))

    if defines:
        env.Append(CPPDEFINES=defines)
