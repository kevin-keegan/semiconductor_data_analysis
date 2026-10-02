from __future__ import annotations

from pathlib import Path
from functools import lru_cache
import math
import re
import statistics

from . import nc_service as ns

BASE_DIR = Path(__file__).resolve().parents[2]
MEAS_DIR = BASE_DIR / "data" / "measurement"
PROCESS_NC = MEAS_DIR / "Process_data.nc"
PROCESS_DICT = MEAS_DIR / "Dictionary_process.nc"

OES_WAVES = [676.16, 584.07, 692.79]

PROCESS_PRIORITY = (
    "heliumbppressure",
    "sourcerfreflectedpower",
    "pressure",
    "platenrfloadpower",
    "platenrfpeaktpeak",
    "platenrftuningcapacitor",
    "sourcerftuningcapacitor",
    "gas7flow",
    "heliumbpflow",
    "forelinepressure",
    "heater2temp",
    "heater4temp",
    "rf",
    "power",
    "flow",
    "gas",
    "temp",
    "bias",
    "capacitor",
)

STAT_KO = {
    "mean": "활성구간 평균",
    "std": "활성구간 표준편차",
    "range": "활성구간 범위",
    "end_minus_start": "활성구간 전후 변화",
    "trend": "활성구간 추세",
}


def _f(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def _date(exp):
    return str(exp).split("_")[0]


def _exp_from_group(group_name):
    m = re.match(r"Day_(\d{4})_(\d{2})_(\d{2})_Wafer_(\d+)$", str(group_name))
    if not m:
        return None
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}_{int(m.group(4)):02d}"


def _str_array(arr):
    out = []
    for v in arr:
        try:
            if isinstance(v, bytes):
                out.append(v.decode("utf-8", errors="ignore").strip("\x00 "))
            elif hasattr(v, "tobytes") and getattr(v, "dtype", None) is not None:
                kind = getattr(v.dtype, "kind", "")
                if kind in {"S", "U"}:
                    out.append(v.tobytes().decode("utf-8", errors="ignore").strip("\x00 "))
                else:
                    out.append(str(v).strip("\x00 "))
            else:
                out.append(str(v).strip("\x00 "))
        except Exception:
            out.append(str(v))
    return out


def _median(vals):
    xs = [_f(v) for v in vals]
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def _robust_z(current, peers):
    c = _f(current)
    xs = [_f(v) for v in peers]
    xs = [x for x in xs if x is not None]

    if c is None or len(xs) < 2:
        return None, None, None

    med = statistics.median(xs)
    mad = statistics.median(abs(x - med) for x in xs)
    mad_scale = 1.4826 * mad
    std_scale = statistics.stdev(xs) if len(xs) >= 3 else 0.0
    floor = max(abs(med) * 1e-4, 1e-8)
    scale = max(mad_scale, std_scale, floor)

    z = (c - med) / scale
    delta = c - med
    delta_pct = 100.0 * delta / abs(med) if abs(med) > floor else None
    return float(z), float(delta), float(delta_pct) if delta_pct is not None else None


def _slope(vals):
    n = len(vals)
    if n < 2:
        return 0.0
    xm = (n - 1) / 2.0
    ym = statistics.fmean(vals)
    num = sum((i - xm) * (v - ym) for i, v in enumerate(vals))
    den = sum((i - xm) ** 2 for i in range(n))
    return num / den if den else 0.0


def _priority(sensor):
    q = sensor.lower().replace("_", "")
    for i, token in enumerate(PROCESS_PRIORITY):
        if token in q:
            return len(PROCESS_PRIORITY) - i
    return 0


def _hint(sensor):
    q = sensor.lower()
    if "heliumbp" in q:
        return "Backside He 공급 안정성과 웨이퍼-척 접촉 상태를 확인하세요."
    if "sourcerfreflected" in q:
        return "Source RF matching과 reflected power 변동을 확인하세요."
    if "platenrf" in q or "bias" in q:
        return "Platen RF / bias 전달 및 matching 상태를 확인하세요."
    if "pressure" in q:
        return "챔버 압력 제어와 가스 공급 안정성을 확인하세요."
    if "flow" in q or "gas" in q:
        return "가스 유량과 MFC 안정성을 확인하세요."
    if "temp" in q:
        return "온도 안정화와 wafer-to-wafer thermal drift를 확인하세요."
    if "capacitor" in q:
        return "RF matching capacitor 위치와 변동을 확인하세요."
    return "동일 Lot 웨이퍼 대비 해당 파라미터의 편차 추세를 확인하세요."


