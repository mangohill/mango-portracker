// ── prices.js ─────────────────────────────────────────────

function switchTab(name,el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  $('panel-'+name).classList.add('active'); el.classList.add('active');
  // Reset all sort states on tab switch
  for(const k in SORT_STATE) delete SORT_STATE[k];
  if(name==='portfolio') renderH();
  refreshAllBrokerSelects();
  if(name==='trades'){ renderT(); setDate(); setCaType('merger'); const cd=$('ca-date');if(cd&&!cd.value)cd.value=new Date().toISOString().slice(0,10); const dd=$('dv-date');if(dd&&!dd.value)dd.value=new Date().toISOString().slice(0,10); }
  if(name==='add'){renderR();setDate();setCaType('merger');const cd=$('ca-date');if(cd&&!cd.value)cd.value=new Date().toISOString().slice(0,10);}
  if(name==='analytics'){ renderAnalytics(); }
  if(name==='holdings2'){ renderHD(); }
  if(name==='dividends'){ dvFYFilter='ALL'; renderFYBar(); renderDividends(); renderDivCharts(); renderDivCards(); }
  if(name==='spending'){ initSpending(); }
  if(name==='super'){ renderSuperAccounts(); renderSuperCards(); renderSuperChart(); syncSuperColorPickers(); }
  if(name==='property'){ renderProperties(); renderPropCards(); if($('pf-splits-wrap')&&!$('pf-splits-wrap').children.length) renderSplitRows([]); }
  if(name==='settings'){ renderPrices(); loadCFUrl(); syncInitUI(); renderOwnershipGrid(); }
  if(name==='tax'){ renderTax(); }
}

// ── LIVE PRICES ──────────────────────────────────────────────────────

// Your Cloudflare Worker URL — set this after deploying the worker (see ⚙ Settings)
function getWorkerURL(){
  const url = localStorage.getItem('cf_worker_url')||'';
  // Only allow HTTPS URLs to prevent javascript: or data: injection
  if(url && !url.startsWith('https://')) return '';
  return url;
}

async function fetchASXPrices(symbols){
  const workerURL = getWorkerURL();
  if(!workerURL) return {};
  try{
    const syms = symbols.map(s=>s+'.AX').join(',');
    const r = await fetch(`${workerURL}?symbols=${encodeURIComponent(syms)}`);
    if(!r.ok) return {};
    const d = await r.json();
    // Response: { "DHHF.AX": 39.50, "NDQ.AX": 45.20, ... }
    const result = {};
    for(const [k,v] of Object.entries(d)){
      const sym = k.replace('.AX','').toUpperCase();
      if(v && +v > 0) result[sym] = +v;
    }
    return result;
  }catch(e){ console.warn('Worker fetch error:', e); return {}; }
}

// ── MAIF price via worker (fetches Monash xlsx, returns buy price) ───
const MAIF_SYMBOLS = new Set(['MAIF','MAAT']); // unlisted Monash funds

async function fetchMAIFPrice(){
  const workerURL = getWorkerURL();
  if(!workerURL){ notify('Set your Cloudflare Worker URL in Settings first.','err'); return null; }
  try{
    const r = await fetch(`${workerURL}?maif=1`);
    if(!r.ok){
      console.warn('MAIF fetch: HTTP', r.status, r.statusText);
      notify('MAIF fetch failed: HTTP '+r.status+' — check worker is deployed correctly.','err');
      return null;
    }
    const d = await r.json();
    if(d.error){
      console.warn('MAIF worker error:', d.error);
      notify('MAIF worker error: '+d.error,'err');
      return null;
    }
    if(!d.MAIF){
      console.warn('MAIF: no price in response:', JSON.stringify(d));
      notify('MAIF: worker responded but no price found — Monash file URL may have changed.','err');
      return null;
    }
    return +d.MAIF;
  }catch(e){
    console.warn('MAIF fetch error:', e);
    notify('MAIF fetch failed: '+e.message,'err');
    return null;
  }
}

async function testMAIFDebug(){
  const workerURL = getWorkerURL();
  if(!workerURL){ notify('Set your Cloudflare Worker URL first.','err'); return; }
  notify('Running MAIF debug fetch…','info');
  try{
    const r = await fetch(`${workerURL}?maif=1&debug=1`);
    const text = await r.text();
    console.log('MAIF debug response (raw):', text);
    try{
      const d = JSON.parse(text);
      console.log('MAIF debug parsed:', d);
      if(d.rows){ console.log('First rows from xlsx:', d.rows); }
      if(d.lastBuy){ console.log('Buy price found:', d.lastBuy); }
      if(d.error){ notify('MAIF debug error: '+d.error,'err'); return; }
      notify('MAIF debug: check browser console (F12) for xlsx row data','ok');
    } catch(e){
      notify('MAIF debug response was not JSON — check console (F12)','err');
    }
  } catch(e){
    notify('MAIF debug failed: '+e.message,'err');
  }
}


function setMAIFManually(){
  const raw = prompt('Enter the MAIF unit price from monashinvestors.com\n(e.g. 1.6948):');
  if(!raw) return;
  const p = parseFloat(raw.replace(/[^0-9.]/g,''));
  if(!p || p <= 0){ notify('Invalid price entered.','err'); return; }
  prices['MAIF'] = p;
  save(); renderH(); renderPrices();
  notify('✓ MAIF price set to $'+p.toFixed(4),'ok');
}

