// ── settings.js ─────────────────────────────────────────────

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
    status.textContent = status.textContent.replace('Pulling into local history…', 'Done ✓');
    notify('✓ Historical backfill complete — Portfolio Change should now cover longer ranges', 'ok');
  }catch(e){
    status.textContent = 'Backfill failed: ' + e.message;
    status.style.color = 'var(--red)';
    notify('Backfill failed: ' + e.message, 'err');
  }finally{
    btn.disabled = false; btn.textContent = 'RUN BACKFILL';
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