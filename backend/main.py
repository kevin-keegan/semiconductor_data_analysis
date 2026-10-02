from __future__ import annotations

from pathlib import Path
import time

from fastapi import FastAPI, HTTPException, Query
from fastapi import UploadFile, File, Form
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.services import measurement_service as ms
from backend.services import nc_service as ns
from backend.services import diagnostic_service as ds
from backend.services import prediction_service as ps
from backend.services import cache_service as cs
from backend.services import hierarchical_prediction_service as hs

from backend.services import competition_metadata_service as cmd
from backend.services import competition_model_service as cmv

from backend.services import data_studio_service as dss
from backend.services import root_cause_service as rcs
from backend.services import scenario_service as scs

BASE_DIR=Path(__file__).resolve().parents[1]
FRONTEND=BASE_DIR/"frontend"

app=FastAPI(title="BOSCH Etch Intelligence",version="1.0.1")
app.add_middleware(GZipMiddleware,minimum_size=700)

@app.middleware("http")
async def cache_headers(request,call_next):
    r=await call_next(request)
    if request.url.path=="/" or request.url.path.startswith("/static/"):
        r.headers["Cache-Control"]="no-store, max-age=0"
    return r

def safe(fn):
    try:return fn()
    except HTTPException:raise
    except FileNotFoundError as e:raise HTTPException(424,str(e))
    except KeyError as e:raise HTTPException(404,str(e))
    except Exception as e:raise HTTPException(500,f"{type(e).__name__}: {e}")

@app.get("/api/health")
def health():
    return {"status":"ok","version":"1.0.1","cache":cs.manifest(),"process":ns.process_status(),"oes":ns.oes_status()}

@app.get("/api/overview")
def overview():
    return safe(lambda:{"dataset":ms.dataset_summary(),"lots":ms.lot_summary(),"process":ns.process_status(),"oes":ns.oes_status(),"cache":cs.manifest(),"reference":ps.reference_model()})

@app.get("/api/system/selftest")
def selftest():
    checks=[]
    def run(name,fn):
        t=time.perf_counter()
        try:d=fn();checks.append({"name":name,"ok":True,"detail":d,"ms":round((time.perf_counter()-t)*1000,1)})
        except Exception as e:checks.append({"name":name,"ok":False,"detail":str(e),"ms":round((time.perf_counter()-t)*1000,1)})
    run("fast_cache",lambda:cs.manifest())
    run("measurement",lambda:ms.dataset_summary())
    exp=ms.experiments()[0]
    run("wafer_89",lambda:{"points":len(ms.wafer_detail(exp)["points"])})
    run("process_cache",lambda:{"fast_sensors":len(ns.process_meta(exp).get("fast_sensors",[]))})
    run("oes_cache",lambda:{"cached_wavelengths":len(ns.oes_meta(exp).get("cached_wavelengths",[]))})
    run("diagnostics",lambda:ds.integrated_evidence(exp,ms.wafer_detail(exp)["points"][0]["x"],ms.wafer_detail(exp)["points"][0]["y"])["diagnosis"]["status"])
    return {"ok":all(x["ok"] for x in checks),"checks":checks}


@app.get("/api/summary/wafers")
def wafer_summaries():
    return safe(lambda:{"wafers":ms.load_dataset()["summaries"]})

