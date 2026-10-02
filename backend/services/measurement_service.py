from __future__ import annotations

from collections import defaultdict
from functools import lru_cache
from pathlib import Path
import csv
import math
import re
import statistics

BASE_DIR = Path(__file__).resolve().parents[2]
CSV_89 = BASE_DIR / "data" / "measurement" / "Si_Oxide_etch_89_points.csv"


def _pick(fields, candidates):
    low = {str(f).strip().lower(): f for f in fields}
    for c in candidates:
        if c.lower() in low:
            return low[c.lower()]
    return None


def _num(v):
    try:
        if v is None or str(v).strip() == "":
            return None
        x = float(v)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def _median(vals):
    vals = [float(v) for v in vals if v is not None and math.isfinite(float(v))]
    return statistics.median(vals) if vals else None


def _mad_sigma(vals):
    vals = [float(v) for v in vals if v is not None and math.isfinite(float(v))]
    if len(vals) < 3:
        return None
    med = statistics.median(vals)
    mad = statistics.median(abs(v - med) for v in vals)
    return 1.4826 * mad if mad > 1e-12 else None


def _rz(v, peers):
    if v is None:
        return None
    vals = [float(x) for x in peers if x is not None and math.isfinite(float(x))]
    if len(vals) < 3:
        return None
    med = statistics.median(vals)
    sig = _mad_sigma(vals)
    if not sig:
        sig = statistics.pstdev(vals)
    return (float(v) - med) / sig if sig and sig > 1e-12 else 0.0


def _quantile(values, q):
    vals = sorted(float(v) for v in values if v is not None and math.isfinite(float(v)))
    if not vals:
        return None
    if len(vals) == 1:
        return vals[0]
    p = (len(vals) - 1) * q
    lo, hi = int(math.floor(p)), int(math.ceil(p))
    if lo == hi:
        return vals[lo]
    return vals[lo] * (hi - p) + vals[hi] * (p - lo)


def _parts(exp):
    m = re.match(r"(\d{4}-\d{2}-\d{2})_(\d+)$", exp or "")
    return (m.group(1), int(m.group(2))) if m else (None, None)


def _point_status(z):
    a = abs(z or 0.0)
    if a >= 6:
        return "STRONG REVIEW"
    if a >= 4:
        return "REVIEW"
    return "NORMAL"


