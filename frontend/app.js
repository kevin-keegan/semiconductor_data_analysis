import {fmt,esc,lineChart,table} from "./charts.js?v=1.0.1";

const $=id=>document.getElementById(id);
const S={page:"overview",exp:null,experiments:[],vmMode:"operational",selectedPointByExp:{}};
const C=new Map(),F=new Map();
let dataStudioCurrentFile=null;
let dataStudioInspection=null;

async function inspectDataStudioFile(file){
 dataStudioCurrentFile=file;
 const w=$("dataStudioWorkspace");
 w.innerHTML=`<div class="panel">${box(`<strong>Inspecting ${esc(file.name)}</strong><br>Detecting schema and data quality…`,"ok")}</div>`;
 try{
  const fd=new FormData();fd.append("file",file);
  const r=await fetch("/api/data-studio/inspect",{method:"POST",body:fd}),d=await r.json();
  if(!r.ok)throw new Error(d.detail||`HTTP ${r.status}`);
  dataStudioInspection=d;renderDataStudioMapping(d);
 }catch(e){w.innerHTML=`<div class="panel">${box(`<strong>Upload failed</strong><br>${esc(e.message)}`,"bad")}</div>`}
}

function mappingSelect(role,label,columns,value){
 const opts=[`<option value="">— not mapped —</option>`].concat(columns.map(c=>`<option value="${esc(c)}" ${c===value?"selected":""}>${esc(c)}</option>`));
 return `<label><span>${esc(label)}</span><select data-map-role="${role}">${opts.join("")}</select></label>`;
}

function renderDataStudioMapping(d){
 const m=d.suggested_mapping||{},cols=d.columns||[];
 $("dataStudioWorkspace").innerHTML=`
 <div class="cards compact-kpis">
  ${card("Rows",d.rows.toLocaleString())}${card("Columns",d.columns_count)}
  ${card("Missing cells",d.missing_cells.toLocaleString(),"",`${fmt(d.missing_pct,2)}%`)}
  ${card("Duplicate rows",d.duplicate_rows)}
 </div>
 <div class="grid2 data-map-grid">
  <div class="panel"><span class="eyebrow">AUTO SCHEMA</span><h2>Confirm column mapping</h2>
   <div class="mapping-grid">
    ${mappingSelect("experiment","Experiment / wafer key",cols,m.experiment)}
    ${mappingSelect("lot","Lot",cols,m.lot)}
    ${mappingSelect("wafer","Wafer number",cols,m.wafer)}
    ${mappingSelect("date","Date",cols,m.date)}
    ${mappingSelect("x","X coordinate",cols,m.x)}
    ${mappingSelect("y","Y coordinate",cols,m.y)}
    ${mappingSelect("etch","Etch depth",cols,m.etch)}
    ${mappingSelect("preox","Pre-oxide",cols,m.preox)}
    ${mappingSelect("postox","Post-oxide",cols,m.postox)}
    ${mappingSelect("stepheight","Step height",cols,m.stepheight)}
   </div>
   <button class="primary-action" id="runUploadedAnalysis">Run analysis</button>
  </div>
  <div class="panel"><span class="eyebrow">FILE PREVIEW</span><h2>${esc(d.filename)}</h2>
   ${table(d.preview||[],(d.columns||[]).slice(0,8).map(c=>({label:c,key:c})))}
   <div class="reason">Correct any auto-mapped field before running the analysis.</div>
  </div>
 </div>`;
 $("runUploadedAnalysis").onclick=runDataStudioAnalysis;
}

async function runDataStudioAnalysis(){
 if(!dataStudioCurrentFile)return;
 const mapping={};document.querySelectorAll("[data-map-role]").forEach(el=>mapping[el.dataset.mapRole]=el.value||null);
 $("dataStudioWorkspace").innerHTML=`<div class="panel">${box("<strong>Running analysis</strong><br>QA, wafer statistics, spatial review and driver evidence…","ok")}</div>`;
 try{
  const fd=new FormData();fd.append("file",dataStudioCurrentFile);fd.append("mapping_json",JSON.stringify(mapping));
  const r=await fetch("/api/data-studio/analyze",{method:"POST",body:fd}),d=await r.json();
  if(!r.ok)throw new Error(d.detail||`HTTP ${r.status}`);
  renderDataStudioResults(d);
 }catch(e){$("dataStudioWorkspace").innerHTML=`<div class="panel">${box(`<strong>Analysis failed</strong><br>${esc(e.message)}`,"bad")}</div>`}
}

function capabilityChip(name,on){return `<span class="cap-chip ${on?"on":"off"}">${on?"✓":"—"} ${esc(name)}</span>`}

function renderDataStudioResults(d){
 const q=d.qa||{},cap=d.capabilities||{},drivers=d.driver_candidates||[],an=d.spatial_anomalies||[];
 $("dataStudioWorkspace").innerHTML=`
 <div class="panel result-banner"><div><span class="eyebrow">ANALYSIS STATUS</span><h2>${esc(d.status)}</h2><p>${esc(d.filename)}</p></div><button class="secondary-action" id="changeUpload">Analyze another file</button></div>
 <div class="cards compact-kpis">${card("Rows",(q.rows??0).toLocaleString())}${card("Detected wafers",q.wafers??0)}${card("Median points / wafer",fmt(q.points_per_wafer_median,0))}${card("Missing cells",fmt(q.missing_pct,2),"%")}</div>
 <div class="panel compact-panel capability-panel"><span class="eyebrow">AVAILABLE ANALYSIS</span><div class="cap-row">
  ${capabilityChip("Wafer statistics",cap.wafer_statistics)}${capabilityChip("Spatial map",cap.spatial_map)}
  ${capabilityChip("Spatial review",cap.spatial_review)}${capabilityChip("Driver screening",cap.driver_screening)}
  ${capabilityChip("Process evidence",cap.process_root_cause)}${capabilityChip("OES evidence",cap.oes_evidence)}
 </div></div>
 <div class="grid2 uploaded-analysis-grid">
  <div class="panel"><span class="eyebrow">WAFER SUMMARY</span><h2>Uniformity / variation</h2>
   ${table((d.wafer_summaries||[]).slice(0,20),[
    {label:"Wafer",key:"experiment"},{label:"Points",key:"n_points"},
    {label:"Mean",value:r=>fmt(r.mean_um,3)},{label:"CV %",value:r=>fmt(r.cv_pct,2)},
    {label:"P95-P05",value:r=>fmt(r.p95_p05_um,3)}])}
  </div>
  <div class="panel"><span class="eyebrow">SPATIAL REVIEW</span><h2>${d.focus_wafer?esc(d.focus_wafer):"No map available"}</h2>
   ${d.focus_points?.length?`<div class="wafer-wrap uploaded-map">${mapSvg(d.focus_points,"etch")}</div>`:box("X / Y / Etch mapping is required.")}
  </div>
 </div>
 <div class="grid2" style="margin-top:10px">
  <div class="panel"><span class="eyebrow">TOP REVIEW POINTS</span><h2>Same-coordinate robust deviation</h2>
   ${an.length?table(an.slice(0,20),[
    {label:"Wafer",key:"experiment"},{label:"X",value:r=>fmt(r.x,0)},{label:"Y",value:r=>fmt(r.y,0)},
    {label:"Etch",value:r=>fmt(r.etch_um,3)},{label:"z",value:r=>fmt(r.robust_z,2)},{label:"Status",key:"status"}]):box("Not enough comparable wafers / coordinates.")}
  </div>
  <div class="panel"><span class="eyebrow">DRIVER EVIDENCE</span><h2>Numeric features associated with wafer mean etch</h2>
   ${drivers.length?drivers.slice(0,10).map((x,i)=>`<div class="driver-row"><span><b>${i+1}</b>${esc(x.feature)}</span><strong>ρ ${fmt(x.spearman_rho,3)}</strong></div>`).join(""):box("No additional numeric features were suitable for driver screening.")}
   <div class="reason">Association is for investigation prioritization only. It is not causal attribution.</div>
  </div>
 </div>
 <div class="panel compact-panel notes-panel" style="margin-top:10px"><span class="eyebrow">ANALYSIS NOTES</span>${(d.notes||[]).map(x=>`<div class="reason">${esc(x)}</div>`).join("")}</div>`;
 $("changeUpload").onclick=()=>renderDataStudio();
}

const meta={
 overview:["BOSCH ETCH INTELLIGENCE","Overview","Nominal recipe reference + wafer-state correction + spatial correction"],
 vm:["VIRTUAL METROLOGY","Virtual Metrology","Operational simulation or strict historical backtest"],
 scenario:["PROCESS-STATE WHAT-IF","공정 조건 시나리오","Nominal BOSCH 범위 내 공정 상태 시뮬레이션"],
 datastudio:["DATA STUDIO","Data Studio","Upload CSV/XLSX → schema QA → wafer analysis → review evidence"],
 wafer:["SPATIAL METROLOGY","Wafer Analysis","Measured 89-point map and point inspection"],
 process:["PROCESS TRACE","Process","Full-process sensor evidence · post-process / pre-metrology VM"],
 oes:["OPTICAL EMISSION SPECTROSCOPY","OES","Exploratory candidate wavelengths and cached traces"],
 diagnostics:["DIAGNOSTICS","Diagnostics","Continuous anomaly intensity + categorical review boundary"],
 validation:["MODEL GOVERNANCE","Validation","Cohort separation, nested LOLO, spatial baselines, early VM and limitations"]
};
async function api(path){if(C.has(path))return C.get(path);if(F.has(path))return F.get(path);const p=(async()=>{const r=await fetch(path,{cache:"no-store"});let b={};try{b=await r.json()}catch{}if(!r.ok)throw new Error(b.detail||`HTTP ${r.status}`);C.set(path,b);return b})();F.set(path,p);try{return await p}finally{F.delete(path)}}
const loading=v=>$("loading").classList.toggle("hidden",!v);
const card=(l,v,u="",n="")=>`<div class="card"><span>${l}</span><b>${v}</b><small>${u}</small>${n?`<div class="eyebrow" style="margin-top:7px">${n}</div>`:""}</div>`;
const box=(h,c="")=>`<div class="status ${c}">${h}</div>`;
const ctx=()=>api(`/api/v1/context/${encodeURIComponent(S.exp)}`);
const pred=()=>api(`/api/v1/model/${encodeURIComponent(S.exp)}`);
const wafer=()=>api(`/api/wafer/${encodeURIComponent(S.exp)}`);

function setPage(p){S.page=p;document.querySelectorAll(".page").forEach(x=>x.classList.remove("active"));$(`page-${p}`).classList.add("active");document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.page===p));const m=meta[p];$("eyebrow").textContent=m[0];$("title").textContent=m[1];$("subtitle").textContent=m[2];render()}
document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>setPage(b.dataset.page));

async function init(){
 try{
  const h=await api("/api/health"),ex=await api("/api/wafer/experiments");
  S.experiments=ex.experiments;S.exp=S.experiments[0];
  $("apiDot").classList.add("ok");$("apiText").textContent=`API ${h.version} · Competition v1`;
  $("waferSelect").innerHTML=S.experiments.map(x=>`<option>${esc(x)}</option>`).join("");$("waferSelect").value=S.exp;
  $("waferSelect").onchange=async e=>{S.exp=e.target.value;$("preload").textContent="updating…";await render();try{const c=await ctx();$("preload").textContent=`L${c.lot} · W${String(c.wafer).padStart(2,"0")} · ${c.type_raw||"metadata"}`}catch{$("preload").textContent="ready"}};
  const c=await ctx();$("preload").textContent=`L${c.lot} · W${String(c.wafer).padStart(2,"0")} · ${c.type_raw||"metadata"}`;
  await render();
 }catch(e){$("apiText").textContent="API ERROR";$("page-overview").innerHTML=box(`<strong>Startup failed</strong><br>${esc(e.message)}`,"bad")}
}

function mapColor(v,min,max){
 const t0=max>min?(Number(v)-Number(min))/(Number(max)-Number(min)):.5;
 const t=Math.max(0,Math.min(1,t0));
 const a=[38,92,137],b=[226,239,248];
 return `rgb(${a.map((x,i)=>Math.round(x+(b[i]-x)*t)).join(",")})`;
}

