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
// Two ways benchmark days get filled in:
//   1. snapshotBenchmarks() — an immediate client-side fetch, used to show
//      today's value right away without waiting on the cron/backfill.
//   2. backfillBenchmarkHistory() below — pulls whatever the Worker's 5pm
//      Cron Trigger recorded for STW.AX/bitcoin on days you never opened
//      the app, from the same ?priceHistory=1 endpoint and KV blob that
//      backfillPortfolioHistory() (prices.js) already reads. The Worker's
//      cron and full-history backfill now always include STW/bitcoin
//      (see BENCHMARK_ASX_SYMS/BENCHMARK_CRYPTO_IDS in the worker code),
//      independent of whether you actually hold them — so a month away
//      from the app no longer leaves a gap in this chart, and running
//      Settings → RUN BACKFILL also pulls STW/BTC's full history back to
//      2018, the same as any real holding.
// Storage: localStorage key pt_benchmarks, {date: {stw, btc}}.

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

// ── Backfill missed benchmark days ────────────────────────────────────
// Same shape as backfillPortfolioHistory() in prices.js: ask the Worker
// for everything it has recorded since the day after our latest known
// benchmark date, and fill in whatever comes back. Because the Worker's
// cron/backfill now always fetch STW.AX + bitcoin (regardless of your
// actual holdings), this recovers every day you didn't have the app open
// — not just a start/end comparison. Throttled to once per calendar day
// (same guard style as the portfolio backfill); pass forceSince to bypass
// it, e.g. after a manual full backfill.
async function backfillBenchmarkHistory(forceSince){
  const workerURL = typeof getWorkerURL === 'function' ? getWorkerURL() : (localStorage.getItem('cf_worker_url')||'');
  if(!workerURL) return;

  const todayStr = typeof localDateStr === 'function' ? localDateStr() : new Date().toISOString().slice(0,10);
  if(!forceSince && localStorage.getItem('pt_bm_backfill_date') === todayStr) return;

  const knownDates = Object.keys(benchmarkHistory).sort();
  let since = forceSince || '1970-01-01';
  if(!forceSince && knownDates.length){
    const dayAfterLast = new Date(knownDates[knownDates.length-1]+'T00:00:00');
    dayAfterLast.setDate(dayAfterLast.getDate()+1);
    since = dayAfterLast.toISOString().slice(0,10);
  }

  let history;
  try{
    const r = await fetch(`${workerURL}?priceHistory=1&since=${since}`);
    if(!r.ok) return;
    history = await r.json();
  }catch(e){ console.warn('Benchmark backfill fetch failed:', e); return; }

  let filled = 0;
  for(const dateKey of Object.keys(history)){
    const dayPrices = history[dateKey];
    if(!dayPrices || typeof dayPrices !== 'object') continue;
    const stw = dayPrices['STW.AX'];
    const btc = dayPrices['bitcoin'];
    if(stw == null && btc == null) continue;
    benchmarkHistory[dateKey] = {
      ...(benchmarkHistory[dateKey]||{}),
      ...(stw!=null ? {stw:+stw} : {}),
      ...(btc!=null ? {btc:+btc} : {}),
    };
    filled++;
  }

  if(filled){
    saveBenchmarkHistory();
    if(typeof renderBenchmarkSection === 'function') renderBenchmarkSection();
  }
  localStorage.setItem('pt_bm_backfill_date', todayStr);
}

let _bmChart = null;
function renderBenchmarkSection(){
  const el = document.getElementById('bm-body');
  if(!el) return;

  const bmDates = Object.keys(benchmarkHistory).sort();
  if(bmDates.length < 2){
    el.innerHTML = `<div style="color:var(--text3);font-size:12px">
      Not enough benchmark history yet to chart a comparison
      (${bmDates.length===0?'no days recorded yet':'1 day recorded so far'}) —
      it fills in from the Worker's daily 5pm snapshot even on days you don't open the app,
      so this should catch up on its own soon.
    </div>`;
    return;
  }

  const pfDates = typeof pfSnapshots !== 'undefined'
    ? Object.keys(pfSnapshots).filter(d => pfSnapshots[d].all != null).sort()
    : [];
  if(pfDates.length < 2){
    el.innerHTML = `<div style="color:var(--text3);font-size:12px">Not enough portfolio history yet to compare against.</div>`;
    return;
  }

  // Use the portfolio's own dates as the chart's x-axis. pfSnapshots.all is
  // set whenever ANY held symbol has a price that day, unioned across every
  // symbol's own independent anchor dates — so it's much denser than either
  // benchmark's own fortnightly anchor dates (pre-2025-07-01). Requiring an
  // EXACT date match between the two (the old approach) meant real STW/BTC
  // data almost never lined up with a portfolio date, producing long false
  // "gaps" — and if the very first shared date happened to lack one
  // benchmark's value, that whole series silently vanished.
  //
  // Instead: each series is rebased to its own first real reading (not a
  // shared date), and benchmark values are forward-filled onto the
  // portfolio's dates from their last actual reading — a standard step-chart
  // convention, never interpolating or inventing a value between two real
  // points, just holding the last known one until a newer real price arrives.
  const dates = pfDates;
  const pfBase = pfSnapshots[dates[0]].all;
  const pfSeries = dates.map(d => pfBase ? (pfSnapshots[d].all/pfBase*100) : null);

  function buildBenchSeries(key){
    let lastVal = null;
    const filled = dates.map(d => {
      const v = benchmarkHistory[d]?.[key];
      if(v != null) lastVal = v;
      return lastVal; // null until the first real reading, then forward-filled
    });
    const firstIdx = filled.findIndex(v => v != null);
    if(firstIdx === -1) return null;
    const baseVal = filled[firstIdx];
    return filled.map((v,i) => (i < firstIdx || v == null) ? null : (v/baseVal*100));
  }
  const stwSeries = buildBenchSeries('stw');
  const btcSeries = buildBenchSeries('btc');

  if(!stwSeries && !btcSeries){
    el.innerHTML = `<div style="color:var(--text3);font-size:12px">No overlapping benchmark data yet — check back after the next 5pm snapshot.</div>`;
    return;
  }

  el.innerHTML = `<div style="height:240px"><canvas id="bm-chart"></canvas></div>
    <div style="font-size:11px;color:var(--text3);margin-top:8px">Portfolio rebased to 100 on ${dates[0]}; ASX 200/BTC each rebased to 100 on their own first tracked day and forward-filled between real price readings. ASX 200 proxied by STW (SPDR S&P/ASX 200 ETF).</div>`;

  if(_bmChart){ _bmChart.destroy(); _bmChart = null; }
  const ctx = document.getElementById('bm-chart');
  if(!ctx || typeof Chart === 'undefined') return;

  const datasets = [{ label:'Portfolio', data:pfSeries, borderColor:'#8b5cf6', backgroundColor:'transparent', pointRadius:0, tension:0.2 }];
  if(stwSeries) datasets.push({ label:'ASX 200 (STW)', data:stwSeries, borderColor:'#22d3ee', backgroundColor:'transparent', pointRadius:0, tension:0.2 });
  if(btcSeries) datasets.push({ label:'BTC', data:btcSeries, borderColor:'#fbbf24', backgroundColor:'transparent', pointRadius:0, tension:0.2 });

  _bmChart = new Chart(ctx, {
    type:'line',
    data:{ labels:dates, datasets },
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