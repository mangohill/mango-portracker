// ── Service Worker Registration ───────────────────────────────────────────────
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/mango-mango/sw.js', { scope: '/mango-mango/' })
      .then(reg => {
        console.log('[SW] Registered, scope:', reg.scope);

        // Check for updates every time the page loads
        reg.update();

        // Listen for the new SW telling us there's an update ready
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if(!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if(newWorker.state === 'installed' && navigator.serviceWorker.controller){
              // New version available — update the dot to amber and show a toast
              const dot = document.getElementById('logo-dot');
              if(dot){
                dot.style.background   = 'var(--gold)';
                dot.style.boxShadow    = '0 0 8px var(--gold)';
                dot.title              = 'Update available — reload to get latest version';
              }
              // Show a subtle notification banner
              const banner = document.createElement('div');
              banner.id = 'sw-update-banner';
              banner.style.cssText = [
                'position:fixed;bottom:16px;left:50%;transform:translateX(-50%)',
                'background:var(--surface);border:1px solid var(--gold)',
                'color:var(--text);font-family:var(--mono);font-size:12px',
                'padding:10px 18px;border-radius:8px;z-index:9999',
                'display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,.4)',
              ].join(';');
              banner.innerHTML = '<span>🔄 New version available</span>'
                + '<button onclick="window.location.reload()" style="'
                + 'background:var(--gold);color:#000;border:none;border-radius:4px;'
                + 'padding:4px 12px;font-size:11px;font-family:var(--mono);cursor:pointer;font-weight:700'
                + '">Reload</button>'
                + '<button onclick="this.parentElement.remove()" style="'
                + 'background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px;padding:0 4px'
                + '">✕</button>';
              document.body.appendChild(banner);
            }
          });
        });
      })
      .catch(err => console.warn('[SW] Registration failed:', err));

    // When SW sends SW_UPDATED message, note it (already handled via updatefound above)
    navigator.serviceWorker.addEventListener('message', e => {
      if(e.data && e.data.type === 'SW_UPDATED') {
        console.log('[SW] Background update complete');
      }
    });
  });
}

// ── Online / offline indicator ───────────────────────────────────────────
function updateConnStatus(){
  const dot = document.getElementById('logo-dot');
  if(!dot) return;
  if(navigator.onLine){
    dot.classList.remove('offline');
    dot.title = 'Online';
  } else {
    dot.classList.add('offline');
    dot.title = 'Offline — price fetching unavailable';
  }
}
window.addEventListener('online',  updateConnStatus);
window.addEventListener('offline', updateConnStatus);
updateConnStatus(); // set on page load

// ═══════════════════════════════════════════════════════════════
// EXPECTED DIVIDEND CHECKER
// Compares what you should have received vs what's recorded
// ═══════════════════════════════════════════════════════════════

// Calculate how many units of a symbol were held on a given date (FIFO running balance)
function unitsHeldOn(symbol, date) {
  const d = date instanceof Date ? date : new Date(date);
  // All buys/drp before this date, minus sells before this date
  const relevant = trades
    .filter(t => t.symbol === symbol && new Date(t.date) <= d)
    .sort((a, b) => a.date.localeCompare(b.date));
  let held = 0;
  for (const t of relevant) {
    const units = +t.units || 0;
    if (t.type === 'buy' || t.type === 'drp') held += units;
    else if (t.type === 'sell') held -= units;
  }
  return Math.max(0, held);
}

// Check if a dividend is already recorded in the dividends tab
function isDivRecorded(symbol, date, amount) {
  const dateStr = date instanceof Date ? date.toISOString().slice(0,10) : date;
  // Allow ±7 days for ex-date vs pay-date difference
  const target = new Date(dateStr);
  const tolerance = 30 * 24 * 60 * 60 * 1000;
  return dividends.some(d => {
    if (d.symbol !== symbol) return false;
    const diff = Math.abs(new Date(d.date) - target);
    return diff <= tolerance;
  });
}