function errColor(v,maxAbs){
 const t=Math.min(1,Math.abs(Number(v))/(Number(maxAbs)||1));
 return Number(v)>=0
  ? `rgb(${Math.round(244-15*t)},${Math.round(225-110*t)},${Math.round(225-110*t)})`
  : `rgb(${Math.round(225-105*t)},${Math.round(235-70*t)},${Math.round(246-20*t)})`;
}

function mapSvg(points,key,{min=null,max=null,diverging=false,uncertainty=false,id=null}={}){
 const vals=(points||[]).map(p=>Number(p[key])).filter(Number.isFinite);
 if(!vals.length)return'<div class="empty">No map data</div>';

 if(min==null)min=Math.min(...vals);
 if(max==null)max=Math.max(...vals);
 const maxAbs=Math.max(...vals.map(Math.abs),1e-9);

 return `<svg ${id?`id="${id}"`:""} class="wafer-svg" viewBox="-120 -120 240 240">
   <circle class="wafer-bg" r="104"/>
   <line class="wafer-axis" x1="-108" x2="108"/>
   <line class="wafer-axis" y1="-108" y2="108"/>
   ${(points||[]).map((p,i)=>{
      const v=Number(p[key]);
      const fill=diverging?errColor(v,maxAbs):mapColor(v,min,max);
      return `<circle data-i="${i}" class="wafer-point" cx="${p.x}" cy="${-p.y}" r="4.25" fill="${fill}">
        <title>X ${p.x} Y ${p.y} / ${key} ${fmt(v,3)}</title>
      </circle>`;
   }).join("")}
 </svg>`;
}

function scaleBar(min,max,label){
 return `<div class="color-scale">
   <span>${fmt(min,2)}</span>
   <i></i>
   <span>${fmt(max,2)}</span>
   <b>${esc(label)}</b>
 </div>`;
}

function diagSvg(points){
 const vals=points.map(p=>Math.abs(Number(p.shape_robust_z||0)));const maxz=Math.max(...vals,1);
 return `<svg id="diagMap" class="wafer-svg" viewBox="-120 -120 240 240"><circle class="wafer-bg" r="104"/><line class="wafer-axis" x1="-108" x2="108"/><line class="wafer-axis" y1="-108" y2="108"/>${points.map((p,i)=>{const z=Math.abs(Number(p.shape_robust_z||0)),t=Math.min(1,z/Math.max(6,maxz)),fill=`rgb(${Math.round(142+75*t)},${Math.round(153-58*t)},${Math.round(166-65*t)})`,stroke=z>=6?"#bd4040":z>=4?"#c78a1d":"#6f7d8d",sw=z>=4?2.5:1.2;return`<circle data-i="${i}" class="wafer-point" cx="${p.x}" cy="${-p.y}" r="4.4" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"><title>|shape z| ${fmt(z,2)} · ${esc(p.point_status||"")}</title></circle>`}).join("")}</svg>`;
}
const diagLegend=()=>`<div class="map-legend"><span><i class="legend-outline normal-o"></i>NORMAL border</span><span><i class="legend-outline review-o"></i>REVIEW ≥4</span><span><i class="legend-outline strong-o"></i>STRONG ≥6</span><span>fill intensity = continuous |shape z|</span><span><i class="legend-ring"></i>selected</span></div>`;

async function renderOverview(){
 const w=await wafer();
 const s=w.summary||{};
 const points=w.points||[];

 const meanEtch=Number.isFinite(Number(s.mean))
   ? Number(s.mean)
   : (points.length
      ? points.reduce((a,p)=>a+Number(p.etch||0),0)/points.length
      : NaN);

 const maxI=points.reduce((best,p,i)=>{
   const z=Math.abs(Number(p.shape_robust_z||0));
   const bz=Math.abs(Number(points[best]?.shape_robust_z||0));
   return z>bz?i:best;
 },0);

 const maxPoint=points[maxI]||{};
 const reviewCount=Number(s.flagged_z4||0);
 const strongCount=Number(s.flagged_z6||0);

 const finalJudgement=
   strongCount>0 ? "우선 점검 필요" :
   reviewCount>0 ? "검토 필요" :
   "정상 범위";

 const finalNote=
   strongCount>0 ? `${strongCount}개 측정점 |z| ≥ 6` :
   reviewCount>0 ? `${reviewCount}개 측정점 |z| ≥ 4` :
   "공간 이상 기준 미만";

 $("page-overview").innerHTML=`
 <div class="cards compact-kpis">
   ${card("측정 평균 Si 식각",fmt(meanEtch,3),"um","89-point 실측 평균")}
   ${card("최종 판단",finalJudgement,"",finalNote)}
   ${card("최대 |shape z|",fmt(s.max_shape_z,2),"",`X ${fmt(maxPoint.x,0)} · Y ${fmt(maxPoint.y,0)}`)}
   ${card("검토 포인트",reviewCount,"개",`강한 이상 ${strongCount}개`)}
 </div>

 <div class="overview-diagnostic-grid">
   <div class="panel">
     <div class="panel-head">
       <div>
         <span class="eyebrow">EPA · WAFER DIAGNOSTICS</span>
         <h2>선택 웨이퍼 공간 이상 요약</h2>
       </div>
       <span class="badge">${esc(S.exp)}</span>
     </div>
     ${diagLegend()}
     <div class="wafer-wrap compact-map overview-diag-map">${diagSvg(points)}</div>
   </div>

   <div class="panel overview-root-panel">
     <div class="panel-head">
       <div>
         <span class="eyebrow">EPA · ROOT CAUSE SUMMARY</span>
         <h2>원인 후보 요약</h2>
       </div>
     </div>

     <div class="overview-max-point">
       <span>가장 큰 공간 편차</span>
       <b>X ${fmt(maxPoint.x,0)} · Y ${fmt(maxPoint.y,0)} mm</b>
       <small>측정 ${fmt(maxPoint.etch,4)} um · shape z ${fmt(maxPoint.shape_robust_z,2)}</small>
     </div>

     <div class="overview-primary-cause">
       <span>주요 검토 후보</span>
       <b id="overviewPrimaryCause">분석 중...</b>
     </div>

     <div id="overviewRootCause">
       <div class="rc-loading">Process 원인 후보 불러오는 중...</div>
     </div>

     <div class="overview-actions">
       <button class="primary-action" id="overviewGoDiagnostics">진단 상세 보기</button>
       <button class="secondary-action" id="overviewGoScenario">공정 조건 시나리오</button>
     </div>
   </div>
 </div>

 <div class="overview-note">
   <strong>EPA 개요</strong>
   <span>선택 웨이퍼의 실측 결과 → 공간 이상 → 원인 후보 → 상세 진단으로 이어지는 요약 화면입니다.</span>
 </div>`;

 $("overviewGoDiagnostics").onclick=()=>{
   document.querySelector('.nav[data-page="diagnostics"]')?.click();
 };

 $("overviewGoScenario").onclick=()=>{
   document.querySelector('.nav[data-page="scenario"]')?.click();
 };

 api(`/api/v1/root-cause/${encodeURIComponent(S.exp)}?include_oes=false`)
   .then(d=>{
      const rows=(d.process_candidates||d.combined_candidates||[]).slice(0,3);
      const primary=$("overviewPrimaryCause");
      const el=$("overviewRootCause");

      if(primary){
        primary.textContent=rows.length ? rows[0].parameter : "뚜렷한 Process 후보 없음";
      }

      if(!el)return;

      el.innerHTML=rows.length
        ? `<div class="overview-cause-list">${rows.map((x,i)=>`
            <div class="overview-cause-item">
              <span>${i+1}</span>
              <div>
                <b>${esc(x.parameter)}</b>
                <small>${esc(x.statistic_label||"")} · robust z ${fmt(x.robust_z,2)}</small>
              </div>
              <em class="${String(x.level||"").toLowerCase()}">${x.level==="HIGH"?"높음":x.level==="MEDIUM"?"중간":"낮음"}</em>
            </div>`).join("")}</div>`
        : box("표시할 Process 원인 후보가 없습니다.");
   })
   .catch(e=>{
      const primary=$("overviewPrimaryCause");
      const el=$("overviewRootCause");
      if(primary)primary.textContent="분석 실패";
      if(el)el.innerHTML=box(`원인 후보 요약을 불러오지 못했습니다.<br>${esc(e.message)}`,"bad");
   });
}

async function renderVM(){
 const [p,m]=await Promise.all([pred(),api("/api/v1/model/metrics")]);
 const all=[...p.points.map(x=>x.predicted_etch_um),...p.points.map(x=>x.actual_etch_um)].map(Number),sharedMin=Math.min(...all),sharedMax=Math.max(...all);
 const uncMin=Math.min(...p.points.map(x=>Number(x.spatial_p90_um))),uncMax=Math.max(...p.points.map(x=>Number(x.spatial_p90_um)));
 const modebar=`<div class="mode-toggle"><button id="modeOperational" class="${S.vmMode==="operational"?"active":""}">OPERATIONAL</button><button id="modeBacktest" class="${S.vmMode==="backtest"?"active":""}">BACKTEST</button></div>`;
 let body="";
 if(S.vmMode==="operational"){
  body=`<div class="grid2 equal"><div class="panel"><span class="eyebrow">PREDICTED</span><h2>89-point virtual map</h2><div class="wafer-wrap">${mapSvg(p.points,"predicted_etch_um",{min:sharedMin,max:sharedMax})}</div>${scaleBar(sharedMin,sharedMax,"etch (um)")}</div><div class="panel"><span class="eyebrow">LOCAL OOF UNCERTAINTY</span><h2>Spatial P90 absolute error by coordinate</h2><div class="wafer-wrap">${mapSvg(p.points,"spatial_p90_um",{min:uncMin,max:uncMax})}</div>${scaleBar(uncMin,uncMax,"spatial P90 |error| (um)")}</div></div>`;
 }else{
  body=`<div class="map-triple"><div class="panel"><span class="eyebrow">PREDICTED</span><h2>Virtual map</h2><div class="wafer-wrap mini">${mapSvg(p.points,"predicted_etch_um",{min:sharedMin,max:sharedMax})}</div>${scaleBar(sharedMin,sharedMax,"shared etch scale")}</div><div class="panel"><span class="eyebrow">MEASURED</span><h2>Metrology map</h2><div class="wafer-wrap mini">${mapSvg(p.points,"actual_etch_um",{min:sharedMin,max:sharedMax})}</div>${scaleBar(sharedMin,sharedMax,"shared etch scale")}</div><div class="panel"><span class="eyebrow">ERROR</span><h2>Measured − predicted</h2><div class="wafer-wrap mini">${mapSvg(p.points,"error_um",{diverging:true})}</div></div></div>`;
 }
 $("page-vm").innerHTML=`${modebar}<div class="cards">${card("Predicted mean",fmt(p.predicted_mean_um,3),"um")}${card("Cold Process",fmt(p.cold_process_pred_um,3),"um")}${card("Sequential correction",(p.sequential_correction_um>=0?"+":"")+fmt(p.sequential_correction_um,3),"um")}${card("Prior measured",p.prior_measured_wafers,"wafer(s)",p.stage)}</div><div class="callout"><strong>Operational mode hides measured outcomes.</strong> This is a historical OOF/external-holdout simulation. Backtest mode reveals measured and residual maps for validation. Predicted and measured maps use the same color scale.</div>${body}`;
 $("modeOperational").onclick=()=>{S.vmMode="operational";renderVM()};$("modeBacktest").onclick=()=>{S.vmMode="backtest";renderVM()};
}