@lru_cache(maxsize=1)
def load_dataset():
    if not CSV_89.exists():
        raise FileNotFoundError(CSV_89)

    with CSV_89.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames or []
        raw = list(reader)

    exp_col = _pick(fields, ["experiment_key", "experiment", "wafer_key", "run_key", "sample_id", "wafer_id", "id"])
    x_col = _pick(fields, ["X", "x", "x_mm", "xcoord", "x_coord"])
    y_col = _pick(fields, ["Y", "y", "y_mm", "ycoord", "y_coord"])
    etch_col = _pick(fields, ["si_etch", "etch", "etch_um", "etch_depth", "etch_depth_um"])
    lot_col = _pick(fields, ["lot_number", "lot", "lot_no"])
    wafer_col = _pick(fields, ["wafer_number", "wafer", "wafer_no", "wafer_num"])
    step_col = _pick(fields, ["stepheight", "step_height"])
    post_col = _pick(fields, ["postox_thickness", "post_ox_thickness"])
    post_raw_col = _pick(fields, ["postox_thickness_nan", "post_ox_thickness_nan"])
    pre_col = _pick(fields, ["preox_thickness", "pre_ox_thickness"])
    oxide_col = _pick(fields, ["oxide_etch", "sio2_etch"])

    if not all([exp_col, x_col, y_col, etch_col]):
        raise RuntimeError(f"Required columns missing. Columns={fields}")

    rows, dates = [], []
    for r in raw:
        exp = str(r.get(exp_col, "")).strip()
        date, parsed_wafer = _parts(exp)
        if date:
            dates.append(date)
        x, y, etch = _num(r.get(x_col)), _num(r.get(y_col)), _num(r.get(etch_col))
        if not exp or x is None or y is None or etch is None:
            continue
        lot = _num(r.get(lot_col)) if lot_col else None
        wafer = _num(r.get(wafer_col)) if wafer_col else parsed_wafer
        rows.append({
            "experiment": exp,
            "date": date,
            "lot": int(lot) if lot is not None else None,
            "wafer": int(wafer) if wafer is not None else parsed_wafer,
            "x": x, "y": y, "etch": etch,
            "stepheight": _num(r.get(step_col)) if step_col else None,
            "postox": _num(r.get(post_col)) if post_col else None,
            "postox_raw": _num(r.get(post_raw_col)) if post_raw_col else None,
            "preox": _num(r.get(pre_col)) if pre_col else None,
            "oxide_etch": _num(r.get(oxide_col)) if oxide_col else None,
        })

    # Original BOSCH X/Y may be stored as micrometers; dashboard uses millimeters.
    coord_max = max([abs(r["x"]) for r in rows] + [abs(r["y"]) for r in rows], default=0)
    coord_scale = 1000.0 if coord_max > 200 else 1.0
    if coord_scale != 1:
        for r in rows:
            r["x"] /= coord_scale
            r["y"] /= coord_scale

    date_to_lot = {d: i + 1 for i, d in enumerate(sorted(set(dates)))}
    for r in rows:
        if r["date"]:
            r["source_lot"] = r.get("lot")
            r["lot"] = date_to_lot[r["date"]]

    by_exp = defaultdict(list)
    by_xy = defaultdict(list)
    for r in rows:
        by_exp[r["experiment"]].append(r)
        by_xy[(round(r["x"], 6), round(r["y"], 6))].append(r)

    wafer_median = {exp: _median([p["etch"] for p in pts]) for exp, pts in by_exp.items()}
    for r in rows:
        r["centered_etch"] = r["etch"] - wafer_median[r["experiment"]]

    summaries, point_lookup = [], {}
    for exp, pts in sorted(by_exp.items()):
        lot = pts[0]["lot"]
        enriched = []

        for p in pts:
            peers = [q for q in by_xy[(round(p["x"], 6), round(p["y"], 6))] if q["lot"] != lot]
            peer_etch = [q["etch"] for q in peers]
            peer_centered = [q["centered_etch"] for q in peers]
            expected = _median(peer_etch)
            shape_z = _rz(p["centered_etch"], peer_centered)

            metric_z = {}
            for key in ("stepheight", "postox", "preox", "oxide_etch"):
                vals = [q[key] for q in peers if q.get(key) is not None]
                metric_z[key] = _rz(p.get(key), vals) if len(vals) >= 3 else None

            q = dict(p)
            q.update({
                "expected_etch": expected,
                "deviation_um": p["etch"] - expected if expected is not None else None,
                "shape_robust_z": shape_z,
                "point_status": _point_status(shape_z),
                "metric_z": metric_z,
                "postox_imputed": p["postox"] is not None and p["postox_raw"] is None,
            })
            enriched.append(q)

        etches = [p["etch"] for p in pts]
        mean = statistics.fmean(etches)
        std = statistics.pstdev(etches) if len(etches) > 1 else 0.0
        p05, p95 = _quantile(etches, .05), _quantile(etches, .95)
        rmax = max(math.hypot(p["x"], p["y"]) for p in pts)
        center = [p["etch"] for p in pts if math.hypot(p["x"], p["y"]) <= rmax * .38]
        edge = [p["etch"] for p in pts if math.hypot(p["x"], p["y"]) >= rmax * .72]
        top = [p["etch"] for p in pts if p["y"] > 0]
        bottom = [p["etch"] for p in pts if p["y"] < 0]

        z4 = sum(abs(p.get("shape_robust_z") or 0) >= 4 for p in enriched)
        z6 = sum(abs(p.get("shape_robust_z") or 0) >= 6 for p in enriched)
        maxz = max([abs(p.get("shape_robust_z") or 0) for p in enriched], default=0)
        wafer_status = "STRONG REVIEW" if (z6 >= 1 or z4 >= 5) else ("REVIEW" if z4 >= 1 else "NORMAL")

        summaries.append({
            "experiment": exp, "date": pts[0]["date"], "lot": lot, "wafer": pts[0]["wafer"], "n": len(pts),
            "mean": mean, "std": std, "cv_pct": std / mean * 100 if mean else None,
            "min": min(etches), "max": max(etches), "p05": p05, "p95": p95,
            "p95_p05": p95 - p05 if p95 is not None and p05 is not None else None,
            "edge_minus_center": statistics.fmean(edge) - statistics.fmean(center) if edge and center else None,
            "top_minus_bottom": statistics.fmean(top) - statistics.fmean(bottom) if top and bottom else None,
            "flagged_z4": z4, "flagged_z6": z6, "max_shape_z": maxz,
            "wafer_status": wafer_status,
            "imputed_points": sum(bool(p.get("postox_imputed")) for p in enriched),
        })
        point_lookup[exp] = enriched

    return {"rows": rows, "summaries": summaries, "points": point_lookup, "coord_scale": coord_scale}


