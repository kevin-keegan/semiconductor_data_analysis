#!/bin/bash
set -euo pipefail

echo "[EPA] container starting"

mkdir -p /mnt/r2 /app/data/measurement

if [[ -n "${AWS_ACCESS_KEY_ID:-}" \
   && -n "${AWS_SECRET_ACCESS_KEY:-}" \
   && -n "${R2_ACCOUNT_ID:-}" \
   && -n "${R2_BUCKET_NAME:-}" ]]; then

  echo "[EPA] mounting R2 bucket ${R2_BUCKET_NAME} as read-only"
  export AWS_ENDPOINT_URL="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

  /usr/local/bin/tigrisfs \
    --endpoint "${AWS_ENDPOINT_URL}" \
    -o ro \
    -f "${R2_BUCKET_NAME}" \
    /mnt/r2 &

  for i in {1..20}; do
    if [[ -d /mnt/r2/measurement ]] && ls /mnt/r2/measurement >/dev/null 2>&1; then
      echo "[EPA] R2 mount ready"
      break
    fi
    sleep 0.5
  done
else
  echo "[EPA] R2 credentials not set; OES raw-data pages may be unavailable."
fi

python - <<'PY'
import json
from pathlib import Path

local = Path("/app/data/measurement")
r2 = Path("/mnt/r2/measurement")

cfg = {
    "process_data": str(local / "Process_data.nc"),
    "process_dictionary": str(local / "Dictionary_process.nc"),
    "oes_dir": str(r2 if r2.exists() else local),
}
Path("/app/data_paths.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")
print("[EPA] data_paths.json ->", cfg)
PY

exec uvicorn backend.main:app --host 0.0.0.0 --port 8080 --workers 1