/* === ROOT CAUSE STUDIO v1.6 START === */
function rcLevelKo(x){return x==="HIGH"?"높음":x==="MEDIUM"?"중간":"낮음"}
function rcRow(x,i){
 const pct=Number.isFinite(Number(x.delta_pct))?`${Number(x.delta_pct)>=0?"+":""}${fmt(x.delta_pct,1)}%`:"—";
 return `<div class="rc-candidate ${String(x.level||"").toLowerCase()}">
  <div class="rc-rank">${i+1}</div><div class="rc-main">
   <div class="rc-name-line"><strong>${esc(x.parameter)}</strong><span class="rc-source">${esc(x.source)}</span><span class="rc-level ${String(x.level||"").toLowerCase()}">${rcLevelKo(x.level)}</span></div>
   <div class="rc-stat">${esc(x.statistic_label||x.statistic||"")}</div>
   <div class="rc-values"><span>현재 <b>${fmt(x.current,4)}</b></span><span>Lot 기준 <b>${fmt(x.peer_median,4)}</b></span><span>차이 <b>${Number(x.delta)>=0?"+":""}${fmt(x.delta,4)} (${pct})</b></span><span>robust z <b>${fmt(x.robust_z,2)}</b></span></div>
   <div class="rc-strength"><i style="width:${Math.max(2,Number(x.combined_strength_pct??x.relative_strength_pct??0))}%"></i></div>
   <small>${esc(x.hint||"")}</small>
  </div></div>`;
}
function rcHtml(d){
 const rows=d.combined_candidates||d.process_candidates||[];
 return `<div class="rc-header"><div><span class="eyebrow">ROOT CAUSE REVIEW</span><h3>원인 후보 파라미터</h3></div><span class="badge">${d.baseline?.peer_count??0}개 peer</span></div>
 ${rows.length?`<div class="rc-list">${rows.slice(0,8).map(rcRow).join("")}</div>`:box("비교 가능한 Process 파라미터가 없습니다.")}
 ${!d.include_oes?`<button class="rc-oes-button" id="loadRootCauseOes">OES 후보도 함께 분석</button>`:`<div class="rc-oes-loaded">OES 후보 포함 완료</div>`}
 ${(d.warnings||[]).length?`<div class="rc-warning">${d.warnings.map(esc).join("<br>")}</div>`:""}
 <div class="rc-disclaimer">${esc(d.disclaimer||"")}</div>`;
}
async function loadRootCauseStudio(includeOes=false){
 const slot=$("rootCauseStudio"); if(!slot)return;
 slot.innerHTML=`<div class="rc-loading">${includeOes?"Process + OES":"Process"} 원인 후보 계산 중...</div>`;
 try{
  const d=await api(`/api/v1/root-cause/${encodeURIComponent(S.exp)}?include_oes=${includeOes?"true":"false"}`);
  slot.innerHTML=rcHtml(d);
  const b=$("loadRootCauseOes"); if(b)b.onclick=()=>loadRootCauseStudio(true);
 }catch(e){slot.innerHTML=box(`<strong>원인 후보 분석 실패</strong><br>${esc(e.message)}`,"bad")}
}
/* === ROOT CAUSE STUDIO v1.6 END === */

function pointPanel(ev){
 const d=ev.diagnosis,p=d.point;
 return `<div class="point-hero"><div><span class="eyebrow">측정점</span><b>X ${fmt(p.x,0)} · Y ${fmt(p.y,0)} mm</b></div><strong class="point-status">${esc(d.status)}</strong></div>
 <div class="detail-row primary"><span>측정 Si 식각</span><b>${fmt(p.etch,4)} um</b></div>
 <div class="detail-row"><span>동일 XY 기대값</span><b>${fmt(p.expected_etch,4)} um</b></div>
 <div class="detail-row"><span>편차</span><b>${Number(p.deviation_um)>=0?"+":""}${fmt(p.deviation_um,4)} um</b></div>
 <div class="detail-row"><span>공간 형상 z</span><b>${fmt(p.shape_robust_z,2)}</b></div>
 <div class="point-diagnosis-note"><strong>${esc(d.headline)}</strong>${(d.reasons||[]).map(x=>`<span>${esc(x)}</span>`).join("")}</div>`;
}

async function bindPointMap(points,mapSelector,target){
 document.querySelectorAll(`${mapSelector} circle[data-i]`).forEach(c=>c.onclick=async()=>{const i=Number(c.dataset.i),p=points[i];document.querySelectorAll(`${mapSelector} .wafer-point.selected`).forEach(x=>x.classList.remove("selected"));c.classList.add("selected");$(target).innerHTML=box("Loading diagnosis…");try{$(target).innerHTML=pointPanel(await api(`/api/diagnostics/${encodeURIComponent(S.exp)}/point?x=${p.x}&y=${p.y}`))}catch(e){$(target).innerHTML=box(esc(e.message),"bad")}});
}

let EPA_SCENARIO_TIMER_171=null;

function epaScenarioFmt171(v){
 const n=Number(v);
 if(!Number.isFinite(n))return "";
 if(Math.abs(n)>=100)return n.toFixed(3);
 if(Math.abs(n)>=1)return n.toFixed(4);
 return n.toFixed(6);
}

function epaSimilarityKo171(level){
 return level==="HIGH" ? "높음" : level==="MEDIUM" ? "중간" : "낮음";
}

function epaScenarioParam171(p){
 return `
 <div class="scenario-param" data-key="${esc(p.key)}">
   <div class="scenario-param-head">
     <div>
       <strong>${esc(p.sensor)}</strong>
       <span>관측 5–95% · ${fmt(p.observed_q05,4)} ~ ${fmt(p.observed_q95,4)}</span>
     </div>
     <input class="scenario-number" type="number"
       value="${epaScenarioFmt171(p.current)}"
       min="${p.observed_min}" max="${p.observed_max}" step="${p.step}">
   </div>
   <input class="scenario-range" type="range"
     min="${p.slider_min}" max="${p.slider_max}" step="${p.step}" value="${p.current}">
 </div>`;
}

function epaScenarioPayload171(){
 const values={};

 document.querySelectorAll("#scenarioControls .scenario-param").forEach(row=>{
   const key=row.dataset.key;
   const value=Number(row.querySelector(".scenario-number")?.value);
   if(Number.isFinite(value))values[key]=value;
 });

 const rawTarget=$("scenarioTarget")?.value?.trim();
 const target=rawTarget==="" ? null : Number(rawTarget);

 return {
   experiment:S.exp,
   target_etch_um:Number.isFinite(target) ? target : null,
   tolerance_pct:Number($("scenarioTolerance")?.value),
   values
 };
}

function renderEpaScenarioResult171(r){
 const el=$("scenarioResult");
 if(!el)return;

 const change=Number(r.model_expected_change_um);
 const hasTarget=Number.isFinite(Number(r.target_etch_um));
 const similarity=epaSimilarityKo171(r.similarity?.level);

 el.innerHTML=`
 <div class="scenario-result-cards">
   <div>
     <span>현재 조건 모델값</span>
     <b>${fmt(r.baseline_prediction_um,3)} um</b>
   </div>
   <div>
     <span>시나리오 예상 평균</span>
     <b>${fmt(r.scenario_prediction_um,3)} um</b>
   </div>
   <div>
     <span>모델상 예상 변화</span>
     <b>${change>=0?"+":""}${fmt(change,3)} um</b>
   </div>
   <div>
     <span>관측 데이터 유사도</span>
     <b>${similarity}</b>
   </div>
 </div>

 <div class="scenario-uncertainty">
   <span>LOLO 경험적 P90 오차</span>
   <b>${r.empirical_p90_error_um==null?"—":"±"+fmt(r.empirical_p90_error_um,3)+" um"}</b>
   <small>${r.empirical_prediction_low_um==null?"":`${fmt(r.empirical_prediction_low_um,3)} ~ ${fmt(r.empirical_prediction_high_um,3)} um`}</small>
 </div>

 ${hasTarget ? `
   <div class="scenario-target-bar">
     <span class="scenario-status ${r.within_target_tolerance?"good":"warn"}">
       ${r.within_target_tolerance?"목표 허용범위 내":"목표 허용범위 밖"}
     </span>
     <strong>Target ${fmt(r.target_etch_um,3)} um · 허용범위 ${fmt(r.target_low_um,3)} ~ ${fmt(r.target_high_um,3)} um</strong>
   </div>` :
   `<div class="scenario-target-empty">목표 Si etch를 입력하면 목표 대비 판정을 표시합니다.</div>`}

 <div class="scenario-similarity ${String(r.similarity?.level||"").toLowerCase()}">
   <strong>데이터 유사도 ${similarity}</strong>
   <span>nearest standardized distance ${fmt(r.similarity?.nearest_distance,2)}</span>
   ${r.similarity?.level==="LOW"
      ? `<small>이 조합은 학습 wafer의 실제 공정 상태와 거리가 큽니다. 결과를 외삽으로 해석하지 마세요.</small>`
      : `<small>학습 wafer에서 관찰된 Process-state 조합과 비교적 유사합니다.</small>`}
 </div>

 ${r.extrapolation_count
   ? `<div class="scenario-warning"><strong>개별 관측 5–95% 범위 밖 ${r.extrapolation_count}개</strong><br>${r.outside_observed_parameters.map(esc).join(", ")}</div>`
   : `<div class="scenario-ok">모든 개별 입력값이 학습 데이터의 5–95% 관측범위 안에 있습니다.</div>`}

 <div class="scenario-disclaimer">${esc(r.notice||"")}</div>`;
}

async function runEpaScenario171(){
 const el=$("scenarioResult");
 if(el)el.innerHTML=`<div class="scenario-loading">시나리오 계산 중...</div>`;

 try{
   const response=await fetch("/api/v1/scenario/predict",{
     method:"POST",
     headers:{"Content-Type":"application/json"},
     body:JSON.stringify(epaScenarioPayload171())
   });

   if(!response.ok){
     const t=await response.text();
     throw new Error(t||`HTTP ${response.status}`);
   }

   renderEpaScenarioResult171(await response.json());

 }catch(e){
   if(el)el.innerHTML=box(`<strong>시나리오 계산 실패</strong><br>${esc(e.message)}`,"bad");
 }
}

function scheduleEpaScenario171(){
 clearTimeout(EPA_SCENARIO_TIMER_171);
 EPA_SCENARIO_TIMER_171=setTimeout(runEpaScenario171,180);
}

async function renderScenario(){
 const el=$("page-scenario");

 try{
   const m=await api(`/api/v1/scenario/${encodeURIComponent(S.exp)}`);
   const v=m.validation||{};

   el.innerHTML=`
   <div class="scenario-notice">
     <div>
       <span class="eyebrow">EPA · PROCESS-STATE WHAT-IF</span>
       <h2>공정 조건 시나리오</h2>
     </div>
     <p>${esc(m.notice)}</p>
   </div>

   <div class="scenario-validation-strip">
     <div><span>LOLO RMSE</span><b>${v.rmse_um==null?"—":fmt(v.rmse_um,3)+" um"}</b></div>
     <div><span>LOLO MAE</span><b>${v.mae_um==null?"—":fmt(v.mae_um,3)+" um"}</b></div>
     <div><span>P90 |error|</span><b>${v.p90_abs_error_um==null?"—":fmt(v.p90_abs_error_um,3)+" um"}</b></div>
     <div><span>OOF wafers</span><b>${v.n??"—"}</b></div>
   </div>

   <div class="scenario-grid">
     <div class="panel">
       <div class="panel-head">
         <div>
           <span class="eyebrow">INPUT PROCESS STATE</span>
           <h2>목표와 공정 상태 입력</h2>
         </div>
         <span class="badge">${m.parameters.length}개 파라미터</span>
       </div>

       <div class="scenario-target-inputs">
         <label>
           <span>목표 Si etch (um)</span>
           <input id="scenarioTarget" type="number" step="0.01" placeholder="직접 입력">
           <small>실제 제품/공정 목표값을 입력하세요.</small>
         </label>

         <label>
           <span>허용 범위 (%)</span>
           <input id="scenarioTolerance" type="number" min="0" step="0.5" value="${m.default_tolerance_pct}">
           <small>모델 오차와 별개인 사용자의 공정 허용범위</small>
         </label>
       </div>

       <div class="scenario-reference">
         <span>데이터 참고 중앙값</span>
         <b>${fmt(m.reference_data_median_um,3)} um</b>
         <small>목표값이 아니라 학습 데이터의 참고 통계입니다.</small>
       </div>

       <div id="scenarioControls" class="scenario-controls">
         ${m.parameters.map(epaScenarioParam171).join("")}
       </div>

       <div class="scenario-control-actions">
         <button class="secondary-action" id="scenarioReset">현재 웨이퍼 조건으로 초기화</button>
       </div>
     </div>

     <div class="panel scenario-result-panel">
       <div class="panel-head">
         <div>
           <span class="eyebrow">EPA · SCENARIO RESULT</span>
           <h2>모델상 예상 평균 식각</h2>
         </div>
         <span class="badge">exploratory</span>
       </div>

       <div id="scenarioResult">
         <div class="scenario-loading">시나리오 계산 중...</div>
       </div>

       <div class="scenario-model-info">
         <strong>${esc(m.model.name)}</strong>
         <span>학습 ${esc(m.model.training_cohort)} · ${m.model.training_wafers} wafers · ${m.model.feature_count} features</span>
       </div>

       <div class="scenario-measured-note">
         <span>선택 웨이퍼 실측 평균</span>
         <b>${m.measured_mean_um==null?"—":fmt(m.measured_mean_um,3)+" um"}</b>
       </div>
     </div>
   </div>`;

   document.querySelectorAll("#scenarioControls .scenario-param").forEach(row=>{
     const range=row.querySelector(".scenario-range");
     const number=row.querySelector(".scenario-number");

     range.oninput=()=>{
       number.value=epaScenarioFmt171(range.value);
       scheduleEpaScenario171();
     };

     number.oninput=()=>{
       const value=Number(number.value);
       if(Number.isFinite(value)){
         range.value=Math.min(
           Number(range.max),
           Math.max(Number(range.min),value)
         );
       }
       scheduleEpaScenario171();
     };
   });

   $("scenarioTarget").oninput=scheduleEpaScenario171;
   $("scenarioTolerance").oninput=scheduleEpaScenario171;
   $("scenarioReset").onclick=()=>renderScenario();

   await runEpaScenario171();

 }catch(e){
   el.innerHTML=box(`<strong>공정 조건 시나리오 로드 실패</strong><br>${esc(e.message)}`,"bad");
 }
}

