from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import json

BASE_DIR = Path(__file__).resolve().parents[2]
ARTIFACT = BASE_DIR / "data" / "competition_v1" / "competition_model_v1.json"


@lru_cache(maxsize=1)
def _load():
    if not ARTIFACT.exists():
        raise FileNotFoundError(
            "Competition v1 model artifact is missing. Run BUILD_COMPETITION_MODEL_V1.py."
        )
    return json.loads(ARTIFACT.read_text(encoding="utf-8"))


def metrics():
    a = _load()
    return {
        "version": a["version"],
        "reference_model": a["reference_model"],
        "cohort": a["cohort"],
        "mean_model": a["mean_model"],
        "oes_candidate_ablation": a["oes_candidate_ablation"],
        "early_vm": a["early_vm"],
        "spatial": a["spatial"],
        "final_point": a["final_point"],
        "external_lot10": a.get("external_lot10"),
        "data_quality": a["data_quality"],
        "notes": a["notes"],
    }


def prediction(experiment: str):
    a = _load()
    row = a["predictions"].get(experiment)
    if row is None:
        raise KeyError(experiment)
    return row
