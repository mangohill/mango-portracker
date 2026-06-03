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