async function renderDataStudio(){
 $("page-datastudio").innerHTML=`
 <div class="data-studio-shell">
  <div class="panel upload-panel">
   <div class="panel-head"><div><span class="eyebrow">ANALYZE YOUR DATA</span><h2>Upload CSV or XLSX</h2></div><span class="badge">analysis workspace</span></div>
   <div class="upload-zone" id="uploadZone">
    <div class="upload-icon">↑</div><strong>Drop a CSV / XLSX file here</strong><span>or choose a file from your computer</span>
    <button class="primary-action" id="chooseUpload">Choose file</button>
    <input id="dataStudioFile" type="file" accept=".csv,.xlsx" hidden>
    <small>Maximum 100 MB</small>
   </div>
  </div>
  <div id="dataStudioWorkspace">
   <div class="empty-workspace"><span class="eyebrow">WORKFLOW</span><h2>Upload → map columns → run analysis</h2>
    <div class="workflow-strip"><div><b>1</b><span>Schema detection</span></div><div><b>2</b><span>Data QA</span></div><div><b>3</b><span>Wafer statistics</span></div><div><b>4</b><span>Spatial review</span></div><div><b>5</b><span>Driver evidence</span></div></div>
   </div>
  </div>
 </div>`;
 const input=$("dataStudioFile"),zone=$("uploadZone");
 $("chooseUpload").onclick=()=>input.click();
 zone.ondragover=e=>{e.preventDefault();zone.classList.add("dragging")};
 zone.ondragleave=()=>zone.classList.remove("dragging");
 zone.ondrop=e=>{e.preventDefault();zone.classList.remove("dragging");const f=e.dataTransfer.files?.[0];if(f)inspectDataStudioFile(f)};
 input.onchange=()=>{const f=input.files?.[0];if(f)inspectDataStudioFile(f)};
}


async function renderWafer(){
 const w=await wafer(),vals=w.points.map(x=>Number(x.etch)),lo=Math.min(...vals),hi=Math.max(...vals);
 $("page-wafer").innerHTML=`<div class="cards">${card("Mean",fmt(w.summary.mean,3),"um")}${card("CV",fmt(w.summary.cv_pct,2),"%")}${card("P95-P05",fmt(w.summary.p95_p05,3),"um")}${card("Wafer status",w.summary.wafer_status||"—")}</div><div class="wafer-grid"><div class="panel"><span class="eyebrow">MEASURED 89-POINT MAP</span><h2>${esc(S.exp)}</h2><div class="wafer-wrap" id="waferMap">${mapSvg(w.points,"etch",{min:lo,max:hi,id:"waferMapSvg"})}</div>${scaleBar(lo,hi,"measured etch (um)")}</div><div class="panel"><span class="eyebrow">POINT INSPECTOR</span><h2>Click a measurement point</h2><div id="waferDetail">${box("Select a point.")}</div></div></div>`;await bindPointMap(w.points,"#waferMap","waferDetail");
}

async function renderDiagnostics(){
 const w=await wafer(),a=await api("/api/diagnostics/anomalies?limit=30");

 const maxI=w.points.reduce(
   (b,p,i)=>Math.abs(Number(p.shape_robust_z||0))>Math.abs(Number(w.points[b]?.shape_robust_z||0))?i:b,
   0
 );

 $("page-diagnostics").innerHTML=`
 <div class="cards compact-kpis">
   ${card("웨이퍼 상태",w.summary.wafer_status||"—")}
   ${card("최대 |shape z|",fmt(w.summary.max_shape_z,2))}
   ${card("포인트 |z|≥4",w.summary.flagged_z4??"—")}
   ${card("포인트 |z|≥6",w.summary.flagged_z6??"—")}
 </div>

 <div class="wafer-grid diagnostics-grid diagnostics-grid-balanced">
   <div class="panel">
     <div class="panel-head">
       <div>
         <span class="eyebrow">이상 강도 + 상태</span>
         <h2>공간 검토 맵</h2>
       </div>
       <span class="badge">최대 |z| 자동 선택</span>
     </div>
     ${diagLegend()}
     <div class="wafer-wrap compact-map diagnostics-map" id="diagWrap">${diagSvg(w.points)}</div>
   </div>

   <div class="panel diagnostics-detail-panel diagnostics-point-panel">
     <div class="panel-head">
       <div>
         <span class="eyebrow">선택 측정점</span>
         <h2>측정값 및 공간 이상</h2>
       </div>
     </div>
     <div id="diagDetail">${box("선택 측정점 로딩 중...")}</div>
   </div>
 </div>

 <div class="panel root-cause-wide-panel">
   <div id="rootCauseStudio">
     <div class="rc-loading">Process 원인 후보 계산 중...</div>
   </div>
 </div>

 <div class="panel compact-panel" style="margin-top:10px">
   <div class="panel-head">
     <div>
       <span class="eyebrow">전체 검토 큐</span>
       <h2>이상도가 높은 측정점</h2>
     </div>
   </div>
   ${table(a.rows,[
     {label:"웨이퍼",key:"experiment"},
     {label:"X",value:r=>fmt(r.x,0)},
     {label:"Y",value:r=>fmt(r.y,0)},
     {label:"Etch",value:r=>fmt(r.etch,3)},
     {label:"Shape z",value:r=>fmt(r.shape_z??r.robust_z,2)},
     {label:"상태",key:"status"}
   ])}
 </div>`;

 await bindPointMap(w.points,"#diagWrap","diagDetail");

 const p=w.points[maxI];
 const sel=document.querySelector(`#diagWrap circle[data-i="${maxI}"]`);
 if(sel)sel.classList.add("selected");

 // Start point diagnosis and wafer-level root-cause analysis in parallel.
 const rootCausePromise=loadRootCauseStudio163(false).catch(()=>null);
 const pointPromise=api(
   `/api/diagnostics/${encodeURIComponent(S.exp)}/point?x=${p.x}&y=${p.y}`
 );

 try{
   $("diagDetail").innerHTML=pointPanel(await pointPromise);
 }catch(e){
   $("diagDetail").innerHTML=box(
     `<strong>측정점 진단 실패</strong><br>${esc(e.message)}`,
     "bad"
   );
 }

 await rootCausePromise;
}

async function renderProcess(){
 const w=await wafer(),i=w.points.reduce((bi,p,j)=>Math.abs(Number(p.shape_robust_z||0))>Math.abs(Number(w.points[bi].shape_robust_z||0))?j:bi,0),p=w.points[i],ev=await api(`/api/diagnostics/${encodeURIComponent(S.exp)}/point?x=${p.x}&y=${p.y}`),m=await api(`/api/process/${encodeURIComponent(S.exp)}/meta`),fast=m.fast_sensors||[],proc=ev.sources?.process_deviation||{};
 $("page-process").innerHTML=`<div class="callout"><strong>VM mode: post-process / pre-metrology.</strong> The primary model uses the completed Process trace. Early 25/50/75% performance is reported separately in Validation.</div><div class="grid2"><div class="panel"><div class="field grow"><label>Cached analysis sensor</label><select id="sensorSelect">${fast.map(raw=>{const j=m.sensors.indexOf(raw);return`<option value="${esc(raw)}">${esc(m.display_sensors[j])}</option>`}).join("")}</select></div><div class="chart tall" id="processChart"></div></div><div class="panel"><span class="eyebrow">REVIEW EVIDENCE</span><h2>Most unusual Process features</h2>${(proc.top_features||[]).slice(0,5).map(x=>`<div class="signal"><span>${esc(x.sensor)} · ${esc(x.stat)}</span><b>z ${fmt(x.robust_z,2)}</b></div>`).join("")||box("No strong process evidence")}</div></div>`;
 const sel=$("sensorSelect"),top=proc.top_features?.[0]?.sensor,pref=fast.find(x=>x.includes(top))||fast[0];if(pref)sel.value=pref;const load=async()=>{const t=await api(`/api/process/${encodeURIComponent(S.exp)}/trace?sensor=${encodeURIComponent(sel.value)}`);lineChart($("processChart"),t.time_s,t.values,{xLabel:"elapsed time (s)",yLabel:t.display_sensor})};sel.onchange=load;if(fast.length)await load();
}

async function renderOES(){
 const m=await api(`/api/oes/${encodeURIComponent(S.exp)}/meta`),waves=m.cached_wavelengths||[];
 $("page-oes").innerHTML=`<div class="callout"><strong>Exploratory candidate panel.</strong> The cached wavelengths originated from prior screening. v1 performs train-fold-only selection inside this fixed panel for ablation, but does not claim a fully de-novo nested search across all 3,648 channels. OES is not used in the primary mean/spatial model.</div><div class="panel"><div class="preset">${waves.map(x=>`<button data-w="${x}">${fmt(x,2)} nm</button>`).join("")}</div><div class="chart tall" id="oesTrace"></div></div>`;
 const load=async w=>{const t=await api(`/api/oes/${encodeURIComponent(S.exp)}/trace?wavelength_nm=${w}`);lineChart($("oesTrace"),t.time_s,t.values,{xLabel:"elapsed time (s)",yLabel:`intensity @ ${fmt(t.wavelength_nm,2)} nm`})};document.querySelectorAll(".preset button").forEach(b=>b.onclick=()=>load(Number(b.dataset.w)));if(waves.length){
  await load(waves[0]);
  const first=document.querySelector("#page-oes .preset button[data-w]");
  if(first && typeof setOesWaveSelection==="function")setOesWaveSelection(first);
 }
}