def _clean_sensor(name):
    s = str(name)
    for prefix in ("Stat3_Etch_MV_", "Stat3_Etch_", "MV_"):
        if s.startswith(prefix):
            return s[len(prefix):]
    return s


def _pick_candidate_indices(features, max_sensors=14):
    scored = []
    for i, raw in enumerate(features):
        clean = _clean_sensor(raw)
        p = _priority(clean)
        if p > 0:
            scored.append((p, i, raw, clean))

    scored.sort(reverse=True)

    selected = []
    seen = set()
    for _, i, raw, clean in scored:
        key = clean.lower()
        if key in seen:
            continue
        seen.add(key)
        selected.append((i, raw, clean))
        if len(selected) >= max_sensors:
            break

    return selected


def _active_stats(values, source_rf=None):
    vals = [_f(v) for v in values]

    if source_rf is not None:
        rf = [_f(v) for v in source_rf]
        rf_finite = [x for x in rf if x is not None]
        if rf_finite:
            s = sorted(rf_finite)
            p95 = s[min(len(s)-1, max(0, int(round((len(s)-1)*0.95))))]
            threshold = max(0.0, 0.10 * p95)
            active = [
                vals[i] for i in range(min(len(vals), len(rf)))
                if vals[i] is not None and rf[i] is not None and rf[i] > threshold
            ]
        else:
            active = [x for x in vals if x is not None]
    else:
        active = [x for x in vals if x is not None]

    if len(active) < 10:
        active = [x for x in vals if x is not None]

    if not active:
        return None

    n = len(active)
    edge = max(1, n // 10)

    return {
        "mean": statistics.fmean(active),
        "std": statistics.pstdev(active) if n > 1 else 0.0,
        "range": max(active) - min(active),
        "end_minus_start": statistics.fmean(active[-edge:]) - statistics.fmean(active[:edge]),
        "trend": _slope(active),
    }


@lru_cache(maxsize=1)
def _direct_process_rows():
    if not PROCESS_NC.exists():
        raise FileNotFoundError(f"Process_data.nc not found: {PROCESS_NC}")
    if not PROCESS_DICT.exists():
        raise FileNotFoundError(f"Dictionary_process.nc not found: {PROCESS_DICT}")

    from netCDF4 import Dataset
    import numpy as np

    with Dataset(PROCESS_DICT, "r") as dds:
        decoder = np.asarray(dds["data"][:])

    rows = []

    with Dataset(PROCESS_NC, "r") as ds:
        all_features = []
        for gname, grp in ds.groups.items():
            exp = _exp_from_group(gname)
            if not exp or "feature" not in grp.variables:
                continue
            all_features.extend(_str_array(grp["feature"][:]))

        unique_features = []
        seen = set()
        for f in all_features:
            if f not in seen:
                seen.add(f)
                unique_features.append(f)

        global_candidates = {
            raw for _, raw, _ in _pick_candidate_indices(unique_features, max_sensors=16)
        }

        for gname, grp in ds.groups.items():
            exp = _exp_from_group(gname)
            if not exp:
                continue
            if "feature" not in grp.variables or "data" not in grp.variables:
                continue

            features = _str_array(grp["feature"][:])
            f_index = {name: i for i, name in enumerate(features)}

            chosen = [
                (f_index[name], name, _clean_sensor(name))
                for name in global_candidates
                if name in f_index
            ]
            if not chosen:
                continue

            rf_name = next(
                (name for name in features if "SourceRFLoadPower" in name),
                None,
            )

            wanted_indices = [i for i, _, _ in chosen]
            if rf_name is not None:
                wanted_indices.append(f_index[rf_name])

            wanted_indices = sorted(set(wanted_indices))
            encoded = np.asarray(grp["data"][:, wanted_indices], dtype=np.int64)
            decoded = decoder[encoded].astype(float, copy=False)

            col_map = {orig_idx: j for j, orig_idx in enumerate(wanted_indices)}

            source_rf = (
                decoded[:, col_map[f_index[rf_name]]].tolist()
                if rf_name is not None and f_index[rf_name] in col_map
                else None
            )

            row = {"experiment": exp}

            for orig_idx, raw, clean in chosen:
                arr = decoded[:, col_map[orig_idx]].tolist()
                stats = _active_stats(arr, source_rf)
                if not stats:
                    continue

                for stat, value in stats.items():
                    row[f"{clean}__{stat}"] = float(value)

            rows.append(row)

    if not rows:
        raise RuntimeError("No usable Process feature rows were extracted.")

    return rows


def _get_process_rows():
    errors = []

    try:
        fn = getattr(ns, "process_feature_table", None)
        if callable(fn):
            rows = fn()
            if isinstance(rows, list) and rows:
                return rows, "nc_service.process_feature_table", errors
    except Exception as e:
        errors.append(f"기존 Process feature cache 실패: {type(e).__name__}: {e}")

    try:
        rows = _direct_process_rows()
        return rows, "direct Process_data.nc active-window fallback", errors
    except Exception as e:
        errors.append(f"Process_data.nc 직접 분석 실패: {type(e).__name__}: {e}")

    return [], "unavailable", errors


def _process_evidence(experiment):
    rows, source, errors = _get_process_rows()

    if not rows:
        return [], [], source, errors

    selected = next(
        (r for r in rows if str(r.get("experiment")) == str(experiment)),
        None,
    )

    if selected is None:
        errors.append(f"선택 웨이퍼 Process row 없음: {experiment}")
        return [], [], source, errors

    peers = [
        r for r in rows
        if str(r.get("experiment")) != str(experiment)
        and _date(r.get("experiment")) == _date(experiment)
    ]

    scope = "same_lot"

    if len(peers) < 2:
        peers = [
            r for r in rows
            if str(r.get("experiment")) != str(experiment)
        ]
        scope = "all_wafers_fallback"

    grouped = {}

    for key, current in selected.items():
        if key == "experiment" or "__" not in key:
            continue

        sensor, stat = key.rsplit("__", 1)
        if stat not in STAT_KO:
            continue

        vals = [
            r.get(key) for r in peers
            if _f(r.get(key)) is not None
        ]

        z, delta, delta_pct = _robust_z(current, vals)
        if z is None:
            continue

        item = {
            "source": "PROCESS",
            "parameter": sensor,
            "statistic": stat,
            "statistic_label": STAT_KO[stat],
            "current": _f(current),
            "peer_median": _median(vals),
            "delta": delta,
            "delta_pct": delta_pct,
            "robust_z": z,
            "abs_z": abs(z),
            "peer_n": len(vals),
            "scope": scope,
            "priority": _priority(sensor),
            "hint": _hint(sensor),
        }

        old = grouped.get(sensor)
        if old is None or item["abs_z"] > old["abs_z"]:
            grouped[sensor] = item

    ranked = list(grouped.values())
    ranked.sort(key=lambda x: (x["abs_z"], x["priority"]), reverse=True)
    ranked = ranked[:8]

    top = max([x["abs_z"] for x in ranked], default=1.0)

    for x in ranked:
        x["relative_strength_pct"] = min(
            100.0,
            100.0 * x["abs_z"] / max(top, 1e-9),
        )
        x["level"] = (
            "HIGH" if x["abs_z"] >= 4
            else ("MEDIUM" if x["abs_z"] >= 2 else "LOW")
        )

    return ranked, [r.get("experiment") for r in peers], source, errors


def _oes_evidence(experiment, peers):
    warnings = []
    out = []

    try:
        status = ns.oes_status()
        if not status.get("ready"):
            return [], ["OES 데이터가 연결되어 있지 않습니다."]
    except Exception as e:
        return [], [f"OES 상태 확인 실패: {e}"]

    for wave in OES_WAVES:
        try:
            tr = ns.oes_trace(experiment, wave)
            current = _f(tr.get("mean"))
            actual = _f(tr.get("wavelength_nm")) or wave
        except Exception as e:
            warnings.append(f"{wave:.2f} nm 선택 웨이퍼 로드 실패: {e}")
            continue

        peer_vals = []

        for peer in peers:
            try:
                v = _f(ns.oes_trace(peer, wave).get("mean"))
                if v is not None:
                    peer_vals.append(v)
            except Exception:
                pass

        z, delta, delta_pct = _robust_z(current, peer_vals)

        if z is None:
            continue

        out.append({
            "source": "OES",
            "parameter": f"{actual:.2f} nm",
            "statistic": "mean",
            "statistic_label": "평균 intensity",
            "current": current,
            "peer_median": _median(peer_vals),
            "delta": delta,
            "delta_pct": delta_pct,
            "robust_z": z,
            "abs_z": abs(z),
            "peer_n": len(peer_vals),
            "scope": "same_lot",
            "priority": 0,
            "hint": "동일 Lot 웨이퍼의 OES intensity와 비교하세요.",
        })

    out.sort(key=lambda x: x["abs_z"], reverse=True)
    top = max([x["abs_z"] for x in out], default=1.0)

    for x in out:
        x["relative_strength_pct"] = min(
            100.0,
            100.0 * x["abs_z"] / max(top, 1e-9),
        )
        x["level"] = (
            "HIGH" if x["abs_z"] >= 4
            else ("MEDIUM" if x["abs_z"] >= 2 else "LOW")
        )

    return out, warnings


def root_cause_evidence(experiment: str, include_oes: bool = False):
    process, peers, backend_source, warnings = _process_evidence(experiment)

    oes = []
    if include_oes:
        oes, oes_warnings = _oes_evidence(experiment, peers)
        warnings.extend(oes_warnings)

    combined = process + oes
    combined.sort(key=lambda x: x["abs_z"], reverse=True)

    top = max([x["abs_z"] for x in combined], default=1.0)

    for x in combined:
        x["combined_strength_pct"] = min(
            100.0,
            100.0 * x["abs_z"] / max(top, 1e-9),
        )

    return {
        "experiment": experiment,
        "ok": bool(process or oes),
        "backend_source": backend_source,
        "baseline": {
            "mode": "same_lot_leave_one_wafer_out",
            "peer_count": len(peers),
        },
        "process_candidates": process,
        "oes_candidates": oes,
        "combined_candidates": combined[:10],
        "include_oes": bool(include_oes),
        "warnings": warnings,
        "disclaimer": (
            "파라미터 순위는 동일 Lot 대비 편차 기반 검토 근거이며 "
            "인과 확률이나 원인 확정값이 아닙니다."
        ),
    }

# === ROOT CAUSE DISK CACHE v1.6.3 START ===
import json as _rc_json

_RC_PROCESS_CACHE = BASE_DIR / "data" / "cache_v07" / "root_cause_process_features_v1_6_3.json"
_RC_ORIGINAL_DIRECT_PROCESS_ROWS = _direct_process_rows


def _rc_cache_signature():
    try:
        st = PROCESS_NC.stat()
        return {
            "mtime_ns": int(st.st_mtime_ns),
            "size": int(st.st_size),
        }
    except Exception:
        return None


@lru_cache(maxsize=1)
def _direct_process_rows():
    """
    Persistent compatibility cache for Diagnostics Root Cause Studio.

    The first extraction from Process_data.nc is saved to disk. Later server
    restarts load this small JSON instead of scanning/decoding the NetCDF file
    again. The cache is invalidated automatically when Process_data.nc changes.
    """
    signature = _rc_cache_signature()

    try:
        if _RC_PROCESS_CACHE.exists():
            payload = _rc_json.loads(_RC_PROCESS_CACHE.read_text(encoding="utf-8"))
            if (
                isinstance(payload, dict)
                and payload.get("source_signature") == signature
                and isinstance(payload.get("rows"), list)
                and payload["rows"]
            ):
                return payload["rows"]
    except Exception:
        pass

    rows = _RC_ORIGINAL_DIRECT_PROCESS_ROWS()

    try:
        _RC_PROCESS_CACHE.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "source_signature": signature,
            "rows": rows,
        }
        _RC_PROCESS_CACHE.write_text(
            _rc_json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception:
        pass

    return rows
# === ROOT CAUSE DISK CACHE v1.6.3 END ===
