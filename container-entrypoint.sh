#!/bin/bash
set -euo pipefail

echo "[EPA] starting without R2 mount"

mkdir -p /app/data/measurement

python - <<'PY'
import json
from pathlib import Path

local = Path("/app/data/measurement")

cfg = {
    "process_data": str(local / "Process_data.nc"),
    "process_dictionary": str(local / "Dictionary_process.nc"),
    "oes_dir": str(local),
}

Path("/app/data_paths.json").write_text(
    json.dumps(cfg, indent=2),
    encoding="utf-8",
)

print("[EPA] local data_paths.json ->", cfg)
PY

exec uvicorn backend.main:app   --host 0.0.0.0   --port 8080   --workers 1
