from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import math
import re
import statistics

from . import cache_service as cs

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data" / "measurement"
PROCESS_DATA = DATA_DIR / "Process_data.nc"
PROCESS_DICT = DATA_DIR / "Dictionary_process.nc"
OES_DICT = DATA_DIR / "Dictionary_OES.nc"


def _clean_feature(s):
    s = str(s).strip()
    for prefix in ("Stat3_Etch_MV_", "Stat3_", "Etch_MV_", "MV_"):
        if s.startswith(prefix):
            s = s[len(prefix):]
    return s


def _str_array(arr):
    return [(x.decode("utf-8", errors="replace") if isinstance(x, bytes) else str(x)).strip("\x00 ") for x in arr]


def _process_group(exp):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})_(\d+)$", exp or "")
    return f"Day_{m.group(1)}_{m.group(2)}_{m.group(3)}_Wafer_{int(m.group(4)):02d}" if m else None


def _oes_file_group(exp):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})_(\d+)$", exp or "")
    if not m:
        return None, None
    return DATA_DIR / f"Day_{m.group(1)}_{m.group(2)}_{m.group(3)}.nc", f"Wafer_{int(m.group(4)):02d}"


def _elapsed(var, sl=None):
    import numpy as np
    a = np.asarray(var[:] if sl is None else var[sl], dtype=float)
    return (a-a.flat[0]).tolist() if a.size else []


def process_status():
    return {
        "ready": PROCESS_DATA.exists() and PROCESS_DICT.exists(),
        "cache_ready": cs.cache_ready(),
        "process_data": str(PROCESS_DATA), "dictionary": str(PROCESS_DICT),
    }


def oes_status():
    days = sorted(DATA_DIR.glob("Day_*.nc"))
    return {
        "ready": OES_DICT.exists() and bool(days),
        "cache_ready": cs.cache_ready(),
        "oes_dir": str(DATA_DIR), "day_count": len(days), "day_files": [p.name for p in days],
    }


@lru_cache(maxsize=256)
def process_meta(experiment):
    payload = cs.process_payload(experiment)
    if payload:
        return payload["meta"]

    if not process_status()["ready"]:
        raise FileNotFoundError("Process_data.nc / Dictionary_process.nc missing.")
    from netCDF4 import Dataset
    group = _process_group(experiment)
    with Dataset(PROCESS_DATA, "r") as ds:
        g = ds.groups[group]
        sensors = _str_array(g["feature"][:])
        return {
            "experiment": experiment, "group": group, "samples": int(g["data"].shape[0]),
            "sensor_count": len(sensors), "sensors": sensors,
            "display_sensors": [_clean_feature(x) for x in sensors],
            "fast_sensors": [],
            "duration_s": _elapsed(g["times"])[-1],
        }


@lru_cache(maxsize=512)
def process_trace(experiment, sensor, max_points=1200):
    payload = cs.process_payload(experiment)
    if payload:
        traces = payload.get("traces", {})
        if sensor in traces:
            return traces[sensor]
        # Accept clean display name.
        for raw, tr in traces.items():
            if tr.get("display_sensor") == sensor:
                return tr

    # Slow fallback only for non-cached sensors.
    from netCDF4 import Dataset
    import numpy as np
    group = _process_group(experiment)
    with Dataset(PROCESS_DICT, "r") as dds:
        decoder = np.asarray(dds["data"][:])
    with Dataset(PROCESS_DATA, "r") as ds:
        g = ds.groups[group]
        raw = _str_array(g["feature"][:])
        simple = [_clean_feature(x) for x in raw]
        idx = raw.index(sensor) if sensor in raw else (simple.index(sensor) if sensor in simple else None)
        if idx is None:
            raise KeyError(sensor)
        n = int(g["data"].shape[0])
        stride = max(1, math.ceil(n/max_points))
        vals = decoder[np.asarray(g["data"][::stride, idx], dtype=np.int64)].astype(float)
        return {
            "experiment": experiment, "sensor": raw[idx], "display_sensor": simple[idx], "stride": stride,
            "time_s": _elapsed(g["times"], slice(None,None,stride)), "values": vals.tolist(),
            "mean": float(np.nanmean(vals)), "std": float(np.nanstd(vals)),
        }


def process_evidence(experiment):
    return cs.evidence_payload(experiment).get("process", {"available": False, "score": 0.0, "top_features": []})


@lru_cache(maxsize=256)
def oes_meta(experiment):
    payload = cs.oes_payload(experiment)
    if payload:
        return payload["meta"]
    # Slow fallback
    from netCDF4 import Dataset
    import numpy as np
    path, group = _oes_file_group(experiment)
    with Dataset(path, "r") as ds:
        g = ds.groups[group]
        waves = np.asarray(g["wavelengths"][:], dtype=float)
        return {
            "experiment": experiment, "day_file": path.name, "group": group,
            "samples": int(g["data"].shape[0]), "duration_s": _elapsed(g["times"])[-1],
            "wavelength_count": int(waves.size), "wavelength_min": float(waves.min()),
            "wavelength_max": float(waves.max()), "wavelengths": waves.tolist(),
            "cached_wavelengths": [],
        }


@lru_cache(maxsize=512)
def oes_trace(experiment, wavelength_nm, max_points=1200):
    payload = cs.oes_payload(experiment)
    if payload and payload.get("traces"):
        traces = list(payload["traces"].values())
        nearest = min(traces, key=lambda t: abs(float(t["wavelength_nm"])-float(wavelength_nm)))
        if abs(float(nearest["wavelength_nm"])-float(wavelength_nm)) < 2.0:
            return nearest

    # Slow fallback
    from netCDF4 import Dataset
    import numpy as np
    path, group = _oes_file_group(experiment)
    with Dataset(OES_DICT, "r") as dds:
        decoder = np.asarray(dds["data"][:])
    with Dataset(path, "r") as ds:
        g = ds.groups[group]
        waves = np.asarray(g["wavelengths"][:], dtype=float)
        idx = int(np.argmin(np.abs(waves-wavelength_nm)))
        n = int(g["data"].shape[0])
        stride = max(1, math.ceil(n/max_points))
        vals = decoder[np.asarray(g["data"][::stride,idx],dtype=np.int64)].astype(float)
        return {
            "experiment": experiment, "wavelength_nm": float(waves[idx]), "stride": stride,
            "time_s": _elapsed(g["times"], slice(None,None,stride)), "values": vals.tolist(),
            "mean": float(np.nanmean(vals)), "std": float(np.nanstd(vals)),
        }


@lru_cache(maxsize=256)
def oes_spectrum(experiment, fraction=.5):
    payload = cs.oes_payload(experiment)
    if payload and payload.get("spectrum"):
        return payload["spectrum"]
    raise FileNotFoundError("Fast OES spectrum cache missing. Re-run BUILD_FAST_CACHE.py.")


def oes_evidence(experiment):
    return cs.evidence_payload(experiment).get("oes", {"available": False, "score": 0.0, "top_features": []})