async function renderValidation(){
 const m=await api("/api/v1/model/metrics"),mean=m.mean_model,sp=m.spatial.models,fin=m.final_point.primary,oes=m.oes_candidate_ablation,early=m.early_vm;

 const spatialRows=[
   {name:"Mean-only zero residual",...sp.mean_only_zero},
   {name:"Same-XY train template",...sp.same_xy_template},
   {name:"Geometry + preox HGB",...sp.geometry_preox_hgb},
   {name:"Geometry + preox + Process HGB",...sp.geometry_preox_process_hgb},
   {name:"PCA + preox + Process (PRIMARY)",...sp.pca_preox_process},
 ];

 $("page-validation").innerHTML=`
 <div class="cards compact-kpis">
   ${card("Frozen benchmark",fmt(m.reference_model.rmse_um,4),"um","84 wafers · prior validated")}
   ${card("Local nested reproduction",fmt(mean.rmse_um,4),"um","84-wafer target cohort")}
   ${card("Spatial PCA RMSE",fmt(sp.pca_preox_process.point_pooled_rmse_um,4),"um","residual map")}
   ${card("Final point RMSE",fmt(fin.point_pooled_rmse_um,4),"um","mean + spatial")}
 </div>

 <div class="validation-summary-grid">
   <div class="panel summary-panel">
     <span class="eyebrow">MEAN MODEL</span>
     <h2>Same target / same primary cohort</h2>
     <div class="summary-metric"><span>Frozen validated</span><b>${fmt(m.reference_model.rmse_um,4)} um</b></div>
     <div class="summary-metric emphasis"><span>Local nested reproduction</span><b>${fmt(mean.rmse_um,4)} um</b></div>
     <small>Lower RMSE is better. These two values are directly comparable.</small>
   </div>

   <div class="panel summary-panel">
     <span class="eyebrow">SPATIAL RESIDUAL</span>
     <h2>Held-out Lot baselines</h2>
     <div class="summary-metric"><span>Same-XY template</span><b>${fmt(sp.same_xy_template.point_pooled_rmse_um,4)} um</b></div>
     <div class="summary-metric emphasis"><span>PCA primary</span><b>${fmt(sp.pca_preox_process.point_pooled_rmse_um,4)} um</b></div>
     <div class="summary-metric"><span>Process HGB challenger</span><b>${fmt(sp.geometry_preox_process_hgb.point_pooled_rmse_um,4)} um</b></div>
   </div>

   <div class="panel summary-panel">
     <span class="eyebrow">FINAL 89-POINT</span>
     <h2>Hierarchy-aware error</h2>
     <div class="summary-metric emphasis"><span>Point pooled</span><b>${fmt(fin.point_pooled_rmse_um,4)} um</b></div>
     <div class="summary-metric"><span>Wafer macro</span><b>${fmt(fin.wafer_macro_mean_rmse_um,4)} um</b></div>
     <div class="summary-metric"><span>Worst Lot</span><b>L${fin.worst_lot.lot} · ${fmt(fin.worst_lot.rmse_um,4)} um</b></div>
   </div>
 </div>

 <div class="grid2 validation-grid">
   <div class="panel">
     <span class="eyebrow">COHORT GOVERNANCE</span>
     <h2>Primary vs external</h2>
     ${box(`<strong>Primary benchmark</strong><br>Lots 1–9 · ${m.cohort.primary_wafers} wafers<br><br><strong>External challenge</strong><br>Lot 10 · ${m.cohort.external_wafers} wafers<br><br>The frozen ${fmt(m.reference_model.rmse_um,4)} um benchmark is never directly compared to a different cohort without labeling it.`,"ok")}
   </div>

   <div class="panel">
     <span class="eyebrow">MEAN MODEL</span>
     <h2>Nested sequential reproduction</h2>
     <div class="detail-row"><span>RMSE</span><b>${fmt(mean.rmse_um,4)} um</b></div>
     <div class="detail-row"><span>MAE</span><b>${fmt(mean.mae_um,4)} um</b></div>
     <div class="detail-row"><span>P90 |error|</span><b>${fmt(mean.p90_abs_error_um,4)} um</b></div>
     <div class="detail-row"><span>Worst Lot</span><b>L${mean.worst_lot.lot} · ${fmt(mean.worst_lot.rmse_um,4)} um</b></div>
   </div>
 </div>

 <div class="panel compact-panel" style="margin-bottom:10px">
   <span class="eyebrow">SPATIAL BASELINES</span>
   <h2>All models evaluated by held-out Lot</h2>
   ${table(spatialRows,[{label:"Model",key:"name"},{label:"Point RMSE",value:r=>fmt(r.point_pooled_rmse_um,4)},{label:"Wafer macro",value:r=>fmt(r.wafer_macro_mean_rmse_um,4)},{label:"Lot macro",value:r=>fmt(r.lot_macro_mean_rmse_um,4)},{label:"Worst Lot",value:r=>`L${r.worst_lot.lot} · ${fmt(r.worst_lot.rmse_um,4)}`}])}
 </div>

 <div class="grid2">
   <div class="panel">
     <span class="eyebrow">EARLY VIRTUAL METROLOGY</span>
     <h2>How early can final mean be estimated?</h2>
     <div class="chart compact-chart" id="earlyChart"></div>
     ${table(early,[{label:"Progress",value:r=>r.percent+"%"},{label:"RMSE",value:r=>fmt(r.rmse_um,4)+" um"},{label:"MAE",value:r=>fmt(r.mae_um,4)+" um"},{label:"Mode",key:"mode"}])}
   </div>

   <div class="panel">
     <span class="eyebrow">OES INCREMENTAL VALUE</span>
     <h2>Candidate-panel ablation</h2>
     ${oes.available?`
       <div class="detail-row"><span>Process-only cold RMSE</span><b>${fmt(oes.process_only_cold_rmse_um,4)} um</b></div>
       <div class="detail-row"><span>Process + OES panel</span><b>${fmt(oes.process_plus_oes_candidate_rmse_um,4)} um</b></div>
       <div class="detail-row"><span>ΔRMSE</span><b>${oes.delta_rmse_um>=0?"+":""}${fmt(oes.delta_rmse_um,4)} um</b></div>
       <div class="reason">${esc(oes.warning)}</div>`
       :box(esc(oes.reason||"OES unavailable"))}
   </div>
 </div>

 <div class="grid2 equal" style="margin-top:10px">
   <div class="panel">
     <span class="eyebrow">FINAL 89-POINT METRICS</span>
     <h2>Hierarchy-aware reporting</h2>
     <div class="detail-row"><span>Point-pooled RMSE</span><b>${fmt(fin.point_pooled_rmse_um,4)} um</b></div>
     <div class="detail-row"><span>Wafer-macro mean RMSE</span><b>${fmt(fin.wafer_macro_mean_rmse_um,4)} um</b></div>
     <div class="detail-row"><span>Lot-macro mean RMSE</span><b>${fmt(fin.lot_macro_mean_rmse_um,4)} um</b></div>
     <div class="detail-row"><span>Worst Lot RMSE</span><b>L${fin.worst_lot.lot} · ${fmt(fin.worst_lot.rmse_um,4)} um</b></div>
   </div>

   <div class="panel">
     <span class="eyebrow">LIMITATIONS</span>
     <h2>Claims intentionally not made</h2>
     ${box(`<strong>Recipe:</strong> one nominal BOSCH recipe; no multi-recipe response model.<br><br><strong>Conditioning Type:</strong> contextual metadata, not a primary feature because Type is confounded with Lot/date.<br><br><strong>Preox:</strong> provided 89-point field includes interpolation from sparse direct measurements.<br><br><strong>OES:</strong> fixed exploratory candidate panel, not full 3,648-channel nested discovery.<br><br><strong>Diagnostics:</strong> evidence is not causal probability.<br><br><strong>Operational mode:</strong> historical OOF/external-holdout simulation, not a live fab connection.`)}
   </div>
 </div>`;

 lineChart($("earlyChart"),early.map(x=>x.percent),early.map(x=>x.rmse_um),{xLabel:"process progress (%)",yLabel:"LOLO RMSE (um)"});
}

async function render(){loading(true);try{if(S.page==="overview")await renderOverview();else if(S.page==="vm")await renderVM();else if(S.page==="scenario")await renderScenario();else if(S.page==="datastudio")await renderDataStudio();else if(S.page==="wafer")await renderWafer();else if(S.page==="process")await renderProcess();else if(S.page==="oes")await renderOES();else if(S.page==="diagnostics")await renderDiagnostics();else if(S.page==="validation")await renderValidation()}catch(e){$(`page-${S.page}`).innerHTML=box(`<strong>${esc(S.page)} failed</strong><br>${esc(e.message)}`,"bad")}finally{loading(false)}}
init();

/* === BRAND + OES UX v1.5 STABLE START === */
function boschGeoLogoSvg(){
 return `
 <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
   <defs>
     <linearGradient id="beg1" x1="0" y1="0" x2="1" y2="1">
       <stop offset="0%" stop-color="#2b73b7"/>
       <stop offset="100%" stop-color="#4d93d4"/>
     </linearGradient>
     <linearGradient id="beg2" x1="1" y1="0" x2="0" y2="1">
       <stop offset="0%" stop-color="#78b2e6"/>
       <stop offset="100%" stop-color="#d8e9f8"/>
     </linearGradient>
   </defs>
   <g transform="translate(32 32)">
     <path d="M0,-20 L10,-10 L0,0 L-10,-10 Z" fill="url(#beg1)"/>
     <path d="M20,0 L10,10 L0,0 L10,-10 Z" fill="url(#beg2)"/>
     <path d="M0,20 L-10,10 L0,0 L10,10 Z" fill="url(#beg1)"/>
     <path d="M-20,0 L-10,-10 L0,0 L-10,10 Z" fill="url(#beg2)"/>
     <path d="M0,-10 L10,0 L0,10 L-10,0 Z" fill="#ffffff" fill-opacity=".95"/>
     <circle cx="0" cy="0" r="3.2" fill="#2b73b7"/>
   </g>
 </svg>`;
}

function applyBrandRefresh(){
 const brand=document.querySelector(".brand");
 if(!brand || brand.querySelector(".geo-brand"))return;

 const oldText=brand.querySelector("b");
 const mark=document.createElement("div");
 mark.className="brand-mark geo-brand";
 mark.innerHTML=boschGeoLogoSvg();

 if(oldText) oldText.replaceWith(mark);
 else brand.prepend(mark);

 brand.classList.add("brand-refreshed");
}

function setOesWaveSelection(button){
 const page=document.querySelector("#page-oes");
 if(!page || !button)return;

 page.querySelectorAll(".preset button[data-w].selected-wavelength")
   .forEach(x=>x.classList.remove("selected-wavelength"));

 button.classList.add("selected-wavelength");

 const wave=button.dataset.w || "";
 let banner=page.querySelector(".oes-selection-banner");

 if(!banner){
   banner=document.createElement("div");
   banner.className="oes-selection-banner";
   const panel=page.querySelector(".panel");
   if(panel)panel.prepend(banner);
 }

 if(banner){
   banner.innerHTML=`<span>Selected wavelength</span><strong>${wave} nm</strong>`;
 }
}

function setupSafeOesSelection(){
 if(document.body?.dataset?.safeOesSelectionReady)return;
 document.body.dataset.safeOesSelectionReady="1";

 document.body.addEventListener("click",(e)=>{
   const button=e.target.closest("#page-oes .preset button[data-w]");
   if(!button)return;
   setOesWaveSelection(button);
 });
}

function initBrandAndOesUX(){
 applyBrandRefresh();
 setupSafeOesSelection();
}

if(document.readyState==="loading"){
 document.addEventListener("DOMContentLoaded",initBrandAndOesUX,{once:true});
}else{
 initBrandAndOesUX();
}
/* === BRAND + OES UX v1.5 STABLE END === */

/* === GLOBAL SELECTION SHADE v1.5 STABLE START === */
function genericSelectionTarget(node){
 const selector=[
  ".table-wrap tbody tr",
  ".driver-row",
  ".summary-metric",
  ".detail-row",
  ".reason",
  ".signal",
  ".cap-chip",
  ".workflow-strip > div",
  ".context-grid > div",
  ".card",
  ".badge",
  ".mapping-grid label",
  ".arch > div",
  ".status",
  ".model-card"
 ].join(",");

 return node?.closest?.(selector)||null;
}

function genericSelectionScope(el){
 return el.closest(
  "tbody,.table-wrap,.cap-row,.workflow-strip,.context-grid,.mapping-grid,"+
  ".validation-summary-grid,.cards,.arch,.panel,.grid2,.grid-2,.grid-3,.wafer-grid"
 )||document.body;
}

function applyGenericSelection(el){
 if(!el)return;

 const scope=genericSelectionScope(el);

 scope.querySelectorAll(".ui-selected").forEach(x=>{
  if(x!==el)x.classList.remove("ui-selected");
 });

 el.classList.add("ui-selectable","ui-selected");
}

