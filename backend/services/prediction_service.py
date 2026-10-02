from __future__ import annotations
from . import cache_service as cs


REFERENCE = {
    "target":"global mean Si etch",
    "model":"Previously validated active-sensor model",
    "validation":"OOF / nested LOLO reference",
    "n":84, "mae_um":0.1315, "rmse_um":0.1716, "p90_abs_error_um":0.2904,
    "note":"Reference metrics from prior analysis; operational predictions below use the v0.7 fast-cache rebuild."
}


def reference_model():
    return REFERENCE


def live_evaluation():
    p = cs.prediction_payload()
    if not p:
        raise FileNotFoundError("Prediction cache missing. Run BUILD_FAST_CACHE.py.")
    return p


def prediction_for(experiment):
    p = live_evaluation()
    row = p.get("operational_predictions", {}).get(experiment)
    if not row:
        raise KeyError(experiment)
    return row
