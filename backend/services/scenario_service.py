from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import csv
import math
import statistics

import numpy as np

from . import root_cause_service as rcs

BASE_DIR = Path(__file__).resolve().parents[2]
CSV_89 = BASE_DIR / "data" / "measurement" / "Si_Oxide_etch_89_points.csv"

EXTERNAL_DATE = "2024-08-22"
RIDGE_ALPHA = 10.0

# Fixed, interpretable Process-state panel.
# This is intentionally not a de-novo "best feature" search.
PREFERRED_SENSORS = [
    "HeliumBPPressure",
    "SourceRFReflectedPower",
    "Pressure",
    "PlatenRFLoadPower",
    "PlatenRFTuningCapacitor",
    "SourceRFTuningCapacitor",
    "Gas7Flow",
    "HeliumBPFlow",
    "ForeLinePressure",
    "Heater4Temp",
    "Heater2Temp",
]


def _finite(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def _date(exp):
    return str(exp).split("_")[0]


def _quantile(values, q):
    xs = sorted(float(x) for x in values if _finite(x) is not None)
    if not xs:
        return None
    if len(xs) == 1:
        return xs[0]
    p = (len(xs) - 1) * q
    lo = int(math.floor(p))
    hi = int(math.ceil(p))
    if lo == hi:
        return xs[lo]
    return xs[lo] * (hi - p) + xs[hi] * (p - lo)


@lru_cache(maxsize=1)
def _measurement_means():
    if not CSV_89.exists():
        raise FileNotFoundError(CSV_89)

    sums, counts = {}, {}

    with CSV_89.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames or []
        low = {str(x).strip().lower(): x for x in fields}

        exp_col = low.get("experiment_key") or low.get("experiment")
        etch_col = low.get("si_etch") or low.get("etch") or low.get("etch_depth")

        if not exp_col or not etch_col:
            raise RuntimeError("Measurement CSV requires experiment_key and si_etch.")

        for row in reader:
            exp = str(row.get(exp_col, "")).strip()
            etch = _finite(row.get(etch_col))
            if not exp or etch is None:
                continue
            sums[exp] = sums.get(exp, 0.0) + etch
            counts[exp] = counts.get(exp, 0) + 1

    return {
        exp: sums[exp] / counts[exp]
        for exp in sums
        if counts.get(exp, 0) > 0
    }


def _sensor_key_map(rows):
    keys = set()
    for row in rows:
        keys.update(k for k in row if k.endswith("__mean"))

    mapping = {}
    for key in keys:
        sensor = key[:-6]
        mapping[sensor.lower()] = (sensor, key)

    selected = []
    seen = set()

    for wanted in PREFERRED_SENSORS:
        found = mapping.get(wanted.lower())

        if found is None:
            found = next(
                (
                    (sensor, key)
                    for sensor, key in mapping.values()
                    if wanted.lower() in sensor.lower()
                ),
                None,
            )

        if found and found[1] not in seen:
            seen.add(found[1])
            selected.append(found)

    return selected


def _prepare_matrix(rows, usable, targets, medians=None):
    if medians is None:
        medians = {}
        for _, key in usable:
            vals = [_finite(r.get(key)) for r in rows]
            vals = [x for x in vals if x is not None]
            medians[key] = statistics.median(vals) if vals else 0.0

    X, y, exps = [], [], []

    for row in rows:
        exp = row.get("experiment")
        if exp not in targets:
            continue

        vec = []
        for _, key in usable:
            v = _finite(row.get(key))
            vec.append(medians[key] if v is None else v)

        X.append(vec)
        y.append(targets[exp])
        exps.append(exp)

    return np.asarray(X, dtype=float), np.asarray(y, dtype=float), exps, medians


def _fit_ridge(X, y):
    mean = X.mean(axis=0)
    std = X.std(axis=0)
    std[std < 1e-12] = 1.0

    Xs = (X - mean) / std
    y_mean = float(y.mean())
    yc = y - y_mean

    beta = np.linalg.solve(
        Xs.T @ Xs + RIDGE_ALPHA * np.eye(Xs.shape[1]),
        Xs.T @ yc,
    )

    return {
        "x_mean": mean,
        "x_std": std,
        "y_mean": y_mean,
        "beta": beta,
    }


def _ridge_predict(fit, X):
    Xs = (X - fit["x_mean"]) / fit["x_std"]
    return fit["y_mean"] + Xs @ fit["beta"]


def _fixed_panel_lolo(primary_rows, usable, targets):
    errors = []
    predictions = []

    dates = sorted({
        _date(r.get("experiment"))
        for r in primary_rows
        if r.get("experiment") in targets
    })

    for held_date in dates:
        train_rows = [
            r for r in primary_rows
            if _date(r.get("experiment")) != held_date
            and r.get("experiment") in targets
        ]
        test_rows = [
            r for r in primary_rows
            if _date(r.get("experiment")) == held_date
            and r.get("experiment") in targets
        ]

        if not train_rows or not test_rows:
            continue

        Xtr, ytr, _, medians = _prepare_matrix(
            train_rows,
            usable,
            targets,
            medians=None,
        )
        Xte, yte, exps, _ = _prepare_matrix(
            test_rows,
            usable,
            targets,
            medians=medians,
        )

        fit = _fit_ridge(Xtr, ytr)
        pred = _ridge_predict(fit, Xte)

        for exp, actual, predicted in zip(exps, yte.tolist(), pred.tolist()):
            err = predicted - actual
            errors.append(err)
            predictions.append({
                "experiment": exp,
                "actual": actual,
                "predicted": predicted,
                "error": err,
            })

    if not errors:
        return {
            "n": 0,
            "rmse": None,
            "mae": None,
            "p90_abs_error": None,
            "predictions": [],
        }

    abs_err = [abs(e) for e in errors]

    return {
        "n": len(errors),
        "rmse": float(math.sqrt(sum(e * e for e in errors) / len(errors))),
        "mae": float(sum(abs_err) / len(abs_err)),
        "p90_abs_error": float(_quantile(abs_err, 0.90)),
        "predictions": predictions,
    }


def _nearest_neighbor_thresholds(Xs):
    if len(Xs) < 3:
        return {"p75": 1.0, "p95": 2.0, "distances": []}

    dists = []

    for i in range(len(Xs)):
        delta = Xs - Xs[i]
        dist = np.sqrt(np.sum(delta * delta, axis=1))
        dist[i] = np.inf
        dists.append(float(np.min(dist)))

    return {
        "p75": float(_quantile(dists, 0.75)),
        "p95": float(_quantile(dists, 0.95)),
        "distances": dists,
    }


@lru_cache(maxsize=1)
def _model():
    rows, process_source, process_warnings = rcs._get_process_rows()
    targets = _measurement_means()

    if not rows:
        raise RuntimeError("Scenario model could not load Process features.")

    candidates = _sensor_key_map(rows)

    primary_rows = [
        r for r in rows
        if r.get("experiment") in targets
        and _date(r.get("experiment")) != EXTERNAL_DATE
    ]

    if len(primary_rows) < 20:
        raise RuntimeError("Too few primary-cohort wafers for scenario model.")

    usable = []

    for sensor, key in candidates:
        vals = [_finite(r.get(key)) for r in primary_rows]
        coverage = sum(v is not None for v in vals) / len(vals)
        finite_vals = [v for v in vals if v is not None]

        if coverage < 0.70:
            continue
        if len(set(round(v, 12) for v in finite_vals)) < 4:
            continue

        usable.append((sensor, key))

    if not usable:
        raise RuntimeError("No stable interpretable Process mean features were found.")

    usable = usable[:6]

    X, y, exps, medians = _prepare_matrix(
        primary_rows,
        usable,
        targets,
        medians=None,
    )

    fit = _fit_ridge(X, y)
    fitted = _ridge_predict(fit, X)

    lolo = _fixed_panel_lolo(primary_rows, usable, targets)

    Xs = (X - fit["x_mean"]) / fit["x_std"]
    nn = _nearest_neighbor_thresholds(Xs)

    ranges = {}

    for j, (sensor, key) in enumerate(usable):
        vals = X[:, j].tolist()
        q05 = _quantile(vals, 0.05)
        q95 = _quantile(vals, 0.95)
        vmin, vmax = min(vals), max(vals)

        if q05 is None or q95 is None or abs(q95 - q05) < 1e-12:
            q05, q95 = vmin, vmax

        span = max(abs(q95 - q05), abs(vmax - vmin), 1e-9)

        ranges[key] = {
            "sensor": sensor,
            "key": key,
            "q05": float(q05),
            "q95": float(q95),
            "min": float(vmin),
            "max": float(vmax),
            "step": float(span / 100.0),
        }

    in_sample_rmse = float(np.sqrt(np.mean((fitted - y) ** 2)))

    return {
        "rows": rows,
        "targets": targets,
        "primary_rows": primary_rows,
        "usable": usable,
        "medians": medians,
        "x_mean": fit["x_mean"].tolist(),
        "x_std": fit["x_std"].tolist(),
        "beta": fit["beta"].tolist(),
        "y_mean": fit["y_mean"],
        "train_n": int(len(y)),
        "train_matrix": X.tolist(),
        "ranges": ranges,
        "process_source": process_source,
        "warnings": process_warnings,
        "reference_data_median": float(statistics.median(y.tolist())),
        "in_sample_rmse": in_sample_rmse,
        "validation": lolo,
        "nn_thresholds": {
            "p75": nn["p75"],
            "p95": nn["p95"],
        },
    }


def _row_for_experiment(model, experiment):
    row = next(
        (r for r in model["rows"] if str(r.get("experiment")) == str(experiment)),
        None,
    )
    if row is None:
        raise KeyError(f"Process state not found for {experiment}")
    return row


def _vector(model, values):
    vec = []
    for _, key in model["usable"]:
        v = _finite(values.get(key))
        vec.append(model["medians"][key] if v is None else v)
    return np.asarray(vec, dtype=float)


def _predict(model, vector):
    mean = np.asarray(model["x_mean"], dtype=float)
    std = np.asarray(model["x_std"], dtype=float)
    beta = np.asarray(model["beta"], dtype=float)

    xs = (vector - mean) / std
    return float(model["y_mean"] + xs @ beta)


def _similarity(model, vector):
    mean = np.asarray(model["x_mean"], dtype=float)
    std = np.asarray(model["x_std"], dtype=float)
    X = np.asarray(model["train_matrix"], dtype=float)

    xs = (vector - mean) / std
    train_xs = (X - mean) / std

    delta = train_xs - xs
    distances = np.sqrt(np.sum(delta * delta, axis=1))
    nearest = float(np.min(distances))

    p75 = model["nn_thresholds"]["p75"]
    p95 = model["nn_thresholds"]["p95"]

    if nearest <= p75:
        level = "HIGH"
    elif nearest <= p95:
        level = "MEDIUM"
    else:
        level = "LOW"

    return {
        "level": level,
        "nearest_distance": nearest,
        "reference_p75": p75,
        "reference_p95": p95,
    }


def scenario_meta(experiment):
    model = _model()
    row = _row_for_experiment(model, experiment)

    current_values = {}
    parameters = []

    for sensor, key in model["usable"]:
        current = _finite(row.get(key))
        if current is None:
            current = model["medians"][key]

        rg = model["ranges"][key]

        slider_lo = min(rg["q05"], current)
        slider_hi = max(rg["q95"], current)

        if slider_hi <= slider_lo:
            slider_lo, slider_hi = rg["min"], rg["max"]

        current_values[key] = current

        parameters.append({
            "sensor": sensor,
            "key": key,
            "current": float(current),
            "observed_q05": rg["q05"],
            "observed_q95": rg["q95"],
            "observed_min": rg["min"],
            "observed_max": rg["max"],
            "slider_min": float(slider_lo),
            "slider_max": float(slider_hi),
            "step": rg["step"],
        })

    baseline_vector = _vector(model, current_values)
    baseline_prediction = _predict(model, baseline_vector)
    similarity = _similarity(model, baseline_vector)
    measured = model["targets"].get(experiment)

    val = model["validation"]

    return {
        "experiment": experiment,
        "mode": "process_state_what_if",
        "baseline_prediction_um": baseline_prediction,
        "measured_mean_um": measured,
        "reference_data_median_um": model["reference_data_median"],
        "default_tolerance_pct": 10.0,
        "parameters": parameters,
        "baseline_similarity": similarity,
        "validation": {
            "method": "fixed-panel leave-one-lot-out",
            "n": val["n"],
            "rmse_um": val["rmse"],
            "mae_um": val["mae"],
            "p90_abs_error_um": val["p90_abs_error"],
        },
        "model": {
            "name": "Exploratory Process-State Ridge",
            "training_cohort": "Lots 1–9",
            "training_wafers": model["train_n"],
            "feature_count": len(model["usable"]),
            "process_source": model["process_source"],
        },
        "warnings": model["warnings"],
        "notice": (
            "이 화면은 Recipe Predictor가 아닙니다. "
            "여러 recipe를 바꾼 DOE가 없기 때문에, nominal BOSCH 공정에서 실제로 관측된 "
            "Process 상태 범위 안의 exploratory what-if만 제공합니다."
        ),
    }


def predict_scenario(payload):
    experiment = str(payload.get("experiment", "")).strip()
    if not experiment:
        raise ValueError("experiment is required")

    model = _model()
    row = _row_for_experiment(model, experiment)

    baseline_values = {}

    for _, key in model["usable"]:
        v = _finite(row.get(key))
        baseline_values[key] = model["medians"][key] if v is None else v

    requested = payload.get("values") or {}
    scenario_values = dict(baseline_values)

    for _, key in model["usable"]:
        if key in requested:
            v = _finite(requested.get(key))
            if v is not None:
                scenario_values[key] = v

    baseline_vector = _vector(model, baseline_values)
    scenario_vector = _vector(model, scenario_values)

    baseline_pred = _predict(model, baseline_vector)
    scenario_pred = _predict(model, scenario_vector)

    target = _finite(payload.get("target_etch_um"))

    tolerance_pct = _finite(payload.get("tolerance_pct"))
    if tolerance_pct is None:
        tolerance_pct = 10.0
    tolerance_pct = max(0.0, tolerance_pct)

    target_low = target_high = target_delta = target_delta_pct = None
    within_target = None

    if target is not None:
        target_low = target * (1.0 - tolerance_pct / 100.0)
        target_high = target * (1.0 + tolerance_pct / 100.0)
        target_delta = scenario_pred - target
        target_delta_pct = (
            100.0 * target_delta / abs(target)
            if abs(target) > 1e-12
            else None
        )
        within_target = target_low <= scenario_pred <= target_high

    outside = []
    parameter_rows = []

    for sensor, key in model["usable"]:
        value = scenario_values[key]
        rg = model["ranges"][key]
        inside = rg["q05"] <= value <= rg["q95"]

        if not inside:
            outside.append(sensor)

        parameter_rows.append({
            "sensor": sensor,
            "key": key,
            "baseline": baseline_values[key],
            "scenario": value,
            "delta": value - baseline_values[key],
            "inside_observed_q05_q95": inside,
        })

    similarity = _similarity(model, scenario_vector)
    val = model["validation"]

    p90 = val["p90_abs_error"]

    return {
        "experiment": experiment,
        "baseline_prediction_um": baseline_pred,
        "scenario_prediction_um": scenario_pred,
        "model_expected_change_um": scenario_pred - baseline_pred,
        "target_etch_um": target,
        "tolerance_pct": tolerance_pct,
        "target_low_um": target_low,
        "target_high_um": target_high,
        "target_delta_um": target_delta,
        "target_delta_pct": target_delta_pct,
        "within_target_tolerance": within_target,
        "outside_observed_parameters": outside,
        "extrapolation_count": len(outside),
        "similarity": similarity,
        "empirical_p90_error_um": p90,
        "empirical_prediction_low_um": (
            scenario_pred - p90 if p90 is not None else None
        ),
        "empirical_prediction_high_um": (
            scenario_pred + p90 if p90 is not None else None
        ),
        "parameters": parameter_rows,
        "notice": (
            "모델상 예상 변화는 관측 데이터의 연관성에 기반한 what-if 결과이며 "
            "개별 Process parameter의 인과 효과를 의미하지 않습니다."
        ),
    }
