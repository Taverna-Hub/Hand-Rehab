from __future__ import annotations

import argparse
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SECRETS_PATH = ROOT / "include" / "secrets.h"


def upsert_define(content: str, name: str, value: str) -> str:
    pattern = re.compile(rf"^#define\s+{re.escape(name)}\s+.+$", re.MULTILINE)
    replacement = f"#define {name} {value}"
    if pattern.search(content):
        return pattern.sub(replacement, content)

    if not content.endswith("\n"):
        content += "\n"

    marker = "// Gerados pelo projeto examples/pressure_calibration."
    if marker not in content:
        content += f"\n{marker}\n"

    return content + replacement + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Atualiza include/secrets.h com a calibracao de pressao.")
    parser.add_argument("--zero-offset", required=True, type=int, help="Valor PRESSURE_ZERO_OFFSET_RAW impresso pela calibracao.")
    parser.add_argument(
        "--counts-per-kpa",
        required=True,
        type=float,
        help="Valor RAW_COUNTS_PER_KPA impresso pela calibracao.",
    )
    args = parser.parse_args()

    content = SECRETS_PATH.read_text(encoding="utf-8") if SECRETS_PATH.exists() else "#pragma once\n"
    content = upsert_define(content, "PRESSURE_ZERO_OFFSET_RAW", f"{args.zero_offset}L")
    content = upsert_define(content, "RAW_COUNTS_PER_KPA", f"{args.counts_per_kpa:.6f}f")
    SECRETS_PATH.write_text(content, encoding="utf-8")
    print(f"Atualizado: {SECRETS_PATH}")


if __name__ == "__main__":
    main()