function setupGlobalSelectionShading(){
 if(document.body?.dataset?.selectionShadeReady)return;
 document.body.dataset.selectionShadeReady="1";

 document.body.addEventListener("click",(e)=>{
  const t=genericSelectionTarget(e.target);
  if(!t || t.closest(".brand"))return;
  applyGenericSelection(t);
 });

 document.body.addEventListener("change",(e)=>{
  const sel=e.target.closest("select");
  if(!sel)return;

  const box=sel.closest(".selector,.field,label");
  if(!box)return;

  const scope=box.parentElement||document.body;

  scope.querySelectorAll(".selection-active").forEach(x=>{
   if(x!==box)x.classList.remove("selection-active");
  });

  box.classList.add("selection-active");
 });
}

if(document.readyState==="loading"){
 document.addEventListener("DOMContentLoaded",setupGlobalSelectionShading,{once:true});
}else{
 setupGlobalSelectionShading();
}
/* === GLOBAL SELECTION SHADE v1.5 STABLE END === */

/* === UI POLISH v1.5.7 MINIMAL AXIS START === */
function boschRefinedLogoSvg(){
  return `
  <svg viewBox="0 0 72 72" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="be_logo_outer_157" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#2B73B7"/>
        <stop offset="100%" stop-color="#5A8FCA"/>
      </linearGradient>
      <linearGradient id="be_logo_inner_157" x1="1" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#EAF2FA"/>
        <stop offset="100%" stop-color="#BFD3EA"/>
      </linearGradient>
    </defs>
    <g transform="translate(36 36)">
      <path d="M0 -22 L19 -11 L19 11 L0 22 L-19 11 L-19 -11 Z" fill="url(#be_logo_outer_157)"/>
      <path d="M0 -13.5 L11.5 -6.7 L11.5 6.7 L0 13.5 L-11.5 6.7 L-11.5 -6.7 Z" fill="#ffffff" opacity=".96"/>
      <path d="M0 -9.5 L8.3 -4.8 L8.3 4.8 L0 9.5 L-8.3 4.8 L-8.3 -4.8 Z" fill="url(#be_logo_inner_157)"/>
      <circle cx="0" cy="0" r="2.2" fill="#2B73B7"/>
    </g>
  </svg>`;
}

function applyRefinedBrandLogo157(){
  const brand=document.querySelector(".brand");
  if(!brand)return;

  let mark=brand.querySelector(".brand-mark");
  if(!mark){
    mark=document.createElement("div");
    mark.className="brand-mark";
    brand.prepend(mark);
  }

  mark.classList.add("brand-mark-refined");
  mark.innerHTML=boschRefinedLogoSvg();
  brand.classList.add("brand-refined");
}

const WAFER_AXIS_TICKS_157=[-95,-57,0,57,95];

function renderMinimalWaferAxes157(svg){
  if(!svg)return;

  // Always remove older axis versions first.
  svg.querySelectorAll(
    ".wafer-axis-numbers,.refined-axis-layer,.coord-axis-layer,.wafer-axis-layer"
  ).forEach(x=>x.remove());

  if(svg.dataset.axis157==="1")return;

  const ns="http://www.w3.org/2000/svg";
  const g=document.createElementNS(ns,"g");
  g.setAttribute("class","wafer-axis-numbers minimal-axis-layer");
  g.setAttribute("aria-hidden","true");

  // Y numbers only — aligned immediately left of wafer.
  for(const y of WAFER_AXIS_TICKS_157){
    const sy=-y;
    const t=document.createElementNS(ns,"text");
    t.setAttribute("x",-108);
    t.setAttribute("y",sy+2.7);
    t.setAttribute("text-anchor","end");
    t.setAttribute("class",y===0?"axis-number axis-number-major":"axis-number");
    t.textContent=String(y);
    g.appendChild(t);
  }

  // X numbers only — kept inside the existing viewBox so they never clip.
  for(const x of WAFER_AXIS_TICKS_157){
    const t=document.createElementNS(ns,"text");
    t.setAttribute("x",x);
    t.setAttribute("y",113);
    t.setAttribute("text-anchor","middle");
    t.setAttribute("class",x===0?"axis-number axis-number-major":"axis-number");
    t.textContent=String(x);
    g.appendChild(t);
  }

  const yLabel=document.createElementNS(ns,"text");
  yLabel.setAttribute("x",-108);
  yLabel.setAttribute("y",-105);
  yLabel.setAttribute("text-anchor","end");
  yLabel.setAttribute("class","axis-caption");
  yLabel.textContent="Y";
  g.appendChild(yLabel);

  const xLabel=document.createElementNS(ns,"text");
  xLabel.setAttribute("x",107);
  xLabel.setAttribute("y",113);
  xLabel.setAttribute("text-anchor","start");
  xLabel.setAttribute("class","axis-caption");
  xLabel.textContent="X";
  g.appendChild(xLabel);

  svg.appendChild(g);
  svg.dataset.axis157="1";
}

function processAddedNodeForWaferAxis157(node){
  if(!node || node.nodeType!==1)return;

  if(node.matches?.("svg.wafer-svg")){
    renderMinimalWaferAxes157(node);
  }

  node.querySelectorAll?.("svg.wafer-svg").forEach(renderMinimalWaferAxes157);
}

function scanExistingWaferAxes157(){
  document.querySelectorAll("svg.wafer-svg").forEach(renderMinimalWaferAxes157);
}

function startWaferAxisObserver157(){
  if(document.body?.dataset?.waferAxisObserver157==="1")return;
  document.body.dataset.waferAxisObserver157="1";

  const observer=new MutationObserver(mutations=>{
    for(const mutation of mutations){
      for(const node of mutation.addedNodes){
        processAddedNodeForWaferAxis157(node);
      }
    }
  });

  const root=
    document.querySelector("main")
    || document.querySelector(".main")
    || document.querySelector(".content")
    || document.body;

  observer.observe(root,{childList:true,subtree:true});
}

function initUiPolish157(){
  applyRefinedBrandLogo157();
  scanExistingWaferAxes157();
  startWaferAxisObserver157();
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",initUiPolish157,{once:true});
}else{
  initUiPolish157();
}
/* === UI POLISH v1.5.7 MINIMAL AXIS END === */

/* === KOREAN UI v1.5.8 START === */
const BOSCH_KO_EXACT = new Map([
  ["Overview","개요"],
  ["Virtual Metrology","가상 계측"],
  ["Data Studio","데이터 스튜디오"],
  ["Wafer Analysis","웨이퍼 분석"],
  ["Process","공정"],
  ["OES","OES"],
  ["Diagnostics","진단"],
  ["Validation","검증"],

  ["Selected wafer","선택 웨이퍼"],
  ["ready","준비 완료"],
  ["NORMAL","정상"],
  ["REVIEW ≥4","검토 필요 ≥4"],
  ["STRONG ≥6","강한 이상 ≥6"],
  ["Click a point.","측정점을 클릭하세요."],
  ["Click a point","측정점을 클릭"],
  ["Status","상태"],
  ["Point","측정점"],
  ["POINT","측정점"],
  ["Lot","Lot"],
  ["Wafer","웨이퍼"],
  ["Type","타입"],
  ["Surface","표면"],
  ["Cohort","코호트"],
  ["Conditioning","Conditioning"],

  ["Competition-grade hierarchical virtual metrology","대회형 계층적 가상 계측"],
  ["Predicted wafer mean","예측 웨이퍼 평균"],
  ["Frozen reference P90","고정 기준 P90"],
  ["Lot / wafer","Lot / 웨이퍼"],
  ["VM mode","VM 모드"],
  ["POST-PROCESS","후공정 기반"],
  ["pre-metrology","사전 계측"],
  ["cold start","콜드 스타트"],
  ["empirical OOF band","경험적 OOF 구간"],
  ["HIERARCHICAL ARCHITECTURE","계층 구조"],
  ["Nominal reference + wafer-state correction + spatial correction","기준값 + 웨이퍼 상태 보정 + 공간 보정"],
  ["0 · NOMINAL RECIPE REFERENCE","0 · 기준 레시피 기준값"],
  ["same nominal BOSCH recipe · training-only reference","동일 명목 BOSCH 레시피 · 학습 데이터 기준"],
  ["1 · PROCESS / SEQUENTIAL","1 · 공정 / 순차 보정"],
  ["train-only active sensors · previous-wafer metrology only","학습 데이터 활성 센서 · 이전 웨이퍼 계측만 사용"],
  ["2 · SPATIAL RESIDUAL","2 · 공간 잔차"],
  ["PCA spatial basis + preox + Process state","PCA 공간 기저 + preox + 공정 상태"],
  ["OPERATIONAL SIMULATION","운영 시뮬레이션"],
  ["Predicted 89-point wafer map","예측 89포인트 웨이퍼 맵"],
  ["PROCESS CONTEXT","공정 컨텍스트"],
  ["Metadata source","메타데이터 출처"],
  ["Model policy","모델 정책"],
  ["Numeric Lot ID is not used as a continuous predictive feature.","숫자형 Lot ID는 연속형 예측 변수로 사용하지 않습니다."],

  ["Immediate spatial, process, OES and metrology evidence","즉시 확인 가능한 공간·공정·OES·계측 근거"],
  ["Wafer status","웨이퍼 상태"],
  ["Points |z|≥4","포인트 |z|≥4"],
  ["Points |z|≥6","포인트 |z|≥6"],
  ["ANOMALY INTENSITY + STATUS","이상 강도 + 상태"],
  ["Continuous fill, categorical border","연속 채움, 범주형 테두리"],
  ["INTEGRATED REVIEW EVIDENCE","종합 검토 근거"],
  ["Selected point","선택 측정점"],
  ["Measured Si etch","측정 Si 식각"],
  ["Expected same XY","동일 XY 기대값"],
  ["Deviation","편차"],
  ["Spatial shape z","공간 형상 z"],
  ["No strong spatial anomaly detected","강한 공간 이상이 감지되지 않았습니다"],
  ["Same-position, leave-one-lot-out shape deviation is below |z| = 4.","동일 위치 기준 leave-one-lot-out 형상 편차가 |z| = 4 미만입니다."],
  ["HIGHEST REVIEW EVIDENCE","최우선 검토 근거"],
  ["RELATIVE REVIEW EVIDENCE","상대 검토 근거"],
  ["spatial pattern","공간 패턴"],
  ["process deviation","공정 편차"],
  ["oes deviation","OES 편차"],
  ["measurement quality","측정 품질"],
  ["These are normalized review-evidence shares, not calibrated causal probabilities.","이는 정규화된 검토 근거 비율이며, 보정된 인과 확률이 아닙니다."],

  ["MODEL GOVERNANCE","모델 거버넌스"],
  ["Cohort separation, nested LOLO, spatial baselines, early VM and limitations","코호트 분리, 중첩 LOLO, 공간 기준선, 초기 VM 및 한계"],
  ["Frozen benchmark","고정 벤치마크"],
  ["Local nested reproduction","로컬 중첩 재현"],
  ["Spatial PCA RMSE","공간 PCA RMSE"],
  ["Final point RMSE","최종 포인트 RMSE"],
  ["residual map","잔차 맵"],
  ["mean + spatial","평균 + 공간"],
  ["COHORT GOVERNANCE","코호트 거버넌스"],
  ["Primary vs external","Primary vs 외부"],
  ["Primary benchmark","Primary 벤치마크"],
  ["External challenge","외부 챌린지"],
  ["The frozen 0.1716 um benchmark is never directly compared to a different cohort without labeling it.","고정 0.1716 um 벤치마크는 라벨 없이 다른 코호트와 직접 비교하지 않습니다."],
  ["MEAN MODEL","평균 모델"],
  ["Nested sequential reproduction","중첩 순차 재현"],
  ["Worst Lot","최악 Lot"],
  ["SPATIAL BASELINES","공간 기준선"],
  ["All models evaluated by held-out Lot","홀드아웃 Lot 기준 전체 모델 평가"],
  ["Model","모델"],
  ["Point RMSE","포인트 RMSE"],
  ["Wafer macro","웨이퍼 매크로"],
  ["Lot macro","Lot 매크로"],

  ["Mean Etch","평균 식각"],
  ["Min Etch","최소 식각"],
  ["Max Etch","최대 식각"],
  ["measurement points","측정 포인트"],
  ["Measurement Point","측정 포인트"],
  ["89-Point Wafer Map","89포인트 웨이퍼 맵"],
  ["Measured mean etch by lot","Lot별 측정 평균 식각"],
  ["Actual vs OOF prediction","실측값 vs OOF 예측"],
  ["Actual etch (um)","실제 식각 (um)"],
  ["Predicted etch (um)","예측 식각 (um)"],
  ["Selected lot","선택 Lot"],
  ["Predicted etch","예측 식각"],
  ["Measured etch","측정 식각"],
  ["LOLO RMSE","LOLO RMSE"],
  ["strict leave-one-lot-out OOF","엄격 leave-one-lot-out OOF"],
  ["Prediction","예측값"],
  ["Measured","측정값"],
  ["Error","오차"],
  ["Empirical P90 |error|","경험적 P90 |오차|"],

  ["Upload dataset","데이터 업로드"],
  ["Choose file","파일 선택"],
  ["No file chosen","선택된 파일 없음"],
  ["Accepted: CSV / XLSX","지원 형식: CSV / XLSX"],
  ["Auto mapping","자동 매핑"],
  ["Run analysis","분석 실행"],
  ["Schema mapping","스키마 매핑"],
  ["Rows","행 수"],
  ["Columns","열 수"],
  ["Detected wafers","감지된 웨이퍼 수"],
  ["Missing cells","누락 셀"],
  ["Duplicate rows","중복 행"],
  ["Wafer summary","웨이퍼 요약"],
  ["Uniformity / variation","균일도 / 변동성"],
  ["Points","포인트 수"],
  ["Mean","평균"],
  ["CV %","CV %"],
  ["P95-P05","P95-P05"],
  ["Spatial review","공간 검토"],
  ["Top review points","상위 검토 포인트"],
  ["Same-coordinate robust deviation","동일 좌표 robust 편차"],
  ["Driver evidence","원인 후보 변수"],
  ["Numeric features associated with wafer mean etch","웨이퍼 평균 식각과 연관된 수치형 변수"],
  ["Association is for investigation prioritization only. It is not causal attribution.","연관성은 조사 우선순위 설정용이며 인과관계를 의미하지 않습니다."],
  ["FULL MEASUREMENT ANALYSIS","전체 계측 분석"],
  ["PARTIAL ANALYSIS","부분 분석"],
]);