// Main function: fetch dividend history and calculate expected income
async function checkExpectedDividends() {
  const workerURL = getWorkerURL();
  if (!workerURL) {
    notify('Set your Cloudflare Worker URL in Settings first.', 'err');
    return;
  }

  // Get all unique symbols that are ETF/LIC/REIT/stock type (not crypto/managed)
  const eligibleTypes = new Set(['etf','lic','reit','asx_stock','stock','managed']);
  const symbols = [...new Set(
    trades
      .filter(t => (t.type==='buy'||t.type==='drp') && eligibleTypes.has(t.assetType))
      .map(t => t.symbol)
  )];

  if (!symbols.length) {
    notify('No eligible holdings found (ETF/LIC/REIT/Stock).', 'err');
    return;
  }

  notify(`Fetching dividend history for ${symbols.length} symbol(s)…`, 'info');

  // Convert symbols to Yahoo Finance format (DHHF:AU → DHHF.AX, CMC suffix → same)
  function toYahoo(sym) {
    const m = sym.match(/^([^:]+):(\w+)$/);
    if (!m) return sym + '.AX';
    const suffix = m[2].toUpperCase();
    const exchMap = { 'AU':'AX','BS':'AX','SW':'AX','SWF':'AX','CMC':'AX','CS':'AX','COMM':'AX','NAB':'AX','ANZ':'AX' };
    return m[1] + '.' + (exchMap[suffix] || 'AX');
  }

  // Build map: yahooSym → ARRAY of original symbols
  // e.g. both "DHHF:AU" and "DHHF:CMC" → "DHHF.AX" → ["DHHF:AU","DHHF:CMC"]
  const symMap = {};
  symbols.forEach(s => {
    const y = toYahoo(s);
    if (!symMap[y]) symMap[y] = [];
    symMap[y].push(s);
  });
  const yahooSyms = [...new Set(symbols.map(toYahoo))];

  let divData;
  try {
    const url = `${workerURL}?divs=${encodeURIComponent(yahooSyms.join(','))}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    divData = await r.json();
  } catch(e) {
    notify('Dividend fetch failed: ' + e.message, 'err');
    return;
  }

  // Build results — each original symbol gets its own rows
  const results = [];
  for (const [yahooSym, data] of Object.entries(divData)) {
    const origSymbols = symMap[yahooSym] || [yahooSym];
    if (data.error) {
      origSymbols.forEach(s => results.push({ symbol: s, error: data.error }));
      continue;
    }
    // Process each original symbol separately using its own unit count
    for (const origSym of origSymbols) {
      const owner = getSymbolOwner(origSym);
      const ownerLabel = getPersonLabel(owner);
      for (const div of (data.dividends || [])) {
        const exDate = new Date(div.date);
        const units = unitsHeldOn(origSym, exDate);
        if (units <= 0) continue;
        const firstBuy = trades
          .filter(t => t.symbol === origSym && (t.type==='buy'||t.type==='drp'))
          .sort((a,b) => a.date.localeCompare(b.date))[0];
        if (!firstBuy || exDate < new Date(firstBuy.date)) continue;
        const expected = units * div.amount;
        const recorded = isDivRecorded(origSym, div.date, div.amount);
        results.push({
          symbol:     origSym,
          owner:      ownerLabel,
          date:       div.date,
          perUnit:    div.amount,
          units,
          expected,
          recorded,
          currency:   data.currency || 'AUD',
        });
      }
    }
  }

  renderDivCheckResults(results);
}

function renderDivCheckResults(results) {
  const panel = $('div-check-panel');
  if (!panel) return;
  panel.style.display = 'block';

  if (!results.length) {
    panel.innerHTML = `<div class="fs"><div class="fst">Expected Dividends</div>
      <p style="color:var(--text3);font-size:13px">No dividend history found for your holdings. Check your Worker is deployed with the latest code.</p></div>`;
    return;
  }

  const missing  = results.filter(r => !r.recorded && !r.error);
  const found    = results.filter(r =>  r.recorded && !r.error);
  const errors   = results.filter(r =>  r.error);
  const totalExp = results.filter(r => !r.error).reduce((s,r) => s + (r.expected||0), 0);
  const totalMis = missing.reduce((s,r) => s + (r.expected||0), 0);

  const fmtDate = d => new Date(d).toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'});
  const fmtAmt  = a => '$' + (+a).toFixed(4);
  const fmtTot  = a => '$' + (+a).toFixed(2);

  const rows = [...missing, ...found].sort((a,b) => a.date.localeCompare(b.date));

  panel.innerHTML = `
    <div class="fs">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div class="fst">Expected Dividends</div>
        <button class="btn btn-r" onclick="document.getElementById('div-check-panel').style.display='none';const dp=document.getElementById('drp-tab-panel');if(dp)dp.style.display='none';">✕ Close</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:16px">
        <div style="background:var(--surface2);border-radius:5px;padding:10px 14px">
          <div style="font-size:10px;color:var(--text3);margin-bottom:4px">TOTAL EXPECTED</div>
          <div style="font-family:var(--mono);font-size:18px;font-weight:600">${fmtTot(totalExp)}</div>
        </div>
        <div style="background:var(--surface2);border-radius:5px;padding:10px 14px">
          <div style="font-size:10px;color:var(--text3);margin-bottom:4px">RECORDED</div>
          <div style="font-family:var(--mono);font-size:18px;font-weight:600;color:var(--green)">${found.length}</div>
        </div>
        <div style="background:var(--surface2);border-radius:5px;padding:10px 14px">
          <div style="font-size:10px;color:var(--text3);margin-bottom:4px">MISSING / UNRECORDED</div>
          <div style="font-family:var(--mono);font-size:18px;font-weight:600;color:var(--${missing.length?'gold':'green'})">${missing.length}</div>
        </div>
        <div style="background:var(--surface2);border-radius:5px;padding:10px 14px">
          <div style="font-size:10px;color:var(--text3);margin-bottom:4px">MISSING TOTAL</div>
          <div style="font-family:var(--mono);font-size:18px;font-weight:600;color:var(--${missing.length?'gold':'text'})">${fmtTot(totalMis)}</div>
        </div>
      </div>

      ${missing.length ? `
      <div style="margin-bottom:12px">
        <button class="btn" onclick="addAllMissingDivs()" style="background:var(--gold);color:#000;font-weight:700">
          ＋ Add All ${missing.length} Missing to Dividends Tab
        </button>
        <span style="font-size:11px;color:var(--text3);margin-left:10px">Review amounts — Yahoo ex-date may differ from pay date by ~1 week</span>
      </div>` : ''}

      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px;font-family:var(--mono)">
          <thead>
            <tr style="border-bottom:1px solid var(--border2);color:var(--text3);font-size:11px">
              <th style="text-align:left;padding:6px 8px">Symbol</th>
              <th style="text-align:left;padding:6px 8px">Owner</th>
              <th style="text-align:left;padding:6px 8px">Ex-Date</th>
              <th style="text-align:right;padding:6px 8px">Per Unit</th>
              <th style="text-align:right;padding:6px 8px">Units Held</th>
              <th style="text-align:right;padding:6px 8px">Expected</th>
              <th style="text-align:center;padding:6px 8px">Status</th>
              <th style="text-align:center;padding:6px 8px">Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
            <tr style="border-bottom:1px solid var(--border);${r.recorded?'opacity:0.55':''}">
              <td style="padding:6px 8px;font-weight:600">${escHtml(r.symbol)}</td>
              <td style="padding:6px 8px;font-size:11px;color:var(--text3)">${r.owner||'—'}</td>
              <td style="padding:6px 8px;color:var(--text2)">${fmtDate(r.date)}</td>
              <td style="padding:6px 8px;text-align:right">${fmtAmt(r.perUnit)}</td>
              <td style="padding:6px 8px;text-align:right">${(+r.units).toFixed(4)}</td>
              <td style="padding:6px 8px;text-align:right;font-weight:600">${fmtTot(r.expected)}</td>
              <td style="padding:6px 8px;text-align:center">
                ${r.recorded
                  ? '<span style="color:var(--green);font-size:13px" title="Already in dividends tab">✓</span>'
                  : '<span style="color:var(--gold);font-size:13px" title="Not found in dividends tab">⚠ Missing</span>'}
              </td>
              <td style="padding:6px 8px;text-align:center">
                ${!r.recorded ? `<button class="btn" style="padding:2px 8px;font-size:11px"
                  onclick='addSingleMissingDiv(${JSON.stringify(r)})'>＋ Add</button>` : '—'}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${errors.length ? `<p style="font-size:11px;color:var(--text3);margin-top:8px">⚠ ${errors.length} symbol(s) failed: ${errors.map(e=>e.symbol).join(', ')}</p>` : ''}
    </div>
  `;

  // Store missing for bulk add
  window._missingDivs = missing;
}

// Add a single missing dividend to the dividends tab
function addSingleMissingDiv(r) {
  dividends.push({
    id:         'div_' + uid(),
    date:       r.date,
    symbol:     r.symbol,
    amount:     +r.expected.toFixed(2),
    type:       'dividend',
    frankingPct: 0,
    notes:      'Auto-added from dividend history check',
  });
  save();
  renderDivCharts(); renderDivCards();
  notify(`✓ Added ${r.symbol} ${r.date} — ${n2(+r.expected)}`, 'ok');
  renderDivCheckResults(window._missingDivs
    ? (window._missingDivs = window._missingDivs.filter(m => m.date!==r.date||m.symbol!==r.symbol),
       [...window._missingDivs])
    : []);
  renderDividends();
}

// Add all missing dividends at once
function addAllMissingDivs() {
  const missing = window._missingDivs || [];
  if (!missing.length) return;
  missing.forEach(r => {
    dividends.push({
      id:         'div_' + uid(),
      date:       r.date,
      symbol:     r.symbol,
      amount:     +r.expected.toFixed(2),
      type:       'dividend',
      frankingPct: 0,
      notes:      'Auto-added from dividend history check',
    });
  });
  save();
  notify(`✓ Added ${missing.length} dividend records`, 'ok');
  window._missingDivs = [];
  renderDividends(); renderDivCharts(); renderDivCards();
  document.getElementById('div-check-panel').style.display = 'none';
  const _dp=document.getElementById('drp-tab-panel');if(_dp)_dp.style.display='none';
}


// ═══════════════════════════════════════════════════════════════
// DRP PROCESSING ENGINE
// ═══════════════════════════════════════════════════════════════

function processDRP(){
  const drpSettings = getDRPSettings();
  const enabledSyms = Object.entries(drpSettings)
    .filter(([,s]) => s.enabled)
    .map(([sym]) => sym);

  if(!enabledSyms.length){
    notify('No symbols have DRP enabled. Enable DRP in the Stock Ownership section above.','err');
    return;
  }

  // 6-month lookback window
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 6);
  const cutoffStr = cutoff.toISOString().slice(0,10);

  const carry   = getDRPCarry();
  const pending = []; // items ready for user confirmation

  for(const sym of enabledSyms){
    const settings = drpSettings[sym];
    const fractional = settings.fractional || false;

    // Find unprocessed dividends for this symbol in last 6 months
    // "Unprocessed" = no DRP buy trade within 7 days of the dividend date
    const symDivs = dividends
      .filter(d => d.symbol === sym && d.date >= cutoffStr && d.type !== 'drp')
      .sort((a,b) => a.date.localeCompare(b.date));

    for(const div of symDivs){
      // Check: is there already a DRP trade close to this dividend?
      const divDate = new Date(div.date);
      const already = trades.some(t => {
        if(t.symbol !== sym || t.type !== 'drp') return false;
        const diff = Math.abs(new Date(t.date) - divDate);
        return diff <= 35 * 24*60*60*1000; // within 35 days
      });
      if(already) continue; // already processed

      // Get current market price for DRP price pre-fill
      const mktPrice = prices[priceSymbol(sym)] || 0;

      // Get carry-forward
      const carryAmt = carry[sym] || 0;
      const total    = +(+div.amount + carryAmt).toFixed(4);

      pending.push({
        sym,
        divId:     div.id,
        divDate:   div.date,
        divAmount: +div.amount,
        carryIn:   carryAmt,
        total,
        price:     mktPrice,   // user can override
        fractional,
        // calculated fields filled in renderDRPPanel()
      });
    }
  }

  if(!pending.length){
    const panel = $('drp-process-panel');
    if(panel){
      panel.style.display = 'block';
      panel.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;
        background:var(--surface);border-radius:6px;border:1px solid var(--border)">
        <span style="color:var(--green);font-size:16px">✓</span>
        <span style="font-size:12px;color:var(--text2)">DRP: nothing to process — all recent dividends for DRP-enabled symbols are handled.</span>
      </div>`;
    }
    return;
  }

  window._drpPending = pending;
  renderDRPPanel();
}

