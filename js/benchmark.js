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

  // Keep raw (non-rebased) forward-filled values per date — the slider
  // below re-rebases to 100 fresh for whichever 12-month window is in
  // view, so we need the underlying numbers, not one fixed rebasing.
  const dates = pfDates;
  const pfRaw = {};
  dates.forEach(d => { pfRaw[d] = pfSnapshots[d].all; });

  function buildRawSeries(key){
    const raw = {};
    let lastVal = null;
    dates.forEach(d => {
      const v = benchmarkHistory[d]?.[key];
      if(v != null) lastVal = v;
      if(lastVal != null) raw[d] = lastVal; // forward-filled from last real reading; never fabricated between two real points
    });
    return raw;
  }
  const stwRaw = buildRawSeries('stw');
  const btcRaw = buildRawSeries('btc');

  if(!Object.keys(stwRaw).length && !Object.keys(btcRaw).length){
    el.innerHTML = `<div style="color:var(--text3);font-size:12px">No overlapping benchmark data yet — check back after the next 5pm snapshot.</div>`;
    return;
  }

  ensureBmSliderStyle();

  // ── 12-month rolling window with a scrollbar to pan through history ──
  // The slider's value is an index into `dates`; that date is the window's
  // right edge, and the left edge is whichever real portfolio date falls
  // ~12 calendar months earlier (dates are irregular, especially pre-
  // 2025-07-01, so this is a calendar-based walk-back, not a fixed count
  // of points). Each window re-rebases every series to 100 at its own
  // start, so scrolling shows "return over this particular year" rather
  // than one long since-inception line. Still real data only — forward-
  // filled as above, never interpolated between two actual readings.
  const WINDOW_MONTHS = 12;
  const spanMs = new Date(dates[dates.length-1]+'T00:00:00') - new Date(dates[0]+'T00:00:00');
  const hasFullWindow = spanMs >= WINDOW_MONTHS*29*86400000; // ~29 days/mo floor, safely under calendar 12mo

  function windowStartIdx(endIdx){
    const startDate = new Date(dates[endIdx]+'T00:00:00');
    startDate.setMonth(startDate.getMonth()-WINDOW_MONTHS);
    let i = endIdx;
    while(i > 0 && new Date(dates[i-1]+'T00:00:00') >= startDate) i--;
    return i;
  }
  function firstAvailable(raw, winDates){
    for(const d of winDates){ if(raw[d] != null) return raw[d]; }
    return null;
  }

  el.innerHTML = `
    <div style="height:240px"><canvas id="bm-chart"></canvas></div>
    <div id="bm-slider-wrap" style="display:flex;align-items:center;gap:10px;margin-top:12px">
      <input type="range" id="bm-slider" class="bm-range" min="0" max="${dates.length-1}" step="1" value="${dates.length-1}" style="flex:1">
    </div>
    <div id="bm-window-label" style="font-size:11px;color:var(--text2);margin-top:6px;text-align:center;font-family:var(--mono)"></div>
    <div style="font-size:11px;color:var(--text3);margin-top:6px">Each window rebased to 100 at its own start${hasFullWindow?' — drag the slider to scroll through history':''}. ASX 200 proxied by STW (SPDR S&P/ASX 200 ETF).</div>`;

  const sliderWrap = document.getElementById('bm-slider-wrap');
  const slider = document.getElementById('bm-slider');
  const label = document.getElementById('bm-window-label');
  if(!hasFullWindow){ sliderWrap.style.display = 'none'; }

  if(_bmChart){ _bmChart.destroy(); _bmChart = null; }
  const ctx = document.getElementById('bm-chart');
  if(!ctx || typeof Chart === 'undefined') return;

  function renderWindow(endIdx){
    const startIdx = hasFullWindow ? windowStartIdx(endIdx) : 0;
    const winDates = dates.slice(startIdx, endIdx+1);

    const pfBase = pfRaw[winDates[0]];
    const pfSeries = winDates.map(d => pfBase ? (pfRaw[d]/pfBase*100) : null);
    const stwBase = firstAvailable(stwRaw, winDates);
    const btcBase = firstAvailable(btcRaw, winDates);
    const stwSeries = stwBase != null ? winDates.map(d => stwRaw[d] != null ? (stwRaw[d]/stwBase*100) : null) : null;
    const btcSeries = btcBase != null ? winDates.map(d => btcRaw[d] != null ? (btcRaw[d]/btcBase*100) : null) : null;

    label.textContent = winDates.length > 1 ? `${winDates[0]}  →  ${winDates[winDates.length-1]}` : winDates[0];

    const datasets = [{ label:'Portfolio', data:pfSeries, borderColor:'#8b5cf6', backgroundColor:'transparent', pointRadius:0, tension:0.2 }];
    if(stwSeries) datasets.push({ label:'ASX 200 (STW)', data:stwSeries, borderColor:'#22d3ee', backgroundColor:'transparent', pointRadius:0, tension:0.2 });
    if(btcSeries) datasets.push({ label:'BTC', data:btcSeries, borderColor:'#fbbf24', backgroundColor:'transparent', pointRadius:0, tension:0.2 });

    if(_bmChart){
      _bmChart.data.labels = winDates;
      _bmChart.data.datasets = datasets;
      _bmChart.update('none'); // 'none' = skip animation, keeps dragging responsive
    } else {
      _bmChart = new Chart(ctx, {
        type:'line',
        data:{ labels:winDates, datasets },
        options:{
          responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{ labels:{ color:'#a5a8ae', font:{size:11} } } },
          scales:{
            // No min/max set on either axis, so both auto-rescale to
            // whatever is actually visible in the current window.
            x:{ ticks:{ color:'#65686f', maxTicksLimit:8 }, grid:{ color:'rgba(255,255,255,0.04)' } },
            y:{ ticks:{ color:'#65686f', callback:v=>v.toFixed(0) }, grid:{ color:'rgba(255,255,255,0.04)' } },
          },
        },
      });
    }
  }

  renderWindow(dates.length-1); // default: latest 12-month window
  slider.addEventListener('input', () => renderWindow(+slider.value));
}

// One-off style injection for the scrollbar, themed to match the app —
// only added once even though renderBenchmarkSection can rebuild #bm-body
// (and its own inline styles) many times over a session.
function ensureBmSliderStyle(){
  if(document.getElementById('bm-range-style')) return;
  const style = document.createElement('style');
  style.id = 'bm-range-style';
  style.textContent = `
    .bm-range{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:2px;background:var(--border2);outline:none;cursor:pointer;}
    .bm-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:var(--violet);cursor:pointer;box-shadow:0 0 0 3px rgba(139,92,246,0.25);}
    .bm-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--violet);border:none;cursor:pointer;box-shadow:0 0 0 3px rgba(139,92,246,0.25);}
    .bm-range::-moz-range-track{background:var(--border2);height:4px;border-radius:2px;}
  `;
  document.head.appendChild(style);
}