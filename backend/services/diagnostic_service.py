from __future__ import annotations
from functools import lru_cache

from . import measurement_service as ms
from . import nc_service as ns


@lru_cache(maxsize=4096)
def integrated_evidence(experiment, x, y):
    diagnosis = ms.diagnose_point(experiment, x, y)
    p = diagnosis["point"]

    spatial_score = min(6.0, abs(p.get("shape_robust_z") or 0.0))
    measurement_score = max([abs(v or 0.0) for v in (p.get("metric_z") or {}).values()], default=0.0)
    if p.get("postox_imputed"):
        measurement_score = max(measurement_score, 2.5)
    measurement_score = min(6.0, measurement_score)

    process = ns.process_evidence(experiment)
    oes = ns.oes_evidence(experiment)

    sources = {
        "spatial_pattern": {"available": True, "score": spatial_score},
        "process_deviation": process,
        "oes_deviation": oes,
        "measurement_quality": {"available": True, "score": measurement_score},
    }

    usable = {k:max(.05,float(v.get("score") or 0.0)) for k,v in sources.items() if v.get("available")}
    total = sum(usable.values())
    shares = {k:100*v/total for k,v in usable.items()} if total else {}

    suspects = []
    if diagnosis["status"] != "NORMAL":
        suspects.append({"kind":"spatial","label":diagnosis["headline"],"strength":spatial_score})
    if process.get("available") and process.get("top_features"):
        top = process["top_features"][0]
        suspects.append({
            "kind":"process",
            "label":f"{top['sensor']} · {top['stat']} deviation",
            "strength":float(top.get("abs_z") or abs(top.get("robust_z") or 0)),
        })
    if oes.get("available") and oes.get("top_features"):
        top = oes["top_features"][0]
        suspects.append({
            "kind":"oes",
            "label":f"{float(top['actual_wavelength_nm']):.2f} nm · {top['stat']} deviation",
            "strength":float(top.get("abs_z") or abs(top.get("robust_z") or 0)),
        })
    if measurement_score >= 3:
        suspects.append({"kind":"measurement","label":"Same-XY metrology discordance / interpolation evidence","strength":measurement_score})
    suspects.sort(key=lambda x:x["strength"], reverse=True)

    return {
        "experiment": experiment, "diagnosis": diagnosis,
        "relative_evidence_pct": shares, "sources": sources,
        "primary_suspect": suspects[0] if suspects else None,
        "suspects": suspects[:4],
        "disclaimer": "These are normalized review-evidence shares, not calibrated causal probabilities.",
    }