const BOSCH_KO_PARTIAL = [
  ["Competition-grade hierarchical virtual metrology","대회형 계층적 가상 계측"],
  ["Selected wafer","선택 웨이퍼"],
  ["Lot / wafer","Lot / 웨이퍼"],
  ["Predicted wafer mean","예측 웨이퍼 평균"],
  ["Frozen reference P90","고정 기준 P90"],
  ["VM mode","VM 모드"],
  ["PROCESS CONTEXT","공정 컨텍스트"],
  ["HIERARCHICAL ARCHITECTURE","계층 구조"],
  ["OPERATIONAL SIMULATION","운영 시뮬레이션"],
  ["Predicted 89-point wafer map","예측 89포인트 웨이퍼 맵"],
  ["Measured mean etch by lot","Lot별 측정 평균 식각"],
  ["Actual vs OOF prediction","실측값 vs OOF 예측"],
  ["Actual etch (um)","실제 식각 (um)"],
  ["Predicted etch (um)","예측 식각 (um)"],
  ["Measurement Point","측정 포인트"],
  ["89-Point Wafer Map","89포인트 웨이퍼 맵"],
  ["Upload dataset","데이터 업로드"],
  ["Auto mapping","자동 매핑"],
  ["Run analysis","분석 실행"],
  ["Schema mapping","스키마 매핑"],
  ["Wafer summary","웨이퍼 요약"],
  ["Uniformity / variation","균일도 / 변동성"],
  ["Spatial review","공간 검토"],
  ["Top review points","상위 검토 포인트"],
  ["Driver evidence","원인 후보 변수"],
  ["MODEL GOVERNANCE","모델 거버넌스"],
  ["COHORT GOVERNANCE","코호트 거버넌스"],
  ["SPATIAL BASELINES","공간 기준선"],
  ["Selected point","선택 측정점"],
  ["Measured Si etch","측정 Si 식각"],
  ["Expected same XY","동일 XY 기대값"],
  ["No strong spatial anomaly detected","강한 공간 이상이 감지되지 않았습니다"],
  ["These are normalized review-evidence shares, not calibrated causal probabilities.","이는 정규화된 검토 근거 비율이며, 보정된 인과 확률이 아닙니다."],
  ["ready","준비 완료"],
  ["NORMAL","정상"],
  ["REVIEW","검토 필요"],
  ["STRONG REVIEW","강한 검토 필요"],
  ["POST-PROCESS","후공정 기반"],
  ["pre-metrology","사전 계측"],
  ["cold start","콜드 스타트"],
  ["empirical OOF band","경험적 OOF 구간"],
  ["Metadata source","메타데이터 출처"],
  ["Model policy","모델 정책"],
];

function boschReplaceTextValue(input){
  if(!input) return input;
  let text = input;

  const exact = BOSCH_KO_EXACT.get(text.trim());
  if(exact && text.trim() === text){
    return exact;
  }

  const trimmed = text.trim();
  if(BOSCH_KO_EXACT.has(trimmed)){
    const startIdx = text.indexOf(trimmed);
    const prefix = startIdx >= 0 ? text.slice(0, startIdx) : "";
    const suffix = startIdx >= 0 ? text.slice(startIdx + trimmed.length) : "";
    return prefix + BOSCH_KO_EXACT.get(trimmed) + suffix;
  }

  for(const [en, ko] of BOSCH_KO_PARTIAL){
    if(text.includes(en)){
      text = text.split(en).join(ko);
    }
  }

  return text;
}

function boschTranslateNode(node){
  if(!node) return;

  if(node.nodeType === Node.TEXT_NODE){
    const parent = node.parentElement;
    if(!parent) return;
    const tag = parent.tagName;
    if(["SCRIPT","STYLE","TEXTAREA"].includes(tag)) return;
    const oldValue = node.nodeValue;
    const newValue = boschReplaceTextValue(oldValue);
    if(newValue !== oldValue){
      node.nodeValue = newValue;
    }
    return;
  }

  if(node.nodeType !== Node.ELEMENT_NODE) return;

  const attrs = ["placeholder","title","aria-label"];
  for(const attr of attrs){
    const val = node.getAttribute?.(attr);
    if(val){
      const newVal = boschReplaceTextValue(val);
      if(newVal !== val) node.setAttribute(attr,newVal);
    }
  }

  if(node.tagName === "INPUT" && node.type === "button" && node.value){
    const newVal = boschReplaceTextValue(node.value);
    if(newVal !== node.value) node.value = newVal;
  }

  for(const child of node.childNodes){
    boschTranslateNode(child);
  }

  if(node.dataset) node.dataset.koDone = "1";
}

function translateAllBoschUiKo(){
  document.documentElement.lang = "ko";
  if(document.body) boschTranslateNode(document.body);
}

function observeBoschUiKo(){
  if(document.body?.dataset?.boschKoObserver === "1") return;
  document.body.dataset.boschKoObserver = "1";

  const observer = new MutationObserver((mutations)=>{
    for(const mutation of mutations){
      if(mutation.type === "childList"){
        mutation.addedNodes.forEach((node)=>boschTranslateNode(node));
      } else if(mutation.type === "characterData"){
        boschTranslateNode(mutation.target);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function initBoschKoreanUi158(){
  translateAllBoschUiKo();
  observeBoschUiKo();
  setTimeout(translateAllBoschUiKo, 250);
  setTimeout(translateAllBoschUiKo, 900);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", initBoschKoreanUi158, {once:true});
} else {
  initBoschKoreanUi158();
}
/* === KOREAN UI v1.5.8 END === */

/* === ROOT CAUSE HOTFIX v1.6.1 START === */
function rcHtml161(d){
 const rows=d.combined_candidates||d.process_candidates||[];
 const source=d.backend_source||"unknown";

 if(!rows.length){
   return `
   <div class="rc-header">
     <div><span class="eyebrow">ROOT CAUSE REVIEW</span><h3>원인 후보 파라미터</h3></div>
     <span class="badge">${d.baseline?.peer_count??0}개 peer</span>
   </div>
   <div class="rc-empty">
     <strong>비교 가능한 Process 후보가 없습니다.</strong>
     <span>분석 소스: ${esc(source)}</span>
     ${(d.warnings||[]).map(x=>`<small>${esc(x)}</small>`).join("")}
   </div>
   <div class="rc-disclaimer">${esc(d.disclaimer||"")}</div>`;
 }

 return `
 <div class="rc-header">
   <div><span class="eyebrow">ROOT CAUSE REVIEW</span><h3>원인 후보 파라미터</h3></div>
   <span class="badge">${d.baseline?.peer_count??0}개 peer</span>
 </div>
 <div class="rc-source-note">분석 소스 · ${esc(source)}</div>
 <div class="rc-list">${rows.slice(0,8).map(rcRow).join("")}</div>
 ${!d.include_oes
   ? `<button class="rc-oes-button" id="loadRootCauseOes">OES 후보도 함께 분석</button>`
   : `<div class="rc-oes-loaded">OES 후보 포함 완료</div>`}
 ${(d.warnings||[]).length
   ? `<div class="rc-warning">${d.warnings.map(esc).join("<br>")}</div>`
   : ""}
 <div class="rc-disclaimer">${esc(d.disclaimer||"")}</div>`;
}

async function loadRootCauseStudio161(includeOes=false){
 const slot=$("rootCauseStudio");
 if(!slot)return;

 slot.innerHTML=`<div class="rc-loading">${includeOes?"Process + OES":"Process"} 원인 후보 계산 중...</div>`;

 try{
   const d=await api(`/api/v1/root-cause/${encodeURIComponent(S.exp)}?include_oes=${includeOes?"true":"false"}`);
   slot.innerHTML=rcHtml161(d);
   const b=$("loadRootCauseOes");
   if(b)b.onclick=()=>loadRootCauseStudio161(true);
 }catch(e){
   slot.innerHTML=`
   <div class="rc-empty rc-error-detail">
     <strong>원인 후보 분석 API 오류</strong>
     <span>${esc(e.message||String(e))}</span>
     <small>v1.6.1은 기존 cache 실패 시 Process_data.nc 직접 분석으로 자동 전환합니다.</small>
   </div>`;
 }
}

loadRootCauseStudio=loadRootCauseStudio161;
/* === ROOT CAUSE HOTFIX v1.6.1 END === */

/* === ROOT CAUSE UX v1.6.2 START === */
function rcActionForCandidate(x){
  const p=String(x.parameter||"").toLowerCase();
  const src=String(x.source||"").toUpperCase();

  if(src==="OES"){
    return {
      check:"동일 Lot 정상 웨이퍼의 OES trajectory와 해당 파장 intensity 변화를 비교",
      action:"동시간대 가스 유량·챔버 압력·RF 변동을 함께 확인하고 공정 구간별 이상 발생 시점을 좁힘"
    };
  }
  if(p.includes("heliumbp")){
    return {
      check:"Backside He pressure/flow, wafer seating, ESC 접촉 및 leak 가능성 확인",
      action:"He 공급 안정화 → chuck 접촉/실링 상태 확인 → 동일 조건 재현 시 trend 재비교"
    };
  }
  if(p.includes("sourcerfreflected")){
    return {
      check:"Source RF reflected power와 matching capacitor 동작을 함께 확인",
      action:"RF matching 상태와 chamber condition을 점검하고 reflected power spike 구간을 추적"
    };
  }
  if(p.includes("platenrf") || p.includes("bias")){
    return {
      check:"Platen RF load / tuning / bias 전달 상태와 matching 변화 확인",
      action:"RF 전달 경로와 matching capacitor 변동을 점검하고 정상 wafer와 시간축 비교"
    };
  }
  if(p.includes("forelinepressure")){
    return {
      check:"Foreline pressure, throttle/pump 상태, chamber pressure 동조 여부 확인",
      action:"배기계·throttle valve·pump 상태를 점검하고 pressure 안정화 구간을 비교"
    };
  }
  if(p.includes("pressure")){
    return {
      check:"챔버 압력 setpoint 대비 actual 안정성, throttle response, gas flow 연동 확인",
      action:"압력 제어 loop와 gas supply를 점검하고 변동이 큰 공정 구간을 우선 확인"
    };
  }
  if(p.includes("heater") || p.includes("temp")){
    return {
      check:"Heater/wafer 온도 안정화 시간과 wafer-to-wafer thermal drift 확인",
      action:"warm-up 및 온도 안정화 조건을 확인하고 센서 offset/calibration 여부를 점검"
    };
  }
  if(p.includes("gas") || p.includes("flow")){
    return {
      check:"MFC actual vs setpoint, 공급 압력, valve response 및 유량 안정성 확인",
      action:"MFC 응답과 공급 라인을 점검하고 같은 Lot 정상 wafer와 공정 구간별 flow를 비교"
    };
  }
  if(p.includes("capacitor")){
    return {
      check:"RF matching capacitor 위치/변동과 reflected power를 함께 확인",
      action:"matching network 상태를 점검하고 정상 wafer 대비 capacitor trajectory를 비교"
    };
  }

  return {
    check:"동일 Lot 정상 wafer 대비 해당 parameter의 시간축 편차와 변화 시점 확인",
    action:"편차가 시작되는 공정 구간을 좁힌 뒤 연관 센서와 함께 재현 여부를 확인"
  };
}

function rcSolutionPanel(d){
  const rows=(d.combined_candidates||d.process_candidates||[]).slice(0,3);
  if(!rows.length) return "";

  return `
  <div class="rc-solution-panel">
    <div class="rc-solution-head">
      <div>
        <span class="eyebrow">RECOMMENDED ACTIONS</span>
        <h3>권장 점검 및 대응</h3>
      </div>
      <span class="badge">상위 ${rows.length}개 후보</span>
    </div>
    <div class="rc-solution-list">
      ${rows.map((x,i)=>{
        const a=rcActionForCandidate(x);
        return `
        <div class="rc-solution-item">
          <div class="rc-solution-rank">${i+1}</div>
          <div>
            <strong>${esc(x.parameter)}</strong>
            <span><b>확인</b>${esc(a.check)}</span>
            <span><b>대응</b>${esc(a.action)}</span>
          </div>
        </div>`;
      }).join("")}
    </div>
    <div class="rc-solution-note">
      위 내용은 원인 확정이 아니라 <b>점검 우선순위와 대응 후보</b>입니다.
      실제 조치 전에는 동일 Lot 정상 wafer와 시간축 Process/OES 비교로 재확인하세요.
    </div>
  </div>`;
}

function rcHtml162(d){
 const rows=d.combined_candidates||d.process_candidates||[];
 const source=d.backend_source||"unknown";

 if(!rows.length){
   return `
   <div class="rc-header">
     <div><span class="eyebrow">ROOT CAUSE REVIEW</span><h3>원인 후보 파라미터</h3></div>
     <span class="badge">${d.baseline?.peer_count??0}개 peer</span>
   </div>
   <div class="rc-empty">
     <strong>비교 가능한 Process 후보가 없습니다.</strong>
     <span>분석 소스: ${esc(source)}</span>
     ${(d.warnings||[]).map(x=>`<small>${esc(x)}</small>`).join("")}
   </div>
   <div class="rc-disclaimer">${esc(d.disclaimer||"")}</div>`;
 }

 return `
 <div class="rc-header">
   <div><span class="eyebrow">ROOT CAUSE REVIEW</span><h3>원인 후보 파라미터</h3></div>
   <span class="badge">${d.baseline?.peer_count??0}개 peer</span>
 </div>

 <div class="rc-source-note">분석 소스 · ${esc(source)}</div>

 <div class="rc-scroll-shell">
   <div class="rc-list">${rows.slice(0,10).map(rcRow).join("")}</div>
 </div>

 <div class="rc-list-footer">
   <span>후보 ${Math.min(rows.length,10)}개 표시</span>
   <span>목록 안에서 스크롤</span>
 </div>

 ${!d.include_oes
   ? `<button class="rc-oes-button" id="loadRootCauseOes">OES 후보도 함께 분석</button>`
   : `<div class="rc-oes-loaded">OES 후보 포함 완료</div>`}

 ${(d.warnings||[]).length
   ? `<div class="rc-warning">${d.warnings.map(esc).join("<br>")}</div>`
   : ""}

 ${rcSolutionPanel(d)}

 <div class="rc-disclaimer">${esc(d.disclaimer||"")}</div>`;
}

async function loadRootCauseStudio162(includeOes=false){
 const slot=$("rootCauseStudio");
 if(!slot)return;

 slot.innerHTML=`<div class="rc-loading">${includeOes?"Process + OES":"Process"} 원인 후보 계산 중...</div>`;

 try{
   const d=await api(`/api/v1/root-cause/${encodeURIComponent(S.exp)}?include_oes=${includeOes?"true":"false"}`);
   slot.innerHTML=rcHtml162(d);
   const b=$("loadRootCauseOes");
   if(b)b.onclick=()=>loadRootCauseStudio162(true);
 }catch(e){
   slot.innerHTML=`
   <div class="rc-empty rc-error-detail">
     <strong>원인 후보 분석 API 오류</strong>
     <span>${esc(e.message||String(e))}</span>
   </div>`;
 }
}

loadRootCauseStudio=loadRootCauseStudio162;
/* === ROOT CAUSE UX v1.6.2 END === */

/* === ROOT CAUSE LAYOUT + SPEED v1.6.3 START === */
const ROOT_CAUSE_RESPONSE_CACHE_163 = new Map();

function rcCandidateCount163(d){
  const rows=d.combined_candidates||d.process_candidates||[];
  return rows.length;
}

function rcHtml163(d){
  const rows=d.combined_candidates||d.process_candidates||[];
  const source=d.backend_source||"unknown";
  const candidateCount=rcCandidateCount163(d);

  if(!rows.length){
    return `
    <div class="rc-header">
      <div>
        <span class="eyebrow">ROOT CAUSE REVIEW</span>
        <h3>원인 후보 파라미터</h3>
      </div>
      <span class="badge">0개 후보</span>
    </div>
    <div class="rc-empty">
      <strong>비교 가능한 Process 후보가 없습니다.</strong>
      <span>분석 소스: ${esc(source)}</span>
      ${(d.warnings||[]).map(x=>`<small>${esc(x)}</small>`).join("")}
    </div>`;
  }

  return `
  <div class="rc-header rc-main-header">
    <div>
      <span class="eyebrow">ROOT CAUSE REVIEW</span>
      <h3>원인 후보 및 권장 대응</h3>
    </div>
    <span class="badge">${candidateCount}개 후보</span>
  </div>

  <div class="rc-source-note">분석 소스 · ${esc(source)}</div>

  <div class="rc-workspace">
    <section class="rc-candidate-column">
      <div class="rc-subhead">
        <div>
          <strong>원인 후보 파라미터</strong>
          <span>동일 Lot 대비 편차가 큰 순서</span>
        </div>
        <small>${candidateCount}개</small>
      </div>

      <div class="rc-scroll-shell rc-scroll-shell-163">
        <div class="rc-list">${rows.slice(0,10).map(rcRow).join("")}</div>
      </div>

      <div class="rc-list-footer">
        <span>후보 ${Math.min(candidateCount,10)}개 표시</span>
        <span>목록 안에서 스크롤</span>
      </div>

      ${!d.include_oes
        ? `<button class="rc-oes-button" id="loadRootCauseOes">OES 후보도 함께 분석</button>`
        : `<div class="rc-oes-loaded">OES 후보 포함 완료</div>`}

      ${(d.warnings||[]).length
        ? `<div class="rc-warning">${d.warnings.map(esc).join("<br>")}</div>`
        : ""}
    </section>

    <section class="rc-solution-column">
      ${rcSolutionPanel(d)}
    </section>
  </div>

  <div class="rc-disclaimer">${esc(d.disclaimer||"")}</div>`;
}

async function loadRootCauseStudio163(includeOes=false){
  const slot=$("rootCauseStudio");
  if(!slot)return;

  const key=`${S.exp}|${includeOes?"oes":"process"}`;

  if(ROOT_CAUSE_RESPONSE_CACHE_163.has(key)){
    const d=ROOT_CAUSE_RESPONSE_CACHE_163.get(key);
    slot.innerHTML=rcHtml163(d);
    const cachedBtn=$("loadRootCauseOes");
    if(cachedBtn)cachedBtn.onclick=()=>loadRootCauseStudio163(true);
    return d;
  }

  slot.innerHTML=`
    <div class="rc-loading">
      ${includeOes?"Process + OES":"Process"} 원인 후보 계산 중...
    </div>`;

  try{
    const d=await api(
      `/api/v1/root-cause/${encodeURIComponent(S.exp)}?include_oes=${includeOes?"true":"false"}`
    );

    ROOT_CAUSE_RESPONSE_CACHE_163.set(key,d);
    slot.innerHTML=rcHtml163(d);

    const b=$("loadRootCauseOes");
    if(b)b.onclick=()=>loadRootCauseStudio163(true);

    return d;
  }catch(e){
    slot.innerHTML=`
    <div class="rc-empty rc-error-detail">
      <strong>원인 후보 분석 API 오류</strong>
      <span>${esc(e.message||String(e))}</span>
    </div>`;
    throw e;
  }
}

loadRootCauseStudio=loadRootCauseStudio163;
/* === ROOT CAUSE LAYOUT + SPEED v1.6.3 END === */

/* === EPA BRAND v1.7.1 START === */
function epaLogoSvg171(){
 return `
 <svg viewBox="0 0 72 72" aria-hidden="true" focusable="false">
   <defs>
     <linearGradient id="epaG1" x1="10" y1="8" x2="60" y2="62" gradientUnits="userSpaceOnUse">
       <stop offset="0" stop-color="#163F68"/>
       <stop offset=".52" stop-color="#2C78B8"/>
       <stop offset="1" stop-color="#78A9D4"/>
     </linearGradient>
     <linearGradient id="epaG2" x1="60" y1="10" x2="18" y2="62" gradientUnits="userSpaceOnUse">
       <stop offset="0" stop-color="#9AC0E1"/>
       <stop offset="1" stop-color="#3B78AC"/>
     </linearGradient>
   </defs>

   <g transform="translate(36 36)">
     <path d="M0-27 23-14 23 12 0 25-23 12-23-14Z"
           fill="none" stroke="url(#epaG1)" stroke-width="5.2"
           stroke-linejoin="round"/>

     <path d="M-13-10 0-17 13-10 13 5 0 12-13 5Z"
           fill="none" stroke="url(#epaG2)" stroke-width="4.2"
           stroke-linejoin="round"/>

     <path d="M-23 12-8 4 0 9 0 25Z" fill="#1E5B8D"/>
     <path d="M23 12 8 4 0 9 0 25Z" fill="#6FA4D0"/>

     <path d="M-4-20 0-23 4-20 4 6 0 9-4 6Z"
           fill="#FFFFFF"/>

     <circle cx="0" cy="-3" r="3.2" fill="#2B73B7"/>
   </g>
 </svg>`;
}

function applyEpaBrand171(){
 const brand=document.querySelector(".brand");
 if(brand){
   brand.innerHTML=`
     <div class="brand-mark epa-brand-mark">${epaLogoSvg171()}</div>
     <div class="epa-brand-copy">
       <b>EPA</b>
       <small>ETCH PROCESS ANALYSIS</small>
     </div>`;
 }

 document.title="EPA · Etch Process Analysis";

 document.querySelectorAll("h1,h2,.brand-title,.app-title").forEach(el=>{
   const t=(el.textContent||"").trim();
   if(t==="BOSCH ETCH INTELLIGENCE" || t==="BOSCH Etch Intelligence"){
     el.textContent="Etch Process Analysis";
   }
 });
}

function migrateLegacyVm171(){
 if(S.page==="vm" || S.page==="prediction"){
   S.page="overview";
 }
}

function initEpa171(){
 migrateLegacyVm171();
 applyEpaBrand171();
}

if(document.readyState==="loading"){
 document.addEventListener("DOMContentLoaded",initEpa171,{once:true});
}else{
 initEpa171();
}
/* === EPA BRAND v1.7.1 END === */
