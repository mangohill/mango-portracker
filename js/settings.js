// ── settings.js ─────────────────────────────────────────────

// ── PRICE DROP ALERTS ────────────────────────────────────────────────
// Flags, on the main Portfolio page, any monitored holding whose current
// price has fallen more than a set % below the highest price you've ever
// personally paid for it. Only counts deliberate 'buy' trades toward that
// highest price — DRP reinvestments and corporate-action conversions
// aren't a buying decision, so they'd distort what "your highest buy"
// actually means. Each monitored symbol has its OWN threshold (crypto
// swings far more than an LIC, so one shared % rarely fits both) — config
// is a {symbol: thresholdPct} map, not a flat list. Config lives in
// localStorage; the check itself runs inside renderH() (portfolio.js) so
// the dashboard banner always reflects the latest prices/holdings without
// a separate polling loop.
const PA_DEFAULT_THRESHOLD = 2;
function loadPriceAlertSettings(){
  try{
    const raw = JSON.parse(localStorage.getItem('pt_price_alerts'));
    const symbols = (raw && raw.symbols && typeof raw.symbols==='object' && !Array.isArray(raw.symbols)) ? raw.symbols : {};
    return { enabled: !!(raw&&raw.enabled), symbols };
  }catch(e){ return { enabled:false, symbols:{} }; }
}
function paApplyEnabledVisual(enabled){
  const wrap = $('pa-monitor-wrap'), hint = $('pa-disabled-hint');
  // Dim only — deliberately NOT pointer-events:none, since the hint text
  // says selections are still saved while off, so you should still be
  // able to set them up in advance before flipping Enabled on.
  if(wrap) wrap.style.opacity = enabled ? '1' : '0.45';
  if(hint) hint.style.display = enabled ? 'none' : '';
}
function savePriceAlertSettings(){
  const enabled = $('pa-enabled') ? $('pa-enabled').checked : false;
  paApplyEnabledVisual(enabled);
  const symbols = {};
  document.querySelectorAll('#pa-symbol-list .pa-row').forEach(row=>{
    const cb = row.querySelector('.pa-sym-cb');
    const num = row.querySelector('.pa-sym-threshold');
    const on = !!(cb && cb.checked);
    if(num) num.disabled = !on; // live-toggle without a full re-render
    if(on) symbols[cb.dataset.sym] = Math.max(0.1, +(num&&num.value) || PA_DEFAULT_THRESHOLD);
  });
  localStorage.setItem('pt_price_alerts', JSON.stringify({ enabled, symbols }));
  if(typeof renderH === 'function') renderH(); // refresh the dashboard banner immediately
}
function renderPriceAlertSettings(){
  const list = $('pa-symbol-list');
  if(!list) return;
  const cfg = loadPriceAlertSettings();
  if($('pa-enabled')) $('pa-enabled').checked = cfg.enabled;
  paApplyEnabledVisual(cfg.enabled);
  const heldSymbols = [...new Set(calcH().filter(h=>Math.abs(h.units)>1e-9).map(h=>h.symbol))].sort();
  list.innerHTML = heldSymbols.length ? heldSymbols.map(sym=>{
    const isOn = Object.prototype.hasOwnProperty.call(cfg.symbols, sym);
    const t = isOn ? cfg.symbols[sym] : PA_DEFAULT_THRESHOLD;
    return `<div class="pa-row" style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
      <label style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;cursor:pointer;font-size:12px;color:var(--text2)">
        <input type="checkbox" class="pa-sym-cb" data-sym="${escHtml(sym)}" ${isOn?'checked':''} onchange="savePriceAlertSettings()">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(displaySymbol(sym))}</span>
      </label>
      <input class="fi pa-sym-threshold" type="number" min="0.1" max="90" step="0.1" value="${t}" ${isOn?'':'disabled'} style="width:56px;padding:4px 6px;font-size:11px;flex-shrink:0;text-align:right" oninput="savePriceAlertSettings()">
      <span style="font-size:10px;color:var(--text3);flex-shrink:0;width:8px">%</span>
    </div>`;
  }).join('') : `<div style="color:var(--text3);font-size:12px">No holdings yet.</div>`;
}

