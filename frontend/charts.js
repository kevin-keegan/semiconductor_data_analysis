export const fmt=(v,d=3)=>Number.isFinite(Number(v))?Number(v).toFixed(d):"—";
export const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

function extent(a,p=.08){
  const v=a.map(Number).filter(Number.isFinite);
  if(!v.length)return[0,1];
  let lo=Math.min(...v),hi=Math.max(...v);
  if(lo===hi){lo-=1;hi+=1}
  const d=(hi-lo)*p;return[lo-d,hi+d];
}

export function lineChart(el,x,y,{xLabel="",yLabel=""}={}){
  const pts=x.map((v,i)=>[Number(v),Number(y[i])]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(!pts.length){el.innerHTML='<div class="empty">No numeric data</div>';return}
  const W=760,H=300,M={l:62,r:18,t:16,b:42},xr=extent(pts.map(p=>p[0])),yr=extent(pts.map(p=>p[1]));
  const sx=v=>M.l+(v-xr[0])/(xr[1]-xr[0])*(W-M.l-M.r);
  const sy=v=>H-M.b-(v-yr[0])/(yr[1]-yr[0])*(H-M.t-M.b);
  const path=pts.map((p,i)=>`${i?"L":"M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(" ");
  let grid="";
  for(let i=0;i<5;i++){const yy=M.t+i*(H-M.t-M.b)/4,val=yr[1]-i*(yr[1]-yr[0])/4;grid+=`<line class="grid-line" x1="${M.l}" y1="${yy}" x2="${W-M.r}" y2="${yy}"/><text class="tick" x="${M.l-8}" y="${yy+3}" text-anchor="end">${fmt(val,2)}</text>`}
  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}">${grid}<path class="series" d="${path}"/><text class="tick" x="${W/2}" y="${H-7}" text-anchor="middle">${esc(xLabel)}</text><text class="tick" transform="translate(14 ${H/2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text></svg>`;
}

export function table(rows,cols){
  if(!rows?.length)return'<div class="empty">No rows</div>';
  return `<div class="table-wrap"><table><thead><tr>${cols.map(c=>`<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${esc(c.value?c.value(r):(r[c.key]??"—"))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