def experiments():
    return [s["experiment"] for s in load_dataset()["summaries"]]


def wafer_summary(experiment):
    for s in load_dataset()["summaries"]:
        if s["experiment"] == experiment:
            return s
    raise KeyError(experiment)


def wafer_detail(experiment):
    return {"experiment": experiment, "summary": wafer_summary(experiment), "points": load_dataset()["points"].get(experiment, [])}


def diagnose_point(experiment, x, y):
    d = wafer_detail(experiment)
    p = min(d["points"], key=lambda q: (q["x"]-x)**2 + (q["y"]-y)**2)
    s = d["summary"]
    z = p.get("shape_robust_z") or 0
    mz = p.get("metric_z") or {}

    reasons = []
    if abs(z) < 4:
        headline = "No strong spatial anomaly detected"
        reasons.append("Same-position, leave-one-lot-out shape deviation is below |z| = 4.")
    else:
        step = abs(mz.get("stepheight") or 0)
        post = abs(mz.get("postox") or 0)
        oxide = abs(mz.get("oxide_etch") or 0)
        if s["flagged_z4"] >= 5:
            headline = "Broad spatial shape shift suspected"
            reasons.append(f"{s['flagged_z4']} points on this wafer exceed |shape z| >= 4.")
        elif step >= 4 and post < 3:
            headline = "Step-height-dominant local anomaly suspected"
            reasons.append(f"Step height is strongly unusual at the same XY (|z|={step:.2f}).")
        elif step >= 4 and (post >= 4 or oxide >= 4):
            headline = "Multi-metrology local discordance suspected"
            reasons.append("Si etch and multiple metrology channels deviate together at the same XY.")
        else:
            headline = "Localized spatial anomaly suspected"
            reasons.append("Si etch shape is unusual at this XY without one dominant metrology explanation.")
        if p.get("postox_imputed"):
            reasons.append("Post-etch oxide for this point was interpolated, so metrology evidence is less direct.")

    return {
        "point": p, "wafer": s, "status": p["point_status"], "headline": headline, "reasons": reasons,
        "thresholds": {"review_abs_z": 4.0, "strong_abs_z": 6.0},
    }


def dataset_summary():
    d = load_dataset()
    ss = d["summaries"]
    return {
        "wafer_count": len(ss), "point_count": sum(s["n"] for s in ss),
        "normal_count": sum(s["wafer_status"] == "NORMAL" for s in ss),
        "review_count": sum(s["wafer_status"] != "NORMAL" for s in ss),
        "strong_review_count": sum(s["wafer_status"] == "STRONG REVIEW" for s in ss),
        "mean_etch": statistics.fmean(s["mean"] for s in ss),
        "median_cv_pct": _median([s["cv_pct"] for s in ss]),
        "coord_scale": d["coord_scale"],
    }


def lot_summary():
    groups = defaultdict(list)
    for s in load_dataset()["summaries"]:
        groups[s["lot"]].append(s)
    return [{
        "lot": lot, "wafers": len(items),
        "mean_etch": statistics.fmean(x["mean"] for x in items),
        "mean_cv_pct": statistics.fmean(x["cv_pct"] for x in items if x["cv_pct"] is not None),
        "review_count": sum(x["wafer_status"] != "NORMAL" for x in items),
        "strong_review_count": sum(x["wafer_status"] == "STRONG REVIEW" for x in items),
    } for lot, items in sorted(groups.items())]


def anomaly_table(limit=30):
    rows = []
    for exp, pts in load_dataset()["points"].items():
        for p in pts:
            z = p.get("shape_robust_z")
            if z is None:
                continue
            rows.append({
                "experiment": exp, "lot": p["lot"], "wafer": p["wafer"],
                "x": p["x"], "y": p["y"], "etch": p["etch"], "expected": p.get("expected_etch"),
                "deviation": p.get("deviation_um"), "shape_z": z, "status": p.get("point_status"),
            })
    rows.sort(key=lambda r: abs(r["shape_z"]), reverse=True)
    return rows[:limit]
