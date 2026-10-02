from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import json

BASE_DIR = Path(__file__).resolve().parents[2]
MODEL_DIR = BASE_DIR / "data" / "model_v09"
ARTIFACT = MODEL_DIR / "hierarchical_v09.json"


@lru_cache(maxsize=1)
def _artifact():
    if not ARTIFACT.exists():
        raise FileNotFoundError(
            "Hierarchical v0.9 model artifact is missing. "
            "Run BUILD_HIERARCHICAL_MODEL.py."
        )
    return json.loads(ARTIFACT.read_text(encoding="utf-8"))


def metrics():
    a = _artifact()
    return {
        "version": a["version"],
        "created_from_signature": a.get("signature"),
        "mean_metrics": a["mean_metrics"],
        "spatial_metrics": a["spatial_metrics"],
        "final_point_metrics": a["final_point_metrics"],
        "reference_model": a["reference_model"],
        "notes": a["notes"],
        "feature_counts": a.get("feature_counts", {}),
    }


def prediction(experiment: str):
    a = _artifact()
    row = a["predictions"].get(experiment)
    if row is None:
        raise KeyError(experiment)
    return row