async function fetchAndSetMAIF(){
  const workerURL = getWorkerURL();
  if(!workerURL){ notify('Set your Cloudflare Worker URL in Settings first.','err'); return; }
  notify('Fetching MAIF price…','info');
  const p = await fetchMAIFPrice();
  if(p){
    prices['MAIF'] = p;
    save(); renderH(); renderPrices();
    notify(`✓ MAIF = $${p.toFixed(4)}`,'ok');
  } else {
    notify('Could not fetch MAIF price. Open console (F12) for details.','err');
  }
}

async function refreshPrices(){
  const h = calcH();
  if(!h.length){ notify('No holdings to price.','err'); return; }
  notify('Fetching prices…','info');

  // ── Crypto via CoinGecko ──
  const cryptos = h.filter(x => x.assetType==='crypto');
  let cryptoFetched = 0;
  if(cryptos.length){
    const ids = [...new Set(cryptos.map(x=>CG[priceSymbol(x.symbol)]).filter(Boolean))].join(',');
    try{
      const res  = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=aud`);
      const data = await res.json();
      cryptos.forEach(x=>{
        const id = CG[x.symbol];
        if(id && data[id]?.aud){ prices[priceSymbol(x.symbol)]=data[id].aud; cryptoFetched++; }
      });
    }catch(e){ notify('CoinGecko error: '+e.message,'err'); }
  }

  // ── ASX stocks & ETFs via Cloudflare Worker proxy ──
  // Separate out unlisted funds (MAIF) from exchange-traded symbols
  const unlistedSyms = new Set(['MAIF','MAAT']);
  const others   = h.filter(x => x.assetType!=='crypto' && !unlistedSyms.has(priceSymbol(x.symbol)));
  const unlisted = h.filter(x => unlistedSyms.has(priceSymbol(x.symbol)));
  let stockFetched = 0;

  if(others.length || unlisted.length){
    const workerURL = getWorkerURL();
    if(!workerURL){
      notify(`Crypto updated ✓ — Deploy the free Cloudflare Worker in ⚙ Settings to get ASX prices`, 'info');
    } else {
      // Fetch exchange-traded ASX prices
      if(others.length){
        const stockPrices = await fetchASXPrices([...new Set(others.map(x=>priceSymbol(x.symbol)))]);
        for(const [sym,p] of Object.entries(stockPrices)){
          prices[sym]=p; stockFetched++;
        }
      }
      // MAIF: auto-fetch unavailable — Monash removed the public price file.
      // If MAIF is in holdings and has no stored price, warn the user.
      const hasMAIF = h.some(x => priceSymbol(x.symbol) === 'MAIF');
      if(hasMAIF){
        const maifPrice = await fetchMAIFPrice();
        if(maifPrice){ prices['MAIF']=maifPrice; stockFetched++; }
        else notify('MAIF fetch failed — check Worker is deployed with latest code.','err');
      }
      if(stockFetched===0){
        notify('Worker reachable but no prices returned — check console for details.','err');
      }
    }
  }

  save();
  const now = new Date().toLocaleTimeString('en-AU');
  if($('cpt')) $('cpt').textContent = 'Updated '+now;
  renderH(); renderPrices();

  const total = cryptoFetched + stockFetched;
  const statusEl = $('price-refresh-status');
  if(statusEl) statusEl.textContent = total > 0 ? `✓ ${total} updated · ${now}` : `Updated ${now}`;
  if(total > 0) notify(`${total} prices updated ✓`,'ok');
}

// Manual price override
function setManualPrice(){
  const sym   = priceSymbol($('mp-sym').value.trim().toUpperCase());
  const price = parseFloat($('mp-price').value);
  if(!sym||isNaN(price)||price<=0){ notify('Enter a symbol and price.','err'); return; }
  prices[sym] = price;
  save(); renderH(); renderPrices();
  $('mp-sym').value=''; $('mp-price').value='';
  $('mp-sym').focus();
  notify(`✓ ${sym} = ${n2(price)}`,'ok');
}

// Bulk price paste: "DHHF 39.50, NDQ 45.20" or one per line
function bulkSetPrices(){
  const raw = $('mp-bulk').value.trim();
  if(!raw){ notify('Paste prices first.','err'); return; }
  const lines = raw.replace(/,[ ]*/g,'\n').split('\n').map(l=>l.trim()).filter(Boolean);
  let count = 0;
  for(const line of lines){
    const m = line.match(/([A-Za-z0-9]+)[\s:=]+([0-9.]+)/);
    if(m){
      const sym=m[1].toUpperCase(), price=parseFloat(m[2]);
      if(sym && price>0){ prices[priceSymbol(sym)]=price; count++; }
    }
  }
  if(!count){ notify('No valid prices found. Format: DHHF 39.50','err'); return; }
  save(); renderH(); renderPrices();
  $('mp-bulk').value='';
  notify(`✓ ${count} prices updated`,'ok');
}

// ── EXPORT XLSX ──────────────────────────────────────────────────────