function saveCFUrl(){
  const url = $('cf-url').value.trim().replace(/\/$/,'');
  if(!url){ notify('Paste your worker URL first.','err'); return; }
  localStorage.setItem('cf_worker_url', url);
  $('cf-status').textContent = '✓ Worker URL saved. Click ↻ PRICES to test.';
  $('cf-status').style.color = 'var(--green)';
  notify('Worker URL saved ✓');
}
async function testWorker(){
  const url = $('cf-url').value.trim().replace(/\/$/,'') || getWorkerURL();
  if(!url){ notify('Enter your worker URL first.','err'); return; }
  $('cf-status').textContent = 'Testing…';
  $('cf-status').style.color = 'var(--text3)';
  try{
    const r = await fetch(`${url}?symbols=DHHF.AX`);
    if(!r.ok){ throw new Error('HTTP '+r.status); }
    const d = await r.json();
    const price = d['DHHF.AX'];
    if(price){
      $('cf-status').textContent = `✓ Working! DHHF = $${price}`;
      $('cf-status').style.color = 'var(--green)';
      notify('Worker is working! DHHF = $'+price,'ok');
    } else {
      $('cf-status').textContent = 'Worker responded but no price returned — ASX may be closed.';
      $('cf-status').style.color = 'var(--gold)';
    }
  }catch(e){
    $('cf-status').textContent = 'Error: '+e.message;
    $('cf-status').style.color = 'var(--red)';
    notify('Worker test failed: '+e.message,'err');
  }
}
function loadCFUrl(){
  const url = getWorkerURL();
  if(url){
    $('cf-url').value = url;
    $('cf-status').textContent = '✓ Worker URL loaded';
    $('cf-status').style.color = 'var(--green)';
  }
}

// ── BACKFILL HISTORICAL PRICES ─────────────────────────────────────────
// Client-side driver for the worker's ?backfillFull=1 endpoint. Calls it
// repeatedly in small symbol batches (the worker itself won't do it all in
// one request — see backfillFull's offset/limit/nextOffset contract) until
// every held symbol is done, then pulls the result into pfSnapshots so
// Portfolio Change picks it up immediately rather than waiting for the
// next scheduled refresh.
async function runBackfill(){
  const workerURL = getWorkerURL();
  if(!workerURL){ notify('Set your Cloudflare Worker URL first.','err'); return; }
  const resolution = $('bf-resolution').value;
  const since = '2018-01-01';
  const limit = 8; // small slice per call — keeps each worker invocation under Cloudflare's subrequest cap

  const btn = $('bf-run-btn'), barWrap = $('bf-bar-wrap'), bar = $('bf-bar'), status = $('bf-status');
  btn.disabled = true; btn.textContent = 'RUNNING…';
  barWrap.style.display = ''; bar.style.width = '0%';
  status.textContent = 'Starting…'; status.style.color = 'var(--text3)';

  let offset = 0, totalSymbols = null, totalDaysStored = 0, hadError = false;
  try{
    while(true){
      const url = `${workerURL}?backfillFull=1&since=${since}&resolution=${resolution}&offset=${offset}&limit=${limit}`;
      const r = await fetch(url);
      if(!r.ok) throw new Error('HTTP '+r.status);
      const d = await r.json();
      if(!d.ok) throw new Error(d.error || 'Worker returned an error');

      totalSymbols   = d.totalSymbols;
      totalDaysStored = d.daysStoredTotal;
      const doneSoFar = Math.min(offset + limit, totalSymbols || 0);
      const pct = totalSymbols ? Math.round(doneSoFar / totalSymbols * 100) : 0;
      bar.style.width = pct + '%';
      status.textContent = `Backfilling… ${doneSoFar}/${totalSymbols} symbols · ${totalDaysStored} days stored so far`;

      if((d.report || []).some(x => x.error)) hadError = true;
      if(d.done) break;
      offset = d.nextOffset;
      await new Promise(res => setTimeout(res, 400)); // gentle pacing between calls
    }

    bar.style.width = '100%';
    status.textContent = `✓ Backfill complete — ${totalDaysStored} days stored across ${totalSymbols} symbols`
      + (hadError ? ' (some symbols had errors — check browser console)' : '')
      + '. Pulling into local history…';
    status.style.color = 'var(--green)';

    await backfillPortfolioHistory(since); // force-pull from `since`, bypassing the once-per-day guard
    if(typeof backfillBenchmarkHistory==='function') await backfillBenchmarkHistory(since); // same for the ASX 200/BTC comparison chart
    status.textContent = status.textContent.replace('Pulling into local history…', 'Done ✓');
    notify('✓ Historical backfill complete — Portfolio Change and Benchmarks should now cover longer ranges', 'ok');
  }catch(e){
    status.textContent = 'Backfill failed: ' + e.message;
    status.style.color = 'var(--red)';
    notify('Backfill failed: ' + e.message, 'err');
  }finally{
    btn.disabled = false; btn.textContent = 'RUN BACKFILL';
  }
}

// One-off cleanup for entries stored before this worker started filtering
// on each symbol's real listing date (Yahoo's `range=max` sometimes returns
// priced days from before an ETF/stock actually listed). Same batched
// offset/nextOffset driving pattern as runBackfill().
async function runPruneHistory(){
  const workerURL = getWorkerURL();
  if(!workerURL){ notify('Set your Cloudflare Worker URL first.','err'); return; }
  const limit = 8;

  const btn = $('bf-prune-btn'), status = $('bf-status');
  btn.disabled = true; btn.textContent = 'CHECKING…';
  status.textContent = 'Checking for stray pre-listing history…'; status.style.color = 'var(--text3)';

  let offset = 0, totalSymbols = null, totalRemoved = 0;
  try{
    while(true){
      const url = `${workerURL}?pruneHistory=1&offset=${offset}&limit=${limit}`;
      const r = await fetch(url);
      if(!r.ok) throw new Error('HTTP '+r.status);
      const d = await r.json();
      if(!d.ok) throw new Error(d.error || 'Worker returned an error');

      totalSymbols = d.totalSymbols;
      totalRemoved += d.totalRemoved || 0;
      const doneSoFar = Math.min(offset + limit, totalSymbols || 0);
      status.textContent = `Checking… ${doneSoFar}/${totalSymbols} symbols · ${totalRemoved} stray entries removed so far`;

      if(d.done) break;
      offset = d.nextOffset;
      await new Promise(res => setTimeout(res, 400));
    }

    status.textContent = totalRemoved
      ? `✓ Removed ${totalRemoved} stray pre-listing entries across ${totalSymbols} symbols. Pulling refreshed history…`
      : `✓ Checked ${totalSymbols} symbols — nothing stray found.`;
    status.style.color = 'var(--green)';

    if(totalRemoved){
      await backfillPortfolioHistory('2018-01-01');
      status.textContent = status.textContent.replace('Pulling refreshed history…', 'Done ✓');
    }
    notify(totalRemoved ? `✓ Cleaned up ${totalRemoved} stray entries` : '✓ No stray pre-listing entries found', 'ok');
  }catch(e){
    status.textContent = 'Cleanup failed: ' + e.message;
    status.style.color = 'var(--red)';
    notify('Cleanup failed: ' + e.message, 'err');
  }finally{
    btn.disabled = false; btn.textContent = 'FIX PRE-LISTING DATA';
  }
}

function renderPrices(){
  const holdings=calcH();
  // Show all cached prices, annotate with asset type from holdings
  const typeMap={};
  holdings.forEach(h=>typeMap[h.symbol]=h.assetType);
  const keys=Object.entries(prices).sort((a,b)=>a[0].localeCompare(b[0]));
  $('prices-empty').style.display=keys.length?'none':'';
  $('prices-body').innerHTML=keys.map(([sym,p])=>`<tr>
    <td><b>${sym}</b></td>
    <td class="pos">${n2(p,dec(p))}</td>
    <td>${typeMap[sym]?bT(typeMap[sym]):''}</td>
    <td><button class="del-btn" onclick="deletePrice(this)" data-sym="${sym}">✕</button></td>
  </tr>`).join('');
}
function deletePrice(btn){
  const sym = btn.dataset.sym;
  delete prices[sym]; save(); renderH(); renderPrices();
  notify(`Price cleared: ${sym}`,'ok');
}
function clearAllPrices(){
  if(!confirm('Clear all cached prices?')) return;
  prices={}; save(); renderH(); renderPrices();
  notify('All prices cleared.','ok');
}


// ── WORKER CODE INJECTION ─────────────────────────────────────────────
// Stored as array to avoid backtick/quote conflicts in surrounding HTML

// ── SPENDING TAB ─────────────────────────────────────────────────────
// ── SPENDING STORAGE ────────────────────────────────────────────────
const SP_SEED = [];