from __future__ import annotations

from io import BytesIO
import json
import re

import numpy as np
import pandas as pd

MAX_UPLOAD_BYTES = 100 * 1024 * 1024

ROLE_CANDIDATES = {
    "experiment": [
        "experiment_key", "experiment", "run_id", "run",
        "sample_id", "wafer_key", "wafer_id",
    ],
    "lot": ["lot_number", "lot", "lot_no", "lotno", "batch", "batch_id"],
    "wafer": ["wafer_number", "wafer", "wafer_no", "waferno", "wafer_index"],
    "date": ["date", "process_date", "run_date", "day"],
    "x": ["x_mm", "x", "coord_x", "x_coord", "xpos", "x_position"],
    "y": ["y_mm", "y", "coord_y", "y_coord", "ypos", "y_position"],
    "etch": [
        "si_etch", "etch_depth", "etch", "etch_um",
        "silicon_etch", "oxide_etch",
    ],
    "preox": [
        "preox_thickness", "preox", "pre_oxide",
        "preoxide", "pre_oxide_thickness",
    ],
    "postox": [
        "postox_thickness", "postox", "post_oxide",
        "post_oxide_thickness",
    ],
    "stepheight": [
        "stepheight", "step_height",
        "stepheight_um", "step_height_um",
    ],
}

PROCESS_TOKENS = (
    "pressure", "rf", "power", "flow", "gas", "helium",
    "source", "platen", "voltage", "current", "temperature",
    "temp", "capacitor", "bias", "matching",
)

LEAKAGE_TOKENS = (
    "etch", "stepheight", "step_height",
    "postox", "post_oxide", "postoxide",
)


def _norm(name):
    return re.sub(r"[^a-z0-9]+", "_", str(name).strip().lower()).strip("_")


def _read_upload(filename: str, content: bytes) -> pd.DataFrame:
    if not filename:
        raise ValueError("Filename is missing.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("Upload is larger than 100 MB.")

    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""

    if suffix == "csv":
        last = None
        for enc in ("utf-8-sig", "utf-8", "cp949", "euc-kr", "latin1"):
            try:
                return pd.read_csv(BytesIO(content), encoding=enc)
            except Exception as e:
                last = e
        raise ValueError(f"Could not read CSV: {last}")

    if suffix == "xlsx":
        try:
            return pd.read_excel(BytesIO(content), engine="openpyxl")
        except Exception as e:
            raise ValueError(f"Could not read XLSX: {e}")

    raise ValueError("Supported formats are .csv and .xlsx")


def _suggest_mapping(columns):
    norm_to_original = {}
    for c in columns:
        norm_to_original.setdefault(_norm(c), c)

    result = {}

    for role, candidates in ROLE_CANDIDATES.items():
        picked = None

        # Exact aliases first.
        for cand in candidates:
            if cand in norm_to_original:
                picked = norm_to_original[cand]
                break

        # Conservative partial match:
        # alias may be contained in a longer real column name,
        # but the reverse is not allowed.
        if picked is None:
            for nc, original in norm_to_original.items():
                if len(nc) < 4:
                    continue

                for cand in candidates:
                    if len(cand) < 4:
                        continue

                    if cand in nc:
                        picked = original
                        break

                if picked is not None:
                    break

        result[role] = picked

    return result

def _serial(v):
    if v is None:
        return None
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, (np.integer, int)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return float(v) if np.isfinite(v) else None
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass
    return str(v)


def inspect_upload(filename: str, content: bytes):
    df = _read_upload(filename, content)

    missing = int(df.isna().sum().sum())
    total = int(df.shape[0] * max(1, df.shape[1]))

    preview = []
    for _, row in df.head(8).iterrows():
        preview.append({str(c): _serial(row[c]) for c in df.columns})

    return {
        "filename": filename,
        "rows": int(len(df)),
        "columns_count": int(len(df.columns)),
        "columns": [str(c) for c in df.columns],
        "suggested_mapping": _suggest_mapping(list(df.columns)),
        "missing_cells": missing,
        "missing_pct": round(100 * missing / max(1, total), 2),
        "duplicate_rows": int(df.duplicated().sum()),
        "preview": preview,
    }


def _mapping(mapping_json, columns):
    try:
        raw = json.loads(mapping_json or "{}")
    except Exception:
        raw = {}

    suggested = _suggest_mapping(columns)
    out = {}

    for role in ROLE_CANDIDATES:
        if role in raw:
            value = raw.get(role)
            out[role] = value if value in columns else None
        else:
            out[role] = suggested.get(role)

    return out


def _num_series(df, col):
    if col and col in df.columns:
        return pd.to_numeric(df[col], errors="coerce")
    return pd.Series(np.nan, index=df.index, dtype=float)


def _prepare(df, mapping):
    work = df.copy()

    work["_x"] = _num_series(work, mapping.get("x"))
    work["_y"] = _num_series(work, mapping.get("y"))
    work["_etch"] = _num_series(work, mapping.get("etch"))
    work["_preox"] = _num_series(work, mapping.get("preox"))
    work["_postox"] = _num_series(work, mapping.get("postox"))
    work["_stepheight"] = _num_series(work, mapping.get("stepheight"))

    finite_xy = pd.concat(
        [work["_x"].abs(), work["_y"].abs()],
        ignore_index=True,
    ).dropna()

    coord_scale = 1.0
    if len(finite_xy) and float(finite_xy.quantile(0.95)) > 200:
        work["_x"] = work["_x"] / 1000.0
        work["_y"] = work["_y"] / 1000.0
        coord_scale = 0.001

    work.attrs["coordinate_scale_applied"] = coord_scale

    lot_col = mapping.get("lot")
    wafer_col = mapping.get("wafer")
    date_col = mapping.get("date")
    exp_col = mapping.get("experiment")

    lot = (
        work[lot_col].astype(str).str.strip()
        if lot_col and lot_col in work.columns
        else pd.Series([""] * len(work), index=work.index)
    )
    wafer = (
        work[wafer_col].astype(str).str.strip()
        if wafer_col and wafer_col in work.columns
        else pd.Series(["1"] * len(work), index=work.index)
    )

    if exp_col and exp_col in work.columns:
        work["_experiment"] = work[exp_col].astype(str).str.strip()
    else:
        if date_col and date_col in work.columns:
            dt = pd.to_datetime(work[date_col], errors="coerce")
            date_s = dt.dt.strftime("%Y-%m-%d").fillna(
                work[date_col].astype(str)
            )
            if lot.str.len().gt(0).any():
                work["_experiment"] = (
                    date_s.astype(str)
                    + "_L" + lot.astype(str)
                    + "_W" + wafer.astype(str)
                )
            else:
                work["_experiment"] = (
                    date_s.astype(str)
                    + "_W" + wafer.astype(str)
                )
        elif lot.str.len().gt(0).any():
            work["_experiment"] = (
                "L" + lot.astype(str)
                + "_W" + wafer.astype(str)
            )
        else:
            work["_experiment"] = "W" + wafer.astype(str)

    work["_lot"] = lot
    work["_wafer"] = wafer

    return work


def _wafer_summaries(work):
    usable = work[np.isfinite(work["_etch"])].copy()
    if usable.empty:
        return []

    out = []

    for exp, g in usable.groupby("_experiment", dropna=False):
        vals = g["_etch"].to_numpy(float)

        mean = float(np.mean(vals))
        std = float(np.std(vals))

        out.append({
            "experiment": str(exp),
            "lot": str(g["_lot"].iloc[0]) if len(g) else "",
            "wafer": str(g["_wafer"].iloc[0]) if len(g) else "",
            "n_points": int(len(vals)),
            "mean_um": mean,
            "std_um": std,
            "cv_pct": float(100 * std / abs(mean)) if abs(mean) > 1e-12 else None,
            "p95_p05_um": float(np.percentile(vals, 95) - np.percentile(vals, 5)),
            "min_um": float(np.min(vals)),
            "max_um": float(np.max(vals)),
        })

    out.sort(key=lambda r: (-(r["cv_pct"] or 0), r["experiment"]))
    return out


def _spatial_review(work):
    mask = (
        np.isfinite(work["_x"])
        & np.isfinite(work["_y"])
        & np.isfinite(work["_etch"])
    )
    data = work.loc[mask].copy()

    if data.empty or data["_experiment"].nunique() < 3:
        return [], None, []

    data["_cx"] = data["_x"].round(6)
    data["_cy"] = data["_y"].round(6)

    results = []
    absolute_floor_um = 0.02

    for _, g in data.groupby(["_cx", "_cy"]):
        if g["_experiment"].nunique() < 3:
            continue

        vals = g["_etch"].to_numpy(float)
        exps = g["_experiment"].astype(str).to_numpy()

        for _, row in g.iterrows():
            peer = vals[exps != str(row["_experiment"])]

            if peer.size < 2:
                continue

            median = float(np.median(peer))
            mad = float(np.median(np.abs(peer - median)))
            mad_scale = 1.4826 * mad
            std_scale = float(np.std(peer, ddof=1)) if peer.size >= 3 else 0.0

            scale = max(mad_scale, std_scale, absolute_floor_um)
            z = float((float(row["_etch"]) - median) / scale)

            results.append({
                "experiment": str(row["_experiment"]),
                "x": float(row["_x"]),
                "y": float(row["_y"]),
                "etch_um": float(row["_etch"]),
                "peer_median_um": median,
                "deviation_um": float(row["_etch"]) - median,
                "robust_z": z,
                "status": (
                    "STRONG REVIEW"
                    if abs(z) >= 6
                    else ("REVIEW" if abs(z) >= 4 else "NORMAL")
                ),
            })

    results.sort(key=lambda r: abs(r["robust_z"]), reverse=True)
    top = results[:40]

    focus = top[0]["experiment"] if top else str(data["_experiment"].iloc[0])
    focus_df = data[data["_experiment"].astype(str) == str(focus)]

    focus_points = [
        {
            "x": float(r["_x"]),
            "y": float(r["_y"]),
            "etch": float(r["_etch"]),
        }
        for _, r in focus_df.iterrows()
    ]

    return top, focus, focus_points


def _drivers(df, work, mapping, summaries):
    if len(summaries) < 6:
        return []

    mapped = {v for v in mapping.values() if v}

    target = (
        pd.DataFrame(summaries)[["experiment", "mean_um"]]
        .set_index("experiment")
    )

    out = []

    for col in df.columns:
        nc = _norm(col)

        if col in mapped:
            continue
        if nc.startswith("unnamed"):
            continue
        if any(tok in nc for tok in LEAKAGE_TOKENS):
            continue

        series = pd.to_numeric(df[col], errors="coerce")

        if series.notna().mean() < 0.70:
            continue
        if series.nunique(dropna=True) < 5:
            continue

        tmp = pd.DataFrame({
            "experiment": work["_experiment"].astype(str),
            "value": series,
        })

        agg = tmp.groupby("experiment")["value"].median().to_frame()
        joined = target.join(agg, how="inner").dropna()

        if len(joined) < 6:
            continue
        if joined["value"].nunique() < 4:
            continue

        rho = joined["mean_um"].corr(joined["value"], method="spearman")

        if rho is None or not np.isfinite(rho):
            continue

        out.append({
            "feature": str(col),
            "spearman_rho": float(rho),
            "abs_rho": float(abs(rho)),
            "n_wafers": int(len(joined)),
            "process_like": bool(any(tok in nc for tok in PROCESS_TOKENS)),
        })

    out.sort(key=lambda r: r["abs_rho"], reverse=True)
    return out[:12]


def analyze_upload(filename: str, content: bytes, mapping_json: str = "{}"):
    df = _read_upload(filename, content)
    mapping = _mapping(mapping_json, list(df.columns))
    work = _prepare(df, mapping)

    has_etch = (
        bool(mapping.get("etch"))
        and work["_etch"].notna().sum() > 0
    )

    has_xy = (
        bool(mapping.get("x"))
        and bool(mapping.get("y"))
        and work["_x"].notna().sum() > 0
        and work["_y"].notna().sum() > 0
    )

    wafers = int(work["_experiment"].nunique())

    summaries = _wafer_summaries(work) if has_etch else []

    if has_etch and has_xy:
        anomalies, focus_wafer, focus_points = _spatial_review(work)
    else:
        anomalies, focus_wafer, focus_points = [], None, []

    drivers = _drivers(df, work, mapping, summaries) if has_etch else []
    process_like_count = sum(1 for x in drivers if x.get("process_like"))

    counts = (
        work.groupby("_experiment").size().astype(int).tolist()
        if wafers
        else []
    )

    missing = int(df.isna().sum().sum())
    total = int(df.shape[0] * max(1, df.shape[1]))

    capabilities = {
        "wafer_statistics": bool(has_etch),
        "spatial_map": bool(has_etch and has_xy),
        "spatial_review": bool(has_etch and has_xy and wafers >= 3),
        "driver_screening": bool(drivers),
        "process_root_cause": bool(process_like_count >= 3),
        "oes_evidence": False,
    }

    if not has_etch:
        status = "NEEDS MAPPING"
    elif has_xy and wafers >= 3:
        status = "FULL MEASUREMENT ANALYSIS"
    else:
        status = "PARTIAL ANALYSIS"

    return {
        "filename": filename,
        "status": status,
        "mapping": mapping,
        "qa": {
            "rows": int(len(df)),
            "columns": int(len(df.columns)),
            "wafers": wafers,
            "missing_cells": missing,
            "missing_pct": round(100 * missing / max(1, total), 2),
            "duplicate_rows": int(df.duplicated().sum()),
            "points_per_wafer_min": min(counts) if counts else None,
            "points_per_wafer_median": float(np.median(counts)) if counts else None,
            "points_per_wafer_max": max(counts) if counts else None,
            "coordinate_scale_applied": float(
                work.attrs.get("coordinate_scale_applied", 1.0)
            ),
        },
        "capabilities": capabilities,
        "wafer_summaries": summaries[:50],
        "spatial_anomalies": anomalies,
        "focus_wafer": focus_wafer,
        "focus_points": focus_points,
        "driver_candidates": drivers,
        "notes": [
            "Uploaded-file analysis is exploratory unless its schema matches a validated production pipeline.",
            "Spatial REVIEW / STRONG REVIEW thresholds use |robust z| >= 4 / 6 as review heuristics, not an official defect specification.",
            "Driver screening excludes obvious post-metrology fields and is for investigation prioritization only; it is not causal attribution.",
        ],
    }