@app.get("/api/context/{experiment}")
def experiment_context(experiment: str):
    def build():
        summaries = ms.load_dataset()["summaries"]
        selected = next((dict(s) for s in summaries if s["experiment"] == experiment), None)
        if selected is None:
            raise KeyError(experiment)

        dates = sorted({s.get("date") or s["experiment"].rsplit("_", 1)[0] for s in summaries})
        date = selected.get("date") or experiment.rsplit("_", 1)[0]
        lot = dates.index(date) + 1
        wafer = selected.get("wafer")
        if wafer is None:
            wafer = int(experiment.rsplit("_", 1)[1])

        lot_wafers = []
        for s in summaries:
            s_date = s.get("date") or s["experiment"].rsplit("_", 1)[0]
            if s_date == date:
                row = dict(s)
                row["canonical_lot"] = lot
                if row.get("wafer") is None:
                    row["wafer"] = int(row["experiment"].rsplit("_", 1)[1])
                lot_wafers.append(row)
        lot_wafers.sort(key=lambda x: x.get("wafer") or 0)

        selected["canonical_lot"] = lot
        return {
            "experiment": experiment,
            "date": date,
            "lot": lot,
            "wafer": int(wafer),
            "selected": selected,
            "lot_wafers": lot_wafers,
        }
    return safe(build)

@app.get("/api/wafer/experiments")
def experiments():return {"experiments":ms.experiments()}

@app.get("/api/wafer/{experiment}")
def wafer(experiment:str):return safe(lambda:ms.wafer_detail(experiment))

@app.get("/api/diagnostics/anomalies")
def anomalies(limit:int=Query(30,ge=1,le=200)):return safe(lambda:{"rows":ms.anomaly_table(limit)})

@app.get("/api/diagnostics/{experiment}/point")
def point(experiment:str,x:float,y:float):return safe(lambda:ds.integrated_evidence(experiment,x,y))

@app.get("/api/process/{experiment}/meta")
def pmeta(experiment:str):return safe(lambda:ns.process_meta(experiment))

@app.get("/api/process/{experiment}/trace")
def ptrace(experiment:str,sensor:str):return safe(lambda:ns.process_trace(experiment,sensor))

@app.get("/api/oes/{experiment}/meta")
def ometa(experiment:str):return safe(lambda:ns.oes_meta(experiment))

@app.get("/api/oes/{experiment}/trace")
def otrace(experiment:str,wavelength_nm:float):return safe(lambda:ns.oes_trace(experiment,wavelength_nm))

@app.get("/api/oes/{experiment}/spectrum")
def ospectrum(experiment:str,fraction:float=Query(.5,ge=0,le=1)):return safe(lambda:ns.oes_spectrum(experiment,fraction))

@app.get("/api/prediction/evaluate")
def peval():return safe(ps.live_evaluation)

@app.get("/api/prediction/{experiment}")
def pone(experiment:str):return safe(lambda:ps.prediction_for(experiment))

@app.get("/api/hierarchical/metrics")
def hierarchical_metrics():
    return safe(hs.metrics)

@app.get("/api/hierarchical/{experiment}")
def hierarchical_prediction(experiment: str):
    return safe(lambda: hs.prediction(experiment))

@app.get("/api/v1/context/{experiment}")
def competition_context(experiment: str):
    return cmd.experiment_context(experiment)

@app.get("/api/v1/model/metrics")
def competition_metrics():
    return cmv.metrics()

@app.get("/api/v1/model/{experiment}")
def competition_prediction(experiment: str):
    return cmv.prediction(experiment)

@app.post("/api/data-studio/inspect")
async def data_studio_inspect(file: UploadFile = File(...)):
    try:
        content = await file.read()
        return dss.inspect_upload(file.filename or "upload.csv", content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/data-studio/analyze")
async def data_studio_analyze(file: UploadFile = File(...), mapping_json: str = Form("{}")):
    try:
        content = await file.read()
        return dss.analyze_upload(file.filename or "upload.csv", content, mapping_json)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/root-cause/{experiment}")
def root_cause_v1(experiment: str, include_oes: bool = False):
    try:
        return rcs.root_cause_evidence(experiment, include_oes=include_oes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/scenario/{experiment}")
def scenario_meta_v1(experiment: str):
    try:
        return scs.scenario_meta(experiment)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/scenario/predict")
def scenario_predict_v1(payload: dict):
    try:
        return scs.predict_scenario(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.mount("/static",StaticFiles(directory=FRONTEND),name="static")
@app.get("/")
def index():return FileResponse(FRONTEND/"index.html")
