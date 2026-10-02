from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import json

BASE_DIR = Path(__file__).resolve().parents[2]
CACHE_DIR = BASE_DIR / "data" / "cache_v07"
MANIFEST = CACHE_DIR / "manifest.json"


def cache_ready():
    return MANIFEST.exists()


@lru_cache(maxsize=1)
def manifest():
    if not MANIFEST.exists():
        return {"ready": False, "version": None}
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    data["ready"] = True
    return data


@lru_cache(maxsize=256)
def process_payload(experiment: str):
    path = CACHE_DIR / "process" / f"{experiment}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=256)
def oes_payload(experiment: str):
    path = CACHE_DIR / "oes" / f"{experiment}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def evidence_all():
    path = CACHE_DIR / "evidence.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def evidence_payload(experiment: str):
    return evidence_all().get(experiment, {})


@lru_cache(maxsize=1)
def prediction_payload():
    path = CACHE_DIR / "prediction.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))