function calcDRPUnits(total, price, fractional){
  if(!price || price <= 0) return { units: 0, carryOut: total };
  if(fractional){
    const units = +(total / price).toFixed(6);
    return { units, carryOut: 0 };
  } else {
    const units = Math.floor(total / price);
    const carryOut = +(total - units * price).toFixed(4);
    return { units, carryOut };
  }
}

function renderDRPPanel(){
  const panel = $('drp-tab-panel') || $('drp-process-panel');
  if(!panel) return;
  panel.style.display = 'block';
  const pending = window._drpPending || [];
  if(!pending.length){ panel.innerHTML = ''; return; }

  const rows = pending.map((p, idx) => {
    const { units, carryOut } = calcDRPUnits(p.total, p.price, p.fractional);
    const canProcess = p.price > 0 && units > 0;
    return `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:10px"
         id="drp-item-${idx}">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-family:var(--mono);font-size:14px;font-weight:700;color:var(--gold)">${escHtml(p.sym)}</span>
        <span style="font-size:11px;color:var(--text3)">${p.divDate}</span>
        <span style="font-size:11px;color:var(--text3)">
          Dividend: ${n2(p.divAmount)}
          ${p.carryIn > 0.005 ? ' + ' + n2(p.carryIn) + ' carry-in' : ''}
          = <strong style="color:var(--text)">${n2(p.total)}</strong> available
        </span>
      </div>
      <div style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap">
        <div>
          <label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px">DRP PRICE (AUD)</label>
          <input type="number" class="fi" step="any" min="0"
            value="${p.price > 0 ? p.price.toFixed(4) : ''}"
            placeholder="Enter DRP price"
            style="width:130px;padding:5px 8px;font-family:var(--mono)"
            oninput="window._drpPending[${idx}].price=parseFloat(this.value)||0;updateDRPRow(${idx})">
        </div>
        <div style="font-family:var(--mono);font-size:12px;padding-bottom:6px">
          <div id="drp-calc-${idx}" style="color:${canProcess?'var(--text)':'var(--text3)'}">
            ${canProcess
              ? `<span style="color:var(--green)">▶ ${p.fractional ? units.toFixed(6) : units} units</span>
                 ${carryOut > 0.005 ? '<span style="color:var(--text3)"> · carry: ' + n2(carryOut) + '</span>' : '<span style="color:var(--green)"> · fully reinvested</span>'}` 
              : 'Enter price to calculate'}
          </div>
        </div>
        <div style="margin-left:auto;display:flex;gap:8px">
          ${canProcess
            ? `<button class="btn btn-g" style="padding:5px 14px;font-size:12px"
                onclick="confirmDRPItem(${idx})">✓ Confirm</button>` : ''}
          <button class="btn" style="padding:5px 10px;font-size:12px;color:var(--text3)"
            onclick="skipDRPItem(${idx})">Skip</button>
        </div>
      </div>
    </div>`;
  }).join('');

  const hasAny = pending.some(p => p.price > 0 && calcDRPUnits(p.total, p.price, p.fractional).units > 0);

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div class="fst" style="margin:0">📈 DRP Processing</div>
      <button class="btn btn-r" onclick="const dp=$('drp-tab-panel');if(dp){dp.style.display='none';dp.innerHTML='';}">✕ Close</button>
    </div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:10px">
      <strong style="color:var(--text)">\${pending.length}</strong> unprocessed dividend\${pending.length!==1?'s':''} found.
      Review each, adjust the DRP price if needed, then confirm.
    </div>
    ${rows}
    ${hasAny ? `<button class="btn" onclick="confirmAllDRP()"
      style="background:var(--gold);color:#000;font-weight:700;margin-top:4px">
      ⚡ Confirm All</button>` : ''}
  `;
}

function updateDRPRow(idx){
  const p = window._drpPending[idx];
  const { units, carryOut } = calcDRPUnits(p.total, p.price, p.fractional);
  const el = $(`drp-calc-${idx}`);
  if(!el) return;
  const canProcess = p.price > 0 && units > 0;
  el.innerHTML = canProcess
    ? `<span style="color:var(--green)">▶ ${p.fractional ? units.toFixed(6) : units} units</span>
       ${carryOut > 0.005 ? '<span style="color:var(--text3)"> · carry: ' + n2(carryOut) + '</span>' : '<span style="color:var(--green)"> · fully reinvested</span>'}`
    : (p.price > 0 ? '<span style="color:var(--text3)">Price too low to buy even 1 unit</span>' : 'Enter price to calculate');

  // Re-render confirm button area
  renderDRPPanel();
}

function confirmDRPItem(idx){
  const p = window._drpPending[idx];
  if(!p){ notify('Item not found.','err'); return; }
  const { units, carryOut } = calcDRPUnits(p.total, p.price, p.fractional);
  if(units <= 0){ notify('No units to buy — check the DRP price.','err'); return; }

  // Add the DRP buy trade
  trades.push({
    id:        uid(),
    type:      'drp',
    symbol:    p.sym,
    date:      p.divDate,
    units:     +units.toFixed(p.fractional ? 6 : 0),
    price:     +p.price.toFixed(4),
    fees:      0,
    assetType: getSymbolAssetType(p.sym),
    notes:     'DRP — auto from dividend ' + p.divDate,
  });

  // Update carry-forward
  const carry = getDRPCarry();
  carry[p.sym] = carryOut;
  saveDRPCarry(carry);

  save();
  renderT(); renderH(); renderR(); if(typeof renderAnalytics==='function') renderAnalytics();

  notify(`✓ DRP: ${p.sym} — ${p.fractional ? units.toFixed(6) : units} units @ ${n2(p.price)} · carry: ${n2(carryOut)}`,'ok');

  // Remove from pending
  window._drpPending.splice(idx, 1);
  renderDRPPanel();
}

function skipDRPItem(idx){
  window._drpPending.splice(idx, 1);
  renderDRPPanel();
  notify('DRP item skipped.','ok');
}

function confirmAllDRP(){
  const pending = [...(window._drpPending || [])];
  let confirmed = 0;
  const carry = getDRPCarry();

  for(const p of pending){
    const { units, carryOut } = calcDRPUnits(p.total, p.price, p.fractional);
    if(p.price <= 0 || units <= 0) continue;

    trades.push({
      id:        uid(),
      type:      'drp',
      symbol:    p.sym,
      date:      p.divDate,
      units:     +units.toFixed(p.fractional ? 6 : 0),
      price:     +p.price.toFixed(4),
      fees:      0,
      assetType: getSymbolAssetType(p.sym),
      notes:     'DRP — auto from dividend ' + p.divDate,
    });
    carry[p.sym] = carryOut;
    confirmed++;
  }

  saveDRPCarry(carry);
  save();
  window._drpPending = [];
  renderT(); renderH(); renderR(); if(typeof renderAnalytics==='function') renderAnalytics();
  renderDRPPanel();
  notify(`✓ DRP: ${confirmed} trade${confirmed!==1?'s':''} added`,'ok');
}

function getSymbolAssetType(sym){
  // Get assetType from most recent buy trade for this symbol
  const t = trades.filter(x => x.symbol===sym && (x.type==='buy'||x.type==='drp'))
                  .sort((a,b) => b.date.localeCompare(a.date))[0];
  return t ? t.assetType : 'stock';
}


// ── Combined Check + Process button ─────────────────────────────────────────
async function checkAndProcessDividends(){
  // Hide both panels first
  const checkPanel = $('div-check-panel');
  const drpPanel   = $('drp-tab-panel');
  if(checkPanel){ checkPanel.style.display = 'none'; checkPanel.innerHTML = ''; }
  if(drpPanel)  { drpPanel.style.display   = 'none'; drpPanel.innerHTML   = ''; }

  // Run dividend check (populates div-check-panel)
  await checkExpectedDividends();

  // Run DRP processing (populates drp-tab-panel)
  processDRP();
}


// ═══════════════════════════════════════════════════════════════════════════
// MATH INPUT — +/- arithmetic on numeric fields
// Usage: type "+450" or "-200" in any .math-inp field
//   Tab/Enter → resolves and saves
//   Escape    → reverts to prior value
//   While typing: shows a preview hint below the field
// Revert button disappears after next sync pull.
// ═══════════════════════════════════════════════════════════════════════════

function mathInpInit(el){
  // Sync prior to current value on focus
  const cur = el.value || '0';
  el.dataset.prior     = cur;
  el.dataset.committed = el.dataset.committed && el.dataset.committed !== '0' ? el.dataset.committed : cur;
  // Select all text so typing '+450' replaces the whole value cleanly
  // Without this, cursor lands mid-field and '+450' appends → '1350+450' → broken
  setTimeout(() => el.select(), 0);
  mathInpHint(el);
}

function mathInpInput(el){
  const raw = el.value.trim();
  const prior = parseFloat(el.dataset.prior) || 0;

  // Detect arithmetic prefix
  const m = raw.match(/^([+\-])(\s*)([\d]*\.?[\d]*)$/);
  if(m && m[3] !== ''){
    const op  = m[1];
    const num = parseFloat(m[3]);
    if(!isNaN(num)){
      const result = op === '+' ? prior + num : prior - num;
      mathInpShowHint(el, prior, op, num, result);
      return;
    }
  }
  mathInpHint(el); // plain number or incomplete — hide hint
}

function mathInpShowHint(el, prior, op, num, result){
  let hint = document.getElementById('math-hint-' + el.id);
  if(!hint){
    hint = document.createElement('div');
    hint.id = 'math-hint-' + el.id;
    hint.style.cssText = [
      'position:absolute;z-index:200',
      'background:var(--surface)',
      'border:1px solid var(--gold)',
      'border-radius:5px',
      'padding:5px 10px',
      'font-family:var(--mono)',
      'font-size:11px',
      'color:var(--text)',
      'white-space:nowrap',
      'box-shadow:0 2px 8px rgba(0,0,0,.35)',
      'pointer-events:none',
    ].join(';');
    const wrap = el.parentElement;
    wrap.style.position = 'relative';
    wrap.appendChild(hint);
  }
  const sign = op === '+' ? '+' : '−';
  const col  = result < 0 ? 'var(--red)' : 'var(--green)';
  hint.innerHTML =
    `<span style="color:var(--text3)">$${prior.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>`
    + ` <span style="color:var(--gold)">${sign}$${num.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>`
    + ` = <span style="color:${col};font-weight:700">$${result.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>`;
  hint.style.display = 'block';
}

function mathInpHint(el){
  const hint = document.getElementById('math-hint-' + el.id);
  if(hint) hint.style.display = 'none';
}

function mathInpCommit(el, saveFn){
  const raw    = el.value.trim();
  const prior  = parseFloat(el.dataset.prior) || 0;
  let   result = null;

  const m = raw.match(/^([+\-])\s*([\d]*\.?[\d]+)$/);
  if(m){
    const num = parseFloat(m[2]);
    if(!isNaN(num)){
      result = m[1] === '+' ? prior + num : prior - num;
      result = Math.max(0, +result.toFixed(2));
    }
  } else {
    const plain = parseFloat(raw);
    if(!isNaN(plain)) result = Math.max(0, +plain.toFixed(2));
  }

  if(result === null){
    // Can't parse — revert
    el.value = el.dataset.prior;
    mathInpHint(el);
    return;
  }

  const oldCommitted = el.dataset.committed;

  // Only do something if value actually changed
  if(result !== parseFloat(oldCommitted)){
    // Store old committed for revert button
    el.dataset.revertTo = oldCommitted;
    el.dataset.committed = String(result);
    el.dataset.prior = String(result);
    el.value = result;
    mathInpHint(el);

    // Show revert button
    mathInpShowRevert(el);
  } else {
    el.value = result;
    mathInpHint(el);
  }

  // Call the provided save function
  if(saveFn) saveFn(result);
}

function mathInpRevert(el, saveFn){
  const prev = parseFloat(el.dataset.revertTo);
  if(isNaN(prev)) return;
  el.value = prev;
  el.dataset.committed = String(prev);
  el.dataset.prior = String(prev);
  mathInpHideRevert(el);
  mathInpHint(el);
  if(saveFn) saveFn(prev);
}

function mathInpShowRevert(el){
  const id = 'math-revert-' + el.id;
  let btn = document.getElementById(id);
  if(!btn){
    btn = document.createElement('button');
    btn.id = id;
    btn.style.cssText = [
      'position:absolute;right:0;top:-18px',
      'background:var(--surface2)',
      'border:1px solid var(--border)',
      'border-radius:3px',
      'color:var(--text3)',
      'font-size:9px',
      'font-family:var(--mono)',
      'padding:1px 5px',
      'cursor:pointer',
      'white-space:nowrap',
      'z-index:201',
    ].join(';');
    const wrap = el.parentElement;
    wrap.style.position = 'relative';
    wrap.appendChild(btn);
  }
  const prev = parseFloat(el.dataset.revertTo);
  btn.textContent = '↩ revert to $' + prev.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});
  btn.style.display = 'inline-block';
  // The onclick is set dynamically in the callers via data-revertfn
  btn.onclick = function(){ mathInpRevert(el, el._saveFn); };
}

function mathInpHideRevert(el){
  const btn = document.getElementById('math-revert-' + el.id);
  if(btn) btn.style.display = 'none';
}

// Called after sync pull to clear all revert buttons
function mathInpClearAllReverts(){
  document.querySelectorAll('[id^="math-revert-"]').forEach(btn => {
    btn.style.display = 'none';
  });
}


// ── Tax → Dividends drilldown ────────────────────────────────────────────────
function taxDrillDividends(personKey, fy){
  // Switch to dividends tab
  const tabEl = document.querySelector('.tab[onclick*="dividends"]');
  if(tabEl) switchTab('dividends', tabEl);

  // Set FY filter on the FY bar
  dvFYFilter = String(fy);

  // Set owner filter
  const ownerSel = $('dv-owner-filter');
  if(ownerSel){
    ownerSel.innerHTML = '<option value="">All Owners</option>' +
      getAllPersons().concat(['joint']).map(p =>
        '<option value="' + p + '"' + (p===personKey?' selected':'') + '>' + getPersonLabel(p) + '</option>'
      ).join('');
  }

  // Re-render with filters applied
  if(typeof renderFYBar==='function') renderFYBar();
  renderDividends();
  if(typeof renderDivCharts==='function') renderDivCharts();
  if(typeof renderDivCards==='function') renderDivCards();

  // Scroll dividend history into view
  setTimeout(function(){
    const tbl = document.getElementById('dv-body');
    if(tbl){
      const t = tbl.closest('table') || tbl;
      t.scrollIntoView({behavior:'smooth', block:'start'});
    }
  }, 200);

  // Flash the FY bar so the user sees what's filtered
  const fyBar = document.getElementById('dv-fy-bar');
  if(fyBar){
    fyBar.style.transition = 'background 0.3s';
    fyBar.style.background = 'rgba(245,166,35,0.15)';
    setTimeout(function(){ fyBar.style.background = ''; }, 1400);
  }
}


// ── Division 293 breakdown popup ─────────────────────────────────────────────
function showDiv293Breakdown(personKey){
  const t = (window.__div293 || {})[personKey];
  if(!t){ notify('Div293 data not available — re-open Tax tab.','err'); return; }
  // Remove any existing popup
  const existing = document.getElementById('div293-popup');
  if(existing){ existing.remove(); return; }

  const n2l = v => '$' + Number(v).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});
  const pct  = v => (v*100).toFixed(1) + '%';

  const sgLabel = t.empSGManual > 0
    ? 'Employer SG (manual entry)'
    : 'Employer SG (estimated at ' + pct(t.sgRate) + ' of salary)';

  const excessAmt  = Math.max(0, t.div293Income - t.div293Threshold);
  const taxableCC  = Math.min(t.totalConcess, excessAmt);

  const popup = document.createElement('div');
  popup.id = 'div293-popup';
  popup.style.cssText = [
    'position:fixed','top:50%','left:50%',
    'transform:translate(-50%,-50%)',
    'background:var(--surface)','border:1px solid var(--border)',
    'border-radius:10px','padding:20px 24px',
    'z-index:9999','min-width:340px','max-width:95vw',
    'box-shadow:0 8px 32px rgba(0,0,0,.5)',
    'font-family:var(--mono)','font-size:12px',
  ].join(';');

  popup.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:14px;font-weight:700;color:var(--text)">Division 293 Calculation — ${escHtml(t.personLabel)}</div>
      <button onclick="document.getElementById('div293-popup').remove()"
        style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px;line-height:1">✕</button>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:5px 0;color:var(--text2)">Taxable Income</td>
        <td style="text-align:right;color:var(--text)">${n2l(t.taxableIncome)}</td>
      </tr>
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:5px 0;color:var(--text2)">${sgLabel}</td>
        <td style="text-align:right;color:var(--text)">${n2l(t.empSuper)}</td>
      </tr>
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:5px 0;color:var(--text2)">Salary Sacrifice</td>
        <td style="text-align:right;color:var(--text)">${n2l(t.sacrifice)}</td>
      </tr>
      ${t.rfb > 0 ? `
      <tr style='border-bottom:1px solid var(--border)'>
        <td style='padding:5px 0;color:var(--text2)'>Reportable Fringe Benefits</td>
        <td style='text-align:right;color:var(--text)'>${n2l(t.rfb)}</td>
      </tr>` : ''}
      ${t.totalNetInvLoss > 0 ? `
      <tr style='border-bottom:1px solid var(--border)'>
        <td style='padding:5px 0;color:var(--text2)'>Net Investment Loss (added back)</td>
        <td style='text-align:right;color:var(--text)'>${n2l(t.totalNetInvLoss)}</td>
      </tr>` : ''}
      <tr style="border-bottom:2px solid var(--border2);font-weight:700">
        <td style="padding:6px 0;color:var(--text)">Div293 Income</td>
        <td style="text-align:right;color:var(--text)">${n2l(t.div293Income)}</td>
      </tr>
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:5px 0;color:var(--text2)">Threshold</td>
        <td style="text-align:right;color:var(--text)">$250,000.00</td>
      </tr>
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:5px 0;color:var(--text2)">Excess over threshold</td>
        <td style="text-align:right;color:var(--text)">${n2l(excessAmt)}</td>
      </tr>
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:5px 0;color:var(--text2)">Taxable contributions (lower of excess or total CC)</td>
        <td style="text-align:right;color:var(--text)">${n2l(taxableCC)}</td>
      </tr>
      <tr style="font-weight:700;background:rgba(255,71,87,.08)">
        <td style="padding:6px 0;color:var(--red)">Division 293 Tax (15% × ${n2l(taxableCC)})</td>
        <td style="text-align:right;color:var(--red)">${n2l(t.div293)}</td>
      </tr>
    </table>
    <div style="margin-top:12px;font-size:10px;color:var(--text3)">
      Div293 = 15% × min(total concessional contributions, income over $250k threshold)
    </div>`;

  // Dismiss on outside click — deferred so opening click doesn't immediately close it
  popup.addEventListener('click', e => e.stopPropagation());
  setTimeout(() => {
    document.addEventListener('click', function dismiss(){
      popup.remove();
      document.removeEventListener('click', dismiss);
    });
  }, 0);

  document.body.appendChild(popup);
}

// Delegated click handler for Div293 cells — registered once, never stacks
document.addEventListener('click', function(e){
  const cell = e.target.closest('[data-div293]');
  if(!cell) return;
  showDiv293Breakdown(cell.dataset.div293);
});