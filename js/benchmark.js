// ── benchmark.js ─────────────────────────────────────────────────────
// Tracks your portfolio's daily value against two benchmarks:
//   • ASX 200 — proxied by STW (SPDR S&P/ASX 200 ETF), fetched through
//     the same Cloudflare Worker as your regular ASX holdings, since
//     there's no public CORS-friendly feed for the raw index itself.
//     STW tracks the index closely and, as a real investable fund, is
//     arguably a more honest comparison than the bare index anyway.
//   • BTC-AUD — via the same CoinGecko endpoint already used for crypto
//     holdings, so no worker dependency for this half.
//
// Like the existing portfolio-value history, this only starts recording
// from the day it's added — there's no way to backfill benchmark prices
// for dates before this feature existed, so don't expect history before
// today. Storage: localStorage key pt_benchmarks, {date: {stw, btc}}.

let benchmarkHistory = (()=>{
  try{ return JSON.parse(localStorage.getItem('pt_benchmarks')||'{}'); }
  catch(e){ return {}; }
})();
function saveBenchmarkHistory(){
  localStorage.setItem('pt_benchmarks', JSON.stringify(benchmarkHistory));
}

async function snapshotBenchmarks(){
  const today = new Date().toISOString().slice(0,10);
  let stw = null, btc = null;

  try{
    if(typeof fetchASXPrices === 'function'){
      const res = await fetchASXPrices(['STW']);
      if(res && res.STW) stw = res.STW;
    }
  }catch(e){ console.warn('Benchmark STW fetch failed:', e); }

  try{
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=aud');
    const d = await r.json();
    if(d?.bitcoin?.aud) btc = d.bitcoin.aud;
  }catch(e){ console.warn('Benchmark BTC fetch failed:', e); }

  if(stw == null && btc == null) return; // both failed — don't write a half-empty/misleading day
  benchmarkHistory[today] = { ...(benchmarkHistory[today]||{}), ...(stw!=null?{stw}:{}) , ...(btc!=null?{btc}:{}) };
  saveBenchmarkHistory();
}

let _bmChart = null;
function renderBenchmarkSection(){
  const el = document.getElementById('bm-body');
  if(!el) return;

  const bmDates = Object.keys(benchmarkHistory).sort();
  if(bmDates.length < 2){
    el.innerHTML = `<div style="color:var(--text3);font-size:12px">
      Tracking starts from your next price refresh — come back after a couple of days to see the comparison
      (${bmDates.length===0?'no days recorded yet':'1 day recorded so far'}).
    </div>`;
    return;
  }

  const pfDates = typeof pfSnapshots !== 'undefined' ? Object.keys(pfSnapshots) : [];
  const commonDates = bmDates.filter(d => pfDates.includes(d) && pfSnapshots[d].all != null);
  if(commonDates.length < 2){
    el.innerHTML = `<div style="color:var(--text3);font-size:12px">Not enough overlapping days between portfolio and benchmark history yet.</div>`;
    return;
  }

  const base = commonDates[0];
  const pfBase = pfSnapshots[base].all;
  const stwBase = benchmarkHistory[base]?.stw;
  const btcBase = benchmarkHistory[base]?.btc;

  const pfSeries = commonDates.map(d => pfBase ? (pfSnapshots[d].all/pfBase*100) : null);
  const stwSeries = stwBase ? commonDates.map(d => benchmarkHistory[d]?.stw!=null ? (benchmarkHistory[d].stw/stwBase*100) : null) : null;
  const btcSeries = btcBase ? commonDates.map(d => benchmarkHistory[d]?.btc!=null ? (benchmarkHistory[d].btc/btcBase*100) : null) : null;

  el.innerHTML = `<div style="height:240px"><canvas id="bm-chart"></canvas></div>
    <div style="font-size:11px;color:var(--text3);margin-top:8px">All series rebased to 100 on ${base} (first day both were tracked). ASX 200 proxied by STW (SPDR S&P/ASX 200 ETF).</div>`;

  if(_bmChart){ _bmChart.destroy(); _bmChart = null; }
  const ctx = document.getElementById('bm-chart');
  if(!ctx || typeof Chart === 'undefined') return;

  const datasets = [{ label:'Portfolio', data:pfSeries, borderColor:'#8b5cf6', backgroundColor:'transparent', pointRadius:0, tension:0.2 }];
  if(stwSeries) datasets.push({ label:'ASX 200 (STW)', data:stwSeries, borderColor:'#22d3ee', backgroundColor:'transparent', pointRadius:0, tension:0.2 });
  if(btcSeries) datasets.push({ label:'BTC', data:btcSeries, borderColor:'#fbbf24', backgroundColor:'transparent', pointRadius:0, tension:0.2 });

  _bmChart = new Chart(ctx, {
    type:'line',
    data:{ labels:commonDates, datasets },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ color:'#a5a8ae', font:{size:11} } } },
      scales:{
        x:{ ticks:{ color:'#65686f', maxTicksLimit:8 }, grid:{ color:'rgba(255,255,255,0.04)' } },
        y:{ ticks:{ color:'#65686f', callback:v=>v.toFixed(0) }, grid:{ color:'rgba(255,255,255,0.04)' } },
      },
    },
  });
}
