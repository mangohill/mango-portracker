// ── backup.js ─────────────────────────────────────────────

function triggerDownload(url, filename){
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function backupExport(){
  const payload = {
    version:    BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      pt_trades:   trades,
      pt_divs:     dividends,
      pt_props:    properties,
      pt_spending: (spendingData.length ? spendingData : (loadSpending(), spendingData)),
      pt_prices:   prices,
      cf_worker_url:  localStorage.getItem('cf_worker_url') || '',
      pt_drp_carry:  JSON.parse(localStorage.getItem('pt_drp_carry')||'{}'),
      pt_drp_skipped: JSON.parse(localStorage.getItem('pt_drp_skipped')||'{}'),
      pt_expdiv_skipped: JSON.parse(localStorage.getItem('pt_expdiv_skipped')||'{}'),
      pt_brokers:    getCustomBrokers(),
      pt_super:      superAccounts,
      su_combined_color: localStorage.getItem('su_combined_color') || '#ffffff',
      pt_tax:       taxData,
      pt_stock_owners: stockOwners,
      pt_extra_persons: extraPersons,
      cf_worker_code: WORKER_CODE,
      pt_amit:      amitAdjustments,
      pt_cgt_loss_carry_in: JSON.parse(localStorage.getItem('pt_cgt_loss_carry_in')||'{}'),
      pt_drp_settings: JSON.parse(localStorage.getItem('pt_drp_settings')||'{}'),
      // Portfolio Change history (1D/5D/1M/.../ALL, TWR/MWR) — real mark-to-market
      // snapshots built by backfill/daily sync. Previously missing from backups,
      // so a restore silently wiped all historical Portfolio Change data.
      pt_pf_snapshots: pfSnapshots,
      // Manual CoinGecko symbol→id overrides (Settings → Set CoinGecko ID)
      pt_cg_overrides: CG_OVERRIDES,
      // CGT simulator's saved/auto-snapshotted price at the cutoff date
      // (see CGT_CUTOFF_DATE in cgt.js — key renamed from pt_price_20270630)
      pt_price_cutoff: JSON.parse(localStorage.getItem('pt_price_cutoff')||'{}'),
      pt_price_cutoff_auto_saved: localStorage.getItem('pt_price_cutoff_auto_saved') || '',
      // Minor cache/config flags — small, no reason to drop them from the backup
      pt_pf_backfill_date: localStorage.getItem('pt_pf_backfill_date') || '',
      pt_super_last_fy:    localStorage.getItem('pt_super_last_fy') || '',
      pt_price_feed_url:   localStorage.getItem('pt_price_feed_url') || '',
      // GitHub Gist Cloud Sync device/credential state — included so a restore
      // fully re-establishes sync without you having to re-paste your token.
      // NOTE: this puts your GitHub PAT in plaintext in the downloaded JSON —
      // keep backup files as private as you would the token itself.
      pt_sync_key:      localStorage.getItem('pt_sync_key') || '',
      pt_sync_gist_id:  localStorage.getItem('pt_sync_gist_id') || '',
      pt_sync_device:   localStorage.getItem('pt_sync_device') || '',
      pt_last_sync:     localStorage.getItem('pt_last_sync') || '',
    }
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0,10);
  triggerDownload(url, `portfolio-backup-${date}.json`);

  backupStatus(`✓ Backup downloaded — ${payload.data.pt_trades.length} trades, `
    + `${payload.data.pt_divs.length} dividends, `
    + `${payload.data.pt_props.length} properties, `
    + `${payload.data.pt_spending.length} spending records, `
    + `${(payload.data.pt_super||[]).length} super accounts, `
    + `${payload.data.pt_brokers.length} custom brokers, `
    + `${payload.data.pt_amit.length} AMIT adjustments, `
    + `${Object.keys(payload.data.pt_prices||{}).length} cached prices, `
    + `${Object.keys(payload.data.pt_pf_snapshots||{}).length} portfolio history days`, 'var(--green)');
}

function backupImport(input){
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    let payload;
    try { payload = JSON.parse(e.target.result); }
    catch(err) {
      backupStatus('✗ Invalid file — could not parse JSON.', 'var(--red)');
      input.value = '';
      return;
    }
    // Validate structure
    if(!payload.data || !Array.isArray(payload.data.pt_trades)){
      backupStatus('✗ Invalid backup file — missing required fields.', 'var(--red)');
      input.value = '';
      return;
    }

    const d = payload.data;
    const exportDate = payload.exportedAt ? payload.exportedAt.slice(0,10) : 'unknown date';

    // Build preview
    const rows = [
      ['Trades',            (d.pt_trades||[]).length,   trades.length],
      ['Dividends',         (d.pt_divs||[]).length,     dividends.length],
      ['Properties',        (d.pt_props||[]).length,    properties.length],
      ['Spending records',  (d.pt_spending||[]).length, spendingData.length],
      ['Super accounts',    (d.pt_super||[]).length,    superAccounts.length],
      ['Tax records',        Object.keys(d.pt_tax||{}).length, Object.keys(taxData).length],
      ['Combined colour',    d.su_combined_color||'—',  suCombinedColor],
      ['Custom brokers',    (d.pt_brokers||[]).length,  getCustomBrokers().length],
      ['Cached prices',     Object.keys(d.pt_prices||{}).length, Object.keys(prices).length],
      ['AMIT adjustments',  (d.pt_amit||[]).length,     amitAdjustments.length],
      ['Portfolio history (days)', Object.keys(d.pt_pf_snapshots||{}).length, Object.keys(pfSnapshots).length],
      ['CoinGecko ID overrides',   Object.keys(d.pt_cg_overrides||{}).length, Object.keys(CG_OVERRIDES).length],
      ['Cloud Sync token/gist',    d.pt_sync_key ? 'included' : '—', syncKey ? 'set' : '—'],
    ];

    const rowHtml = rows.map(([label, incoming, current]) =>
      `<div style="display:flex;gap:0;align-items:center;border-bottom:1px solid var(--border);padding:5px 0">
        <span style="flex:1.4;color:var(--text2)">${label}</span>
        <span style="flex:1;text-align:right;font-family:var(--mono);color:var(--gold)">${incoming} incoming</span>
        <span style="flex:1;text-align:right;font-family:var(--mono);color:var(--text3)">${current} current</span>
      </div>`
    ).join('');

    $('backup-preview-body').innerHTML =
      `<div style="color:var(--text3);margin-bottom:10px">Backup from <b style="color:var(--text)">${exportDate}</b></div>`
      + `<div style="border-top:1px solid var(--border);margin-bottom:4px">`
      + `<div style="display:flex;gap:0;padding:4px 0;font-family:var(--mono);font-size:10px;color:var(--text3);border-bottom:1px solid var(--border)">`
      + `<span style="flex:1.4">DATA</span><span style="flex:1;text-align:right">INCOMING</span><span style="flex:1;text-align:right">CURRENT</span></div>`
      + rowHtml + `</div>`
      + `<div style="color:var(--red);font-size:11px;margin-top:10px">⚠ This will replace all current data. This cannot be undone.</div>`;

    $('backup-preview').style.display = '';
    _pendingRestore = payload;
    input.value = '';

    // Scroll preview into view
    $('backup-preview').scrollIntoView({behavior:'smooth', block:'nearest'});
  };
  reader.readAsText(file);
}

function backupConfirm(){
  if(!_pendingRestore) return;
  // Version compatibility check
  const bv = _pendingRestore.version || 1;
  if(bv > BACKUP_VERSION + 1){
    if(!confirm(`This backup was made with a newer version (v${bv}). Some data may not restore correctly. Continue?`)) return;
  }
  // Validate backup structure before applying
  if(!_pendingRestore.data || typeof _pendingRestore.data !== 'object'){
    notify('Invalid backup structure.','err'); return;
  }
  // Reject if trades/divs arrays are suspiciously large (>50,000 entries)
  const td = _pendingRestore.data;
  if((td.pt_trades||[]).length > 50000 || (td.pt_divs||[]).length > 50000){
    notify('Backup contains unusually large data. Aborting for safety.','err'); return;
  }
  const d = _pendingRestore.data;

  // Restore all data
  trades      = d.pt_trades     || [];
  dividends   = d.pt_divs       || [];
  properties  = d.pt_props      || [];
  spendingData= d.pt_spending   || [];
  prices      = d.pt_prices     || {};

  localStorage.setItem('pt_trades',   JSON.stringify(trades));
  localStorage.setItem('pt_divs',     JSON.stringify(dividends));
  localStorage.setItem('pt_props',    JSON.stringify(properties));
  localStorage.setItem('pt_spending', JSON.stringify(spendingData));
  localStorage.setItem('pt_prices',   JSON.stringify(prices));
  if(d.cf_worker_url)  localStorage.setItem('cf_worker_url',  d.cf_worker_url);
  if(d.pt_drp_carry)   localStorage.setItem('pt_drp_carry',  JSON.stringify(d.pt_drp_carry));
  if(d.pt_drp_skipped) localStorage.setItem('pt_drp_skipped', JSON.stringify(d.pt_drp_skipped));
  if(d.pt_expdiv_skipped) localStorage.setItem('pt_expdiv_skipped', JSON.stringify(d.pt_expdiv_skipped));
  if(d.pt_drp_settings) localStorage.setItem('pt_drp_settings', JSON.stringify(d.pt_drp_settings));
  if(d.pt_brokers && d.pt_brokers.length) saveCustomBrokers(d.pt_brokers);
  if(d.pt_super){ superAccounts = d.pt_super; saveSuperAccounts(); }
  if(d.pt_tax){ taxData = d.pt_tax; saveTaxData(); }
  if(d.pt_stock_owners){ stockOwners = d.pt_stock_owners; saveStockOwners(); }
  if(d.pt_extra_persons){ extraPersons = d.pt_extra_persons; saveExtraPersons(); }
  if(d.su_combined_color){ suCombinedColor = d.su_combined_color; localStorage.setItem('su_combined_color', d.su_combined_color); }
  if(d.pt_amit){ amitAdjustments = d.pt_amit; saveAmitAdjustments(); }
  if(d.pt_cgt_loss_carry_in) localStorage.setItem('pt_cgt_loss_carry_in', JSON.stringify(d.pt_cgt_loss_carry_in));
  if(d.pt_pf_snapshots){ pfSnapshots = d.pt_pf_snapshots; savePfSnapshots(); }
  if(d.pt_cg_overrides){ CG_OVERRIDES = d.pt_cg_overrides; saveCGOverrides(); }
  // Accept both the current key and the pre-rename key (pt_price_20270630),
  // so a backup made before the CGT cutoff-key rename still restores correctly.
  if(d.pt_price_cutoff || d.pt_price_20270630) localStorage.setItem('pt_price_cutoff', JSON.stringify(d.pt_price_cutoff || d.pt_price_20270630));
  if(d.pt_price_cutoff_auto_saved || d.pt_price_20270630_auto_saved) localStorage.setItem('pt_price_cutoff_auto_saved', d.pt_price_cutoff_auto_saved || d.pt_price_20270630_auto_saved);
  if(d.pt_pf_backfill_date) localStorage.setItem('pt_pf_backfill_date', d.pt_pf_backfill_date);
  if(d.pt_super_last_fy)    localStorage.setItem('pt_super_last_fy',    d.pt_super_last_fy);
  if(d.pt_price_feed_url)   localStorage.setItem('pt_price_feed_url',   d.pt_price_feed_url);
  if(d.pt_sync_key)      { syncKey = d.pt_sync_key; localStorage.setItem('pt_sync_key', d.pt_sync_key); }
  if(d.pt_sync_gist_id)    localStorage.setItem('pt_sync_gist_id', d.pt_sync_gist_id);
  if(d.pt_sync_device)   { syncDevice = d.pt_sync_device; localStorage.setItem('pt_sync_device', d.pt_sync_device); }
  if(d.pt_last_sync)       localStorage.setItem('pt_last_sync', d.pt_last_sync);
  // Worker code is embedded in the app — no need to restore it

  _pendingRestore = null;
  $('backup-preview').style.display = 'none';

  // Re-render everything
  try { onDataChanged(); } catch(e){} // defensive — savePfSnapshots() above already invalidates the pfSnapshots-derived caches
  refreshAllBrokerSelects();
  renderH(); renderT(); renderR(); renderHD();
  renderFYBar(); renderDividends(); renderDivCharts(); renderDivCards();
  renderProperties(); renderAnalytics();
  try { renderSuperAccounts(); renderSuperCards(); renderSuperChart(); } catch(e){}
  try { renderSpending(); } catch(e){}
  try { renderTax(); } catch(e){}
  try { renderOwnershipGrid(); } catch(e){}
  try { syncInitUI(); } catch(e){} // repopulate Settings → Cloud Sync fields with restored token/gist ID/device

  backupStatus('✓ Restore complete — ' + trades.length + ' trades, ' + dividends.length + ' dividends, ' + properties.length + ' properties, ' + Object.keys(pfSnapshots).length + ' days of portfolio history.', 'var(--green)');
  notify('Backup restored ✓');
}

function backupCancel(){
  _pendingRestore = null;
  $('backup-preview').style.display = 'none';
  backupStatus('Restore cancelled.', 'var(--text3)');
}

function backupStatus(msg, color){
  const el = $('backup-status');
  if(!el) return;
  el.style.display = '';
  el.style.color   = color || 'var(--text3)';
  el.textContent   = msg;
  setTimeout(()=>{ el.style.display='none'; }, 6000);
}



// ── XLSX / CSV EXPORT ─────────────────────────────────────────────────


function exportCSVZip(){
  const date = new Date().toISOString().slice(0,10);

  const sheets = buildExportSheets();

  // Since we can't natively zip in-browser without a lib, download each CSV individually
  // with a small delay between — user gets 5 files
  const files = Object.entries(sheets);
  let i = 0;
  function next(){
    if(i >= files.length) {
      backupStatus(`✓ ${files.length} CSV files downloaded`, 'var(--green)');
      return;
    }
    const [name, rows] = files[i++];
    if(!rows.length){ next(); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `portfolio-${name.toLowerCase()}-${date}.csv`);
    setTimeout(next, 400);
  }
  next();
}

function buildExportSheets(){
  // Returns {SheetName: [rowObjects]} for all datasets
  // Ensure spending data is loaded from localStorage
  if(!spendingData.length){ loadSpending(); }
  const tradeRows = trades.map(t => {
    const gross = (+t.units||0) * (+t.price||0);
    const net   = t.type === 'buy' ? gross + (+t.fees||0) : gross - (+t.fees||0);
    return {
      date: t.date, type: t.type, symbol: csvSafe(t.symbol), asset_type: t.assetType,
      units: +t.units||0, price: +t.price||0,
      gross_value: +gross.toFixed(4), fees: +t.fees||0, net_value: +net.toFixed(4),
      source: t.source||'', notes: csvSafe(t.notes||''),
      subtype: t.subtype||'', from_symbol: t.fromSymbol||'',
      ca_label: t.caLabel||'', split_ratio: t.splitRatio||'',
      alloc_pct: t.allocPct||'', override_cost_basis: t.overrideCostBasis||'',
    };
  });

  const divRows = dividends.map(d => ({
    date: d.date, symbol: csvSafe(d.symbol), type: d.type,
    amount: +d.amount, fy: dateToFY ? dateToFY(d.date) : '', notes: csvSafe(d.notes||''),
  }));

  const propRows = properties.map(p => {
    const splits = normaliseSplits(p);
    const totalBal  = splits.reduce((s,sp)=>s+(+sp.balance||0),0);
    const totalInit = splits.reduce((s,sp)=>s+(+sp.initial||0),0);
    const wtRate    = totalBal>0 ? splits.reduce((s,sp)=>s+((+sp.balance||0)/totalBal)*(+sp.rate||0),0) : 0;
    return {
      name: csvSafe(p.name), type: p.propType||'', purchase_date: p.purchaseDate||'',
      purchase_price: p.purchasePrice||0, purchase_costs: p.purchaseCosts||0,
      current_value: p.currentValue||0,
      loan_total_balance: +totalBal.toFixed(2),
      loan_total_initial: +totalInit.toFixed(2),
      wtd_avg_rate: +wtRate.toFixed(4),
      splits_json: JSON.stringify(splits),
      weekly_rent: p.weeklyRent||0, annual_expenses: p.annualExpenses||0,
      has_manager: p.hasManager||'', notes: csvSafe(p.notes||''),
    };
  });

  const spendRows = spendingData.map(s => ({
    date: s.date, fy: s.fy, amount: s.amount,
    direction: s.amount < 0 ? 'debit' : 'credit',
    category: s.category.startsWith('__') ? (
      {'__TRANSFERS__':'Internal Transfer','__REFUND__':'Refund','__OTHER_INCOME__':'Other Income'}[s.category] || s.category
    ) : s.category,
    merchant: csvSafe(s.merchant), details: csvSafe(s.details),
  }));

  let holdRows = [];
  try {
    holdRows = calcH().map(hh => {
      const avg = hh.units>0 ? hh.costBasis/hh.units : 0;
      const cur = prices[priceSymbol(hh.symbol)]||0;
      const mv  = +(cur*hh.units).toFixed(2);
      return {
        symbol: hh.symbol, asset_type: hh.assetType,
        units: +hh.units.toFixed(6), avg_cost: +avg.toFixed(4),
        current_price: cur,
        market_value: mv,
        cost_basis: +hh.costBasis.toFixed(2),
        unrealised_pnl: +(mv - hh.costBasis).toFixed(2),
        source: hh.source||'',
      };
    });
  } catch(e){}

  const settingsRows = [
    {key: 'cf_worker_url',  value: localStorage.getItem('cf_worker_url') || ''},
    {key: 'pt_drp_carry',  value: localStorage.getItem('pt_drp_carry') || '{}'},
    {key: 'pt_drp_skipped', value: localStorage.getItem('pt_drp_skipped') || '{}'},
    {key: 'pt_expdiv_skipped', value: localStorage.getItem('pt_expdiv_skipped') || '{}'},
    {key: 'cf_worker_code', value: WORKER_CODE},
    {key: 'export_date',    value: new Date().toISOString().slice(0,10)},
    {key: 'app_version',    value: 'Portfolio Tracker v3'},
  ];

  const superRows = superAccounts.map(a => ({
    name: a.name||'', balance: +a.balance||0,
    color: a.color||'',
    fy_data_json: JSON.stringify(a.fyData||{}),
    contrib_json: JSON.stringify(a.contrib||{}),
  }));

  // Filtered trade/holdings sheets
  const CRYPTO_TYPES = ['crypto'];
  const stockTradeRows = tradeRows.filter(r => !CRYPTO_TYPES.includes(r.asset_type));
  const cryptoTradeRows = tradeRows.filter(r => CRYPTO_TYPES.includes(r.asset_type));
  const stockHoldRows = holdRows.filter(r => !CRYPTO_TYPES.includes(r.asset_type));
  const cryptoHoldRows = holdRows.filter(r => CRYPTO_TYPES.includes(r.asset_type));
  const cryptoDivRows = divRows.filter(r => {
    const h = calcH().find(x=>x.symbol===r.symbol);
    return h && CRYPTO_TYPES.includes(h.assetType);
  });
  const stockDivRows = divRows.filter(r => !cryptoDivRows.some(c=>c.date===r.date&&c.symbol===r.symbol));

  return {
    Trades: tradeRows,
    'Trades-Stocks': stockTradeRows,
    'Trades-Crypto': cryptoTradeRows,
    Dividends: divRows,
    'Dividends-Stocks': stockDivRows,
    'Dividends-Crypto': cryptoDivRows,
    Holdings: holdRows,
    'Holdings-Stocks': stockHoldRows,
    'Holdings-Crypto': cryptoHoldRows,
    Properties: propRows,
    Super: superRows,
    Spending: spendRows,
    Settings: settingsRows,
  };
}

// ── Styling helpers for XLSX ───────────────────────────────────────────
function styleSheet(ws, headers){
  if(!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  // Bold header row
  for(let c = range.s.c; c <= range.e.c; c++){
    const cell = ws[XLSX.utils.encode_cell({r:0, c})];
    if(cell) cell.s = {font:{bold:true}, fill:{fgColor:{rgb:'1A2F4A'}}, font:{bold:true,color:{rgb:'FFFFFF'}}};
  }
}

function setColWidths(ws, widths){
  ws['!cols'] = widths.map(w => ({wch: w}));
}



// ── CSV IMPORT (from app's own exported CSVs) ─────────────────────────

function csvImport(type, input){
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const rows = csvParseRows(e.target.result);
      if(!rows.length){ backupStatus('✗ Empty or unreadable CSV.', 'var(--red)'); input.value=''; return; }
      let result;
      if(type === 'trades')     result = csvImportTrades(rows, file.name);
      if(type === 'dividends')  result = csvImportDividends(rows, file.name);
      if(type === 'properties') result = csvImportProperties(rows, file.name);
      if(type === 'spending')   result = csvImportSpending(rows, file.name);
      if(type === 'super')      result = csvImportSuper(rows, file.name);
      if(result) backupStatus(result.msg, result.ok ? 'var(--green)' : 'var(--red)');
    } catch(err) {
      backupStatus('✗ Error reading CSV: ' + err.message, 'var(--red)');
    }
    input.value = '';
  };
  reader.readAsText(file);
}

// Parse CSV text → array of {header: value} objects
function csvParseRows(text){
  const lines = text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(l => l.trim());
  if(lines.length < 2) return [];
  const headers = csvSplitLine(lines[0]).map(h => h.trim().toLowerCase().replace(/[\uFEFF]/g,'').replace(/\s+/g,'_'));
  const rows = [];
  for(let i = 1; i < lines.length; i++){
    const vals = csvSplitLine(lines[i]);
    if(!vals.some(v => v.trim())) continue; // skip blank rows
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (vals[idx] || '').trim(); });
    rows.push(obj);
  }
  return rows;
}

function csvSplitLine(line){
  const result = []; let cur = '', inQ = false;
  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    if(ch === '"'){ inQ = !inQ; }
    else if(ch === ',' && !inQ){ result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

// ── Trades CSV import ─────────────────────────────────────────────────
function csvImportTrades(rows, filename){
  // Accepts the app's own export format (snake_case headers from buildExportSheets)
  // Required: date, type, symbol, asset_type, units, price
  const r = rows[0];
  if(!('date' in r) || !('type' in r) || !('symbol' in r)){
    return {ok:false, msg:`✗ ${filename}: Missing required columns (date, type, symbol). Make sure this is a Trades CSV exported from this app.`};
  }
  let added = 0, skipped = 0, errors = 0;
  for(const r of rows){
    const t = {
      date:      r.date || '',
      type:      r.type || 'buy',
      symbol:    (r.symbol || '').toUpperCase(),
      assetType: r.asset_type || r.assettype || 'stock',
      units:     parseFloat(r.units) || 0,
      price:     parseFloat(r.price) || 0,
      fees:      parseFloat(r.fees) || 0,
      source:    r.source || 'csv',
      notes:     r.notes || '',
      id:        uid(),
      // Corporate action extras
      subtype:           r.subtype || undefined,
      fromSymbol:        r.from_symbol || r.fromsymbol || undefined,
      caLabel:           r.ca_label || r.calabel || undefined,
      splitRatio:        r.split_ratio || r.splitratio || undefined,
      allocPct:          r.alloc_pct || r.allocpct || undefined,
      overrideCostBasis: parseFloat(r.override_cost_basis || r.overridecostbasis) || undefined,
    };
    // Clean up undefined extras
    ['subtype','fromSymbol','caLabel','splitRatio','allocPct','overrideCostBasis']
      .forEach(k => { if(!t[k]) delete t[k]; });
    if(!t.date || !t.symbol || !t.units || t.units <= 0){ errors++; continue; }
    if(isTradeDuplicate(t)){ skipped++; continue; }
    trades.push(t);
    added++;
  }
  if(added) { save(); renderT(); renderH(); renderR(); if(typeof renderAnalytics==='function') renderAnalytics(); }
  return {ok:true, msg:`✓ Trades from ${filename}: ${added} added, ${skipped} skipped (dupes)${errors ? ', '+errors+' invalid rows ignored' : ''}`};
}

// ── Dividends CSV import ──────────────────────────────────────────────
function csvImportDividends(rows, filename){
  const r = rows[0];
  if(!('date' in r) || !('symbol' in r) || !('amount' in r)){
    return {ok:false, msg:`✗ ${filename}: Missing required columns (date, symbol, amount).`};
  }
  let added = 0, skipped = 0, errors = 0;
  for(const r of rows){
    const frkV = r.frankingPct ?? r.franking_pct ?? r['franking%'] ?? r.frankingpct ?? null;
    const frkPct = frkV !== null ? Math.min(100,Math.max(0,parseFloat(frkV)||0)) : null;
    const d = {
      date:   r.date || '',
      symbol: (r.symbol || '').toUpperCase(),
      amount: parseFloat(r.amount) || 0,
      type:   r.type || 'dividend',
      notes:  r.notes || '',
      frankingPct: frkV !== null ? frkPct : null,
      id:     uid(),
    };
    if(!d.date || !d.symbol || !d.amount || d.amount <= 0){ errors++; continue; }
    // Dedup: same date + symbol + amount
    const isDup = dividends.some(x =>
      x.date === d.date && x.symbol === d.symbol && Math.abs(x.amount - d.amount) < 0.001
    );
    if(isDup){ skipped++; continue; }
    dividends.push(d);
    added++;
  }
  if(added){ save(); renderFYBar(); renderDividends(); renderDivCharts(); renderDivCards(); }
  return {ok:true, msg:`✓ Dividends from ${filename}: ${added} added, ${skipped} skipped${errors ? ', '+errors+' invalid' : ''}`};
}

// ── Properties CSV import ─────────────────────────────────────────────
function csvImportSuper(rows, filename){
  if(!rows.length) return {ok:false, msg:`✗ ${filename}: Empty file.`};
  const g = (r, ...keys) => { for(const k of keys){ if(k in r) return r[k]; } return ''; };
  let added=0, skipped=0;
  for(const r of rows){
    const name = (g(r,'name')||'').trim();
    if(!name){ skipped++; continue; }
    if(superAccounts.some(a=>a.name.toLowerCase()===name.toLowerCase())){ skipped++; continue; }
    let fyData = {};
    const fyJson = g(r,'fy_data_json','fy data (json)','fydata');
    if(fyJson){ try{ fyData = JSON.parse(fyJson); }catch(e){} }
    let contrib = {};
    const ctJson = g(r,'contrib_json','contrib');
    if(ctJson){ try{ contrib = JSON.parse(ctJson); }catch(e){} }
    superAccounts.push({
      id: 'su_'+uid(), name,
      balance: parseFloat(g(r,'balance','current balance','current_balance'))||0,
      color:   g(r,'colour','color')||'#3b82f6',
      fyData, contrib,
    });
    added++;
  }
  if(added){ saveSuperAccounts(); renderSuperAccounts(); renderSuperCards(); renderSuperChart(); }
  return {ok:true, msg:`✓ Super from ${filename}: ${added} added, ${skipped} skipped`};
}

function csvImportProperties(rows, filename){
  const r = rows[0];
  if(!('name' in r) || !('purchase_price' in r) && !('purchaseprice' in r)){
    return {ok:false, msg:`✗ ${filename}: Missing required columns (name, purchase_price).`};
  }
  const g = (r, ...keys) => { for(const k of keys){ if(k in r) return r[k]; } return ''; };
  let added = 0, skipped = 0;
  for(const r of rows){
    const name = (g(r,'name')||'').trim();
    if(!name){ skipped++; continue; }
    if(properties.some(p => p.name.toLowerCase() === name.toLowerCase())){ skipped++; continue; }

    // Handle splits — new format has splits_json column; fall back to legacy single-loan columns
    let splits = null;
    const splitsJson = g(r,'splits_json','splits','splits (json)');
    if(splitsJson){
      try { splits = JSON.parse(splitsJson); } catch(e){}
    }
    // Legacy single-loan fallback → create one split
    if(!splits || !splits.length){
      const loanInit = parseFloat(g(r,'loan_initial','loanInitial','loaninital','loan_total_initial')) || 0;
      const loanCur  = parseFloat(g(r,'loan_current','loancurrent','loan_total_balance')) || 0;
      const rate     = parseFloat(g(r,'interest_rate','interestrate','wtd_avg_rate','wtd avg rate %')) || 0;
      if(loanCur || loanInit || rate){
        splits = [{
          id: 'sp_'+uid(), label:'Split 1',
          initial: loanInit, balance: loanCur,
          rate, ltype: g(r,'loan_type','loantype') || 'pi',
          term: parseFloat(g(r,'loan_term_yrs','loantermyrs','loanterm')) || 0,
          repay: parseFloat(g(r,'monthly_repayment','monthlyrepayment')) || 0,
          offset: parseFloat(g(r,'offset_balance','offsetbalance')) || 0,
        }];
      } else {
        splits = [];
      }
    }

    const p = {
      id:            'prop_' + uid(),
      name,
      propType:      g(r,'type','proptype','prop_type','propType') || 'investment',
      purchaseDate:  g(r,'purchase_date','purchasedate') || '',
      purchasePrice: parseFloat(g(r,'purchase_price','purchaseprice')) || 0,
      purchaseCosts: parseFloat(g(r,'purchase_costs','purchasecosts')) || 0,
      currentValue:  parseFloat(g(r,'current_value','currentvalue')) || 0,
      splits,
      weeklyRent:    parseFloat(g(r,'weekly_rent','weeklyrent')) || 0,
      annualExpenses:parseFloat(g(r,'annual_expenses','annualexpenses')) || 0,
      hasManager:    g(r,'has_manager','hasmanager') || 'no',
      owner:         g(r,'owner','property_owner') || 'joint',
      notes:         g(r,'notes') || '',
    };
    properties.push(p);
    added++;
  }
  if(added){ saveProps(); renderProperties(); renderPropCards(); if(typeof renderTax==='function') renderTax(); }
  return {ok:true, msg:`✓ Properties from ${filename}: ${added} added, ${skipped} skipped (name already exists)`};
}

// ── Spending CSV import ───────────────────────────────────────────────
function csvImportSpending(rows, filename){
  const r = rows[0];
  if(!('date' in r) || !('amount' in r)){
    return {ok:false, msg:`✗ ${filename}: Missing required columns (date, amount).`};
  }
  // Reverse-map display category names back to internal codes
  const CAT_REVERSE = {
    'internal transfer': '__TRANSFERS__',
    'refund':            '__REFUND__',
    'other income':      '__OTHER_INCOME__',
  };
  let added = 0, skipped = 0, errors = 0;
  for(const r of rows){
    const dateRaw = r.date || '';
    const amt = parseFloat(r.amount);
    if(!dateRaw || isNaN(amt)){ errors++; continue; }
    const date = spNormaliseDate(dateRaw);
    if(!date){ errors++; continue; }
    const fy = spDateToFY(date);
    if(!fy){ errors++; continue; }
    const catRaw = (r.category || '').toLowerCase().trim();
    const category = CAT_REVERSE[catRaw]
      || SP_CAT_MAP[r.category]
      || SP_CAT_MAP[r.category.toLowerCase()]
      || r.category
      || 'Other Shopping';
    const merchant = (r.merchant || r.details || '').slice(0, 60);
    const details  = r.details || r.merchant || '';
    const rec = { date, fy, amount: amt, category, merchant, details };
    if(isDupSpend(rec, spendingData)){ skipped++; continue; }
    spendingData.push(rec);
    added++;
  }
  if(added){ saveSpending(); }
  if(document.querySelector('#panel-spending.active')){
    const fys = [...new Set(spendingData.map(d=>d.fy))].sort();
    if(fys.length) spFY = fys[fys.length-1];
    renderSpFYBar(); renderSpending();
  }
  return {ok:true, msg:`✓ Spending from ${filename}: ${added} added, ${skipped} skipped${errors ? ', '+errors+' invalid' : ''}`};
}


const WORKER_CODE = [
  "const CORS = { \"Content-Type\": \"application/json\", \"Access-Control-Allow-Origin\": \"*\" };",
  "",
  "// ── Backfill resolution tiers ──────────────────────────────────────────",
  "// Full daily detail from DAILY_SINCE onward (covers 1D/5D/1M/3M/6M exactly).",
  "// Before that, only periodic anchor points are stored — keeps the KV",
  "// \"history:blob\" from growing without bound over many years/symbols, while",
  "// 1Y/5Y/ALL still get an accurate-enough shape from real traded prices",
  "// (never fabricated/interpolated — see downsampleSeries below).",
  "const DAILY_SINCE   = \"2025-07-01\";",
  "const HISTORY_START = \"2018-01-01\";",
  "",
  "// ── Shared: fetch a single ASX/Yahoo price ────────────────────────────",
  "async function fetchYahooPrice(sym) {",
  "  try {",
  "    const yUrl = \"https://query1.finance.yahoo.com/v8/finance/chart/\" + encodeURIComponent(sym)",
  "      + \"?interval=1d&range=1d\";",
  "    const r = await fetch(yUrl, { headers: { \"User-Agent\": \"Mozilla/5.0\" } });",
  "    if (!r.ok) return null;",
  "    const d = await r.json();",
  "    const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice;",
  "    return price || null;",
  "  } catch (e) { return null; }",
  "}",
  "",
  "// ── Shared: fetch crypto prices (AUD) via CoinGecko ───────────────────",
  "async function fetchCryptoPrices(ids) {",
  "  if (!ids.length) return {};",
  "  try {",
  "    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=aud`);",
  "    if (!r.ok) return {};",
  "    const d = await r.json();",
  "    const out = {};",
  "    for (const id of ids) if (d[id]?.aud) out[id] = d[id].aud;",
  "    return out;",
  "  } catch (e) { return {}; }",
  "}",
  "",
  "// Today's date in Brisbane time (UTC+10, no DST) as YYYY-MM-DD",
  "function brisbaneDateKey() {",
  "  return new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString().slice(0, 10);",
  "}",
  "",
  "// ── Daily 5pm snapshot — runs via Cron Trigger, independent of the app ─",
  "async function runDailySnapshot(env) {",
  "  const [heldAsxRaw, heldCryptoRaw] = await Promise.all([",
  "    env.PT_KV.get('held:asx'),",
  "    env.PT_KV.get('held:crypto'),",
  "  ]);",
  "  const asxSyms   = heldAsxRaw    ? JSON.parse(heldAsxRaw)    : [];",
  "  const cryptoIds = heldCryptoRaw ? JSON.parse(heldCryptoRaw) : [];",
  "",
  "  const prices = {};",
  "  await Promise.all(asxSyms.map(async sym => {",
  "    const price = await fetchYahooPrice(sym);",
  "    if (price) prices[sym] = price;",
  "  }));",
  "  const cryptoPrices = await fetchCryptoPrices(cryptoIds);",
  "  Object.assign(prices, cryptoPrices);",
  "",
  "  if (!Object.keys(prices).length) return; // nothing fetched — don't write an empty/misleading day",
  "",
  "  await env.PT_KV.put('prices:' + brisbaneDateKey(), JSON.stringify(prices));",
  "}",
  "",
  "// ─────────────────────────────────────────────────────────────────────",
  "// FULL HISTORICAL BACKFILL (one-off, triggered manually via ?backfillFull=1)",
  "// ─────────────────────────────────────────────────────────────────────",
  "",
  "// Same map as the client's helpers.js CG object, reversed (id → ticker),",
  "// so a CoinGecko id from held:crypto can be turned into a Yahoo \"-USD\" ticker.",
  "const CG_ID_TO_SYM = {",
  "  bitcoin:'BTC', ethereum:'ETH', ripple:'XRP', litecoin:'LTC', 'bitcoin-cash':'BCH',",
  "  'ethereum-classic':'ETC', algorand:'ALGO', binancecoin:'BNB', solana:'SOL', cardano:'ADA',",
  "  polkadot:'DOT', chainlink:'LINK', dogecoin:'DOGE', 'avalanche-2':'AVAX', 'matic-network':'MATIC',",
  "  uniswap:'UNI', cosmos:'ATOM', near:'NEAR', fantom:'FTM', vechain:'VET', 'shiba-inu':'SHIB',",
  "  tether:'USDT', 'usd-coin':'USDC', stellar:'XLM', tron:'TRX', 'hedera-hashgraph':'HBAR',",
  "  'internet-computer':'ICP', 'immutable-x':'IMX', optimism:'OP', arbitrum:'ARB', sui:'SUI', aptos:'APT',",
  "  'axie-infinity':'AXS',",
  "};",
  "// Coins whose Yahoo ticker doesn't follow the standard \"<SYM>-USD\" pattern —",
  "// usually because the underlying token migrated/rebranded and Yahoo tracks",
  "// the SAME asset under a new, unrelated ticker rather than continuing to",
  "// update the old one. \"FTM-USD\" stopped updating after Fantom's May 2025",
  "// migration to Sonic (S); Yahoo now lists it as \"S32684-USD\" (\"Sonic (prev.",
  "// FTM) USD\"). Add further entries here as other coins rebrand.",
  "const CG_ID_TO_YAHOO_TICKER_OVERRIDE = {",
  "  fantom: 'S32684-USD',",
  "};",
  "function cryptoYahooTicker(cgId, sym){",
  "  return CG_ID_TO_YAHOO_TICKER_OVERRIDE[cgId] || (sym + '-USD');",
  "}",
  "// Same idea as the crypto override above, for ASX tickers that were renamed",
  "// via a corporate action after being held — Yahoo continues the security's",
  "// FULL price history (including pre-rename dates) under its current/final",
  "// ticker, and simply has nothing under the old, no-longer-existing one.",
  "// Keyed by the \".AX\" symbol as it appears in held:asx-all (i.e. what the",
  "// trade ledger still calls it) → the ticker to actually query on Yahoo.",
  "// Results are still stored/reported under the ORIGINAL key so the app's",
  "// own lookups (which only ever ask for the old symbol) keep working.",
  "const ASX_TICKER_OVERRIDE = {",
  "  'DW8.AX': 'KDY.AX', // renamed via corporate action, delisted 2025-03-03",
  "};",
  "function asxYahooTicker(key){",
  "  return ASX_TICKER_OVERRIDE[key] || key;",
  "}",
  "// Full daily close history for an ASX (or any Yahoo) ticker, one request.",
  "// Yahoo's chart API often returns `close` as null for most of a long",
  "// range while `adjclose` stays populated throughout — fall back to it",
  "// rather than silently dropping the bulk of the history.",
  "async function fetchYahooHistory(sym) {",
  "  try {",
  "    const url = \"https://query1.finance.yahoo.com/v8/finance/chart/\" + encodeURIComponent(sym)",
  "      + \"?interval=1d&range=max\";",
  "    const r = await fetch(url, { headers: { \"User-Agent\": \"Mozilla/5.0\" } });",
  "    if (!r.ok) return {};",
  "    const d = await r.json();",
  "    const result = d?.chart?.result?.[0];",
  "    if (!result) return {};",
  "    const ts        = result.timestamp || [];",
  "    const closes    = result.indicators?.quote?.[0]?.close || [];",
  "    const adjcloses = result.indicators?.adjclose?.[0]?.adjclose || [];",
  "    // Yahoo's \"max\" range sometimes returns priced days from BEFORE a fund's",
  "    // actual ASX listing (e.g. a backtested/NAV-proxy series). meta.firstTradeDate",
  "    // is Yahoo's own record of the real first trading day — use it as a floor",
  "    // so pre-listing data never enters the blob in the first place.",
  "    const firstTradeDate = result.meta?.firstTradeDate",
  "      ? new Date(result.meta.firstTradeDate * 1000).toISOString().slice(0, 10)",
  "      : null;",
  "    const out = {};",
  "    ts.forEach((t, i) => {",
  "      const c = closes[i] != null ? closes[i] : adjcloses[i];",
  "      if (c == null) return;",
  "      const dateKey = new Date(t * 1000).toISOString().slice(0, 10);",
  "      if (firstTradeDate && dateKey < firstTradeDate) return;",
  "      out[dateKey] = c;",
  "    });",
  "    return out;",
  "  } catch (e) { return {}; }",
  "}",
  "",
  "// Lightweight metadata-only fetch (range=1d avoids pulling the full price",
  "// series) — used by pruneHistory to find each held symbol's real listing",
  "// date so stray pre-listing entries already in KV can be stripped out.",
  "async function fetchYahooFirstTradeDate(sym) {",
  "  try {",
  "    const url = \"https://query1.finance.yahoo.com/v8/finance/chart/\" + encodeURIComponent(sym)",
  "      + \"?interval=1d&range=1d\";",
  "    const r = await fetch(url, { headers: { \"User-Agent\": \"Mozilla/5.0\" } });",
  "    if (!r.ok) return null;",
  "    const d = await r.json();",
  "    const ftd = d?.chart?.result?.[0]?.meta?.firstTradeDate;",
  "    return ftd ? new Date(ftd * 1000).toISOString().slice(0, 10) : null;",
  "  } catch (e) { return null; }",
  "}",
  "",
  "// Historical USD→AUD rate, ECB data via Frankfurter (free, no key, back to 1999).",
  "async function fetchFXHistory(sinceStr) {",
  "  try {",
  "    const today = brisbaneDateKey();",
  "    const url = `https://api.frankfurter.app/${sinceStr}..${today}?from=USD&to=AUD`;",
  "    const r = await fetch(url);",
  "    if (!r.ok) return {};",
  "    const d = await r.json();",
  "    const out = {};",
  "    for (const [dateKey, rates] of Object.entries(d.rates || {})) {",
  "      if (rates && rates.AUD) out[dateKey] = rates.AUD;",
  "    }",
  "    return out;",
  "  } catch (e) { return {}; }",
  "}",
  "",
  "// FX only has rates for banking days — carry the most recent known rate",
  "// forward for weekends/holidays (binary search on the sorted date list).",
  "function fxRateFor(dateKey, fx, sortedFxDates) {",
  "  if (fx[dateKey] != null) return fx[dateKey];",
  "  let lo = 0, hi = sortedFxDates.length - 1, ans = null;",
  "  while (lo <= hi) {",
  "    const mid = (lo + hi) >> 1;",
  "    if (sortedFxDates[mid] <= dateKey) { ans = sortedFxDates[mid]; lo = mid + 1; }",
  "    else hi = mid - 1;",
  "  }",
  "  return ans ? fx[ans] : null;",
  "}",
  "",
  "// Reduce a pre-DAILY_SINCE daily series down to periodic anchor points.",
  "// Days on/after `dailySince` always pass through untouched at full daily",
  "// resolution. Older days are sampled on a fixed cadence (every 14 calendar",
  "// days for \"fortnightly\", or by calendar month for \"monthly\"), and each",
  "// anchor is snapped to the NEAREST trading day actually present in the",
  "// series (±7 calendar days) — so every stored point is a real historical",
  "// price, never an interpolated or fabricated one. If no trading day falls",
  "// within the window (e.g. a long-delisted/new symbol) that anchor is",
  "// simply skipped.",
  "function downsampleSeries(series, dailySince, resolution) {",
  "  const dates = Object.keys(series).sort();",
  "  if (!dates.length) return {};",
  "  const out = {};",
  "  for (const d of dates) if (d >= dailySince) out[d] = series[d];",
  "  const older = dates.filter(d => d < dailySince);",
  "  if (!older.length) return out;",
  "  const oldSet = new Set(older);",
  "  const nearestTradingDay = (anchorKey) => {",
  "    if (oldSet.has(anchorKey)) return anchorKey;",
  "    const base = new Date(anchorKey + 'T00:00:00Z').getTime();",
  "    for (let off = 1; off <= 7; off++) {",
  "      const fwd = new Date(base + off * 86400000).toISOString().slice(0, 10);",
  "      if (oldSet.has(fwd)) return fwd;",
  "      const back = new Date(base - off * 86400000).toISOString().slice(0, 10);",
  "      if (oldSet.has(back)) return back;",
  "    }",
  "    return null;",
  "  };",
  "  let anchor = new Date(older[0] + 'T00:00:00Z');",
  "  const cutoff = new Date(dailySince + 'T00:00:00Z');",
  "  while (anchor < cutoff) {",
  "    const anchorKey = anchor.toISOString().slice(0, 10);",
  "    const found = nearestTradingDay(anchorKey);",
  "    if (found) out[found] = series[found];",
  "    if (resolution === 'monthly') anchor.setUTCMonth(anchor.getUTCMonth() + 1);",
  "    else anchor.setUTCDate(anchor.getUTCDate() + 14); // fortnightly (default)",
  "  }",
  "  return out;",
  "}",
  "",
  "// Processes a small SLICE of (asx + crypto) symbols per call — keeps each",
  "// Worker invocation's subrequest count low and avoids bursting Yahoo/",
  "// Yahoo/CoinGecko with 20-30 rapid requests at once (results were silently getting",
  "// rate-limited/truncated when everything ran in one shot). Merges into",
  "// the existing blob rather than overwriting, so repeated calls with",
  "// increasing `offset` accumulate instead of clobbering prior batches.",
  "// Returns a per-symbol `report` so failures are visible, not swallowed.",
  "async function runFullBackfillBatch(env, since, offset, limit, resolution) {",
  "  const [heldAsxRaw, heldCryptoRaw, heldAsxAllRaw, heldCryptoAllRaw] = await Promise.all([",
  "    env.PT_KV.get('held:asx'),",
  "    env.PT_KV.get('held:crypto'),",
  "    env.PT_KV.get('held:asx-all'),",
  "    env.PT_KV.get('held:crypto-all'),",
  "  ]);",
  "  // Backfill covers every symbol EVER held (held:*-all), not just currently",
  "  // held ones — otherwise a fully-sold position never gets its history",
  "  // fetched at all. Falls back to the current-only list if -all hasn't",
  "  // been populated yet (e.g. right after this is first deployed, before",
  "  // the app's next syncHoldings call).",
  "  const asxSyms   = heldAsxAllRaw    ? JSON.parse(heldAsxAllRaw)    : (heldAsxRaw    ? JSON.parse(heldAsxRaw)    : []); // e.g. \"DHHF.AX\"",
  "  const cryptoIds = heldCryptoAllRaw ? JSON.parse(heldCryptoAllRaw) : (heldCryptoRaw ? JSON.parse(heldCryptoRaw) : []); // e.g. \"bitcoin\"",
  "",
  "  const work = [",
  "    ...asxSyms.map(key => ({ type: 'asx', key })),",
  "    ...cryptoIds.map(key => ({ type: 'crypto', key })),",
  "  ];",
  "  const batch = work.slice(offset, offset + limit);",
  "",
  "  const needsFx = batch.some(w => w.type === 'crypto');",
  "  const fx = needsFx ? await fetchFXHistory(since) : {};",
  "  const fxDates = Object.keys(fx).sort();",
  "",
  "  const report = [];",
  "  const blobDelta = {};",
  "",
  "  const res = resolution === 'monthly' ? 'monthly' : 'fortnightly';",
  "",
  "  for (const item of batch) {",
  "    if (item.type === 'asx') {",
  "      const fullSeries = await fetchYahooHistory(asxYahooTicker(item.key));",
  "      const raw = {};",
  "      for (const d of Object.keys(fullSeries)) if (d >= since) raw[d] = fullSeries[d];",
  "      const series = downsampleSeries(raw, DAILY_SINCE, res);",
  "      const days = Object.keys(series);",
  "      for (const d of days) (blobDelta[d] ||= {})[item.key] = series[d];",
  "      report.push({ symbol: item.key, type: 'asx', days: days.length, rawDays: Object.keys(raw).length });",
  "      continue;",
  "    }",
  "    const sym = CG_ID_TO_SYM[item.key];",
  "    if (!sym) { report.push({ symbol: item.key, type: 'crypto', days: 0, error: 'unmapped CoinGecko id' }); continue; }",
  "    // Crypto via Yahoo (same source/function as ASX — Binance is blocked",
  "    // from Cloudflare Workers at the network level, confirmed unfixable).",
  "    const ticker = cryptoYahooTicker(item.key, sym);",
  "    const fullSeries = await fetchYahooHistory(ticker);",
  "    const rawAud = {};",
  "    for (const [d, priceUsd] of Object.entries(fullSeries)) {",
  "      if (d < since) continue;",
  "      const rate = fxRateFor(d, fx, fxDates);",
  "      if (!rate) continue;",
  "      rawAud[d] = priceUsd * rate;",
  "    }",
  "    const series = downsampleSeries(rawAud, DAILY_SINCE, res);",
  "    const days = Object.keys(series);",
  "    for (const d of days) (blobDelta[d] ||= {})[item.key] = series[d];",
  "    report.push({ symbol: item.key, type: 'crypto', ticker, days: days.length, rawDays: Object.keys(rawAud).length });",
  "  }",
  "",
  "  const existingRaw = await env.PT_KV.get('history:blob');",
  "  const blob = existingRaw ? JSON.parse(existingRaw) : {};",
  "  for (const [d, prices] of Object.entries(blobDelta)) {",
  "    blob[d] = { ...(blob[d] || {}), ...prices };",
  "  }",
  "  await env.PT_KV.put('history:blob', JSON.stringify(blob));",
  "",
  "  return {",
  "    ok: true,",
  "    since, offset, limit, resolution: res, dailySince: DAILY_SINCE,",
  "    processed: batch.map(w => w.key),",
  "    report,",
  "    totalSymbols: work.length,",
  "    nextOffset: offset + limit < work.length ? offset + limit : null,",
  "    done: offset + limit >= work.length,",
  "    daysStoredTotal: Object.keys(blob).length,",
  "  };",
  "}",
  "",
  "// Cleans stray pre-listing entries already sitting in the KV blob (from",
  "// before this worker started filtering on firstTradeDate). Batched the",
  "// same way as the backfill — call repeatedly with nextOffset until done.",
  "async function runPruneHistoryBatch(env, offset, limit) {",
  "  const [heldAsxRaw, heldCryptoRaw, heldAsxAllRaw, heldCryptoAllRaw] = await Promise.all([",
  "    env.PT_KV.get('held:asx'),",
  "    env.PT_KV.get('held:crypto'),",
  "    env.PT_KV.get('held:asx-all'),",
  "    env.PT_KV.get('held:crypto-all'),",
  "  ]);",
  "  const asxSyms   = heldAsxAllRaw    ? JSON.parse(heldAsxAllRaw)    : (heldAsxRaw    ? JSON.parse(heldAsxRaw)    : []);",
  "  const cryptoIds = heldCryptoAllRaw ? JSON.parse(heldCryptoAllRaw) : (heldCryptoRaw ? JSON.parse(heldCryptoRaw) : []);",
  "  const work = [",
  "    ...asxSyms.map(key => ({ type: 'asx', key, ticker: asxYahooTicker(key) })),",
  "    ...cryptoIds.map(key => {",
  "      const sym = CG_ID_TO_SYM[key];",
  "      return { type: 'crypto', key, ticker: sym ? cryptoYahooTicker(key, sym) : null };",
  "    }),",
  "  ];",
  "  const batch = work.slice(offset, offset + limit);",
  "",
  "  const blobRaw = await env.PT_KV.get('history:blob');",
  "  const blob = blobRaw ? JSON.parse(blobRaw) : {};",
  "  const dates = Object.keys(blob);",
  "",
  "  const report = [];",
  "  let totalRemoved = 0;",
  "  for (const item of batch) {",
  "    if (!item.ticker) { report.push({ symbol: item.key, error: 'unmapped CoinGecko id' }); continue; }",
  "    const firstTradeDate = await fetchYahooFirstTradeDate(item.ticker);",
  "    if (!firstTradeDate) { report.push({ symbol: item.key, removed: 0, note: 'no firstTradeDate from Yahoo' }); continue; }",
  "    let removed = 0;",
  "    for (const d of dates) {",
  "      if (d < firstTradeDate && blob[d] && Object.prototype.hasOwnProperty.call(blob[d], item.key)) {",
  "        delete blob[d][item.key];",
  "        removed++;",
  "        if (!Object.keys(blob[d]).length) delete blob[d];",
  "      }",
  "    }",
  "    totalRemoved += removed;",
  "    report.push({ symbol: item.key, firstTradeDate, removed });",
  "  }",
  "",
  "  await env.PT_KV.put('history:blob', JSON.stringify(blob));",
  "",
  "  return {",
  "    ok: true, offset, limit,",
  "    processed: batch.map(w => w.key),",
  "    report,",
  "    totalRemoved,",
  "    totalSymbols: work.length,",
  "    nextOffset: offset + limit < work.length ? offset + limit : null,",
  "    done: offset + limit >= work.length,",
  "    daysStoredTotal: Object.keys(blob).length,",
  "  };",
  "}",
  "",
  "export default {",
  "  async fetch(request, env) {",
  "    const url = new URL(request.url);",
  "",
  "    // ── MAIF unit price via Monash Ninja Tables public API ────────",
  "    if (url.searchParams.get(\"maif\") === \"1\") {",
  "      try {",
  "        const apiUrl = \"https://monashinvestors.com/wp-admin/admin-ajax.php\"",
  "          + \"?action=wp_ajax_ninja_tables_public_action\"",
  "          + \"&table_id=11330\"",
  "          + \"&target_action=get-all-data\"",
  "          + \"&default_sorting=old_first\"",
  "          + \"&skip_rows=0&limit_rows=0\"",
  "          + \"&ninja_table_public_nonce=cec8148613\";",
  "        const res = await fetch(apiUrl, {",
  "          headers: { \"User-Agent\": \"Mozilla/5.0\", \"Referer\": \"https://monashinvestors.com/\" }",
  "        });",
  "        if (!res.ok) return new Response(JSON.stringify({ error: \"HTTP \" + res.status }), { headers: CORS });",
  "        const rows = await res.json();",
  "        let buyPrice = null;",
  "        for (const row of rows) {",
  "          const field = (row.value && row.value.field) ? row.value.field.trim().toLowerCase() : \"\";",
  "          const val   = (row.value && row.value.value) ? parseFloat(row.value.value) : null;",
  "          if (field === \"buy\" && val > 0) { buyPrice = val; break; }",
  "        }",
  "        if (buyPrice) return new Response(JSON.stringify({ MAIF: buyPrice }), { headers: CORS });",
  "        return new Response(JSON.stringify({ error: \"buy price not found\", rows }), { headers: CORS });",
  "      } catch(e) {",
  "        return new Response(JSON.stringify({ error: e.message }), { headers: CORS });",
  "      }",
  "    }",
  "",
  "    // ── Dividend history (?divs=DHHF.AX,VAS.AX) ──────────────────",
  "    if (url.searchParams.get(\"divs\")) {",
  "      const symList = url.searchParams.get(\"divs\").split(\",\").map(s => s.trim()).filter(Boolean);",
  "      const results = {};",
  "      await Promise.all(symList.map(async sym => {",
  "        try {",
  "          const yUrl = \"https://query1.finance.yahoo.com/v8/finance/chart/\" + encodeURIComponent(sym)",
  "            + \"?events=dividends&interval=1d&range=max\";",
  "          const r = await fetch(yUrl, { headers: { \"User-Agent\": \"Mozilla/5.0\" } });",
  "          if (!r.ok) { results[sym] = { error: \"HTTP \" + r.status }; return; }",
  "          const d = await r.json();",
  "          const divMap  = d?.chart?.result?.[0]?.events?.dividends || {};",
  "          const currency = d?.chart?.result?.[0]?.meta?.currency || \"AUD\";",
  "          results[sym] = {",
  "            currency,",
  "            dividends: Object.values(divMap)",
  "              .map(v => ({ date: new Date(v.date * 1000).toISOString().slice(0,10), amount: v.amount }))",
  "              .sort((a, b) => a.date.localeCompare(b.date))",
  "          };",
  "        } catch(e) { results[sym] = { error: e.message }; }",
  "      }));",
  "      return new Response(JSON.stringify(results), { headers: CORS });",
  "    }",
  "",
  "    // ── Sync held symbols (app calls this on open/refresh) ─────────",
  "    // ?syncHoldings=1&asx=DHHF.AX,VAS.AX&crypto=bitcoin,ethereum",
  "    //   &asxAll=...&cryptoAll=...",
  "    // held:asx / held:crypto = CURRENTLY held only — what the daily live-",
  "    // price cron needs (no point pricing something no longer owned).",
  "    // held:asx-all / held:crypto-all = every symbol EVER synced, additive-",
  "    // only (never removed) — backfill/prune read from THIS, so a fully-",
  "    // sold position keeps its historical data fetchable instead of being",
  "    // silently skipped forever the moment it drops out of \"currently held\".",
  "    // GET only (no CORS preflight needed), consistent with every other",
  "    // endpoint here.",
  "    if (url.searchParams.get(\"syncHoldings\") === \"1\") {",
  "      const asx      = (url.searchParams.get(\"asx\")      || \"\").split(\",\").map(s => s.trim()).filter(Boolean);",
  "      const crypto   = (url.searchParams.get(\"crypto\")   || \"\").split(\",\").map(s => s.trim()).filter(Boolean);",
  "      const asxAll   = (url.searchParams.get(\"asxAll\")    || \"\").split(\",\").map(s => s.trim()).filter(Boolean);",
  "      const cryptoAll= (url.searchParams.get(\"cryptoAll\") || \"\").split(\",\").map(s => s.trim()).filter(Boolean);",
  "",
  "      const [existingAsxAllRaw, existingCryptoAllRaw] = await Promise.all([",
  "        env.PT_KV.get('held:asx-all'),",
  "        env.PT_KV.get('held:crypto-all'),",
  "      ]);",
  "      const mergedAsxAll    = [...new Set([...(existingAsxAllRaw    ? JSON.parse(existingAsxAllRaw)    : []), ...asxAll,    ...asx])];",
  "      const mergedCryptoAll = [...new Set([...(existingCryptoAllRaw ? JSON.parse(existingCryptoAllRaw) : []), ...cryptoAll, ...crypto])];",
  "",
  "      await Promise.all([",
  "        env.PT_KV.put('held:asx', JSON.stringify(asx)),",
  "        env.PT_KV.put('held:crypto', JSON.stringify(crypto)),",
  "        env.PT_KV.put('held:asx-all', JSON.stringify(mergedAsxAll)),",
  "        env.PT_KV.put('held:crypto-all', JSON.stringify(mergedCryptoAll)),",
  "      ]);",
  "      return new Response(JSON.stringify({",
  "        ok: true, asx: asx.length, crypto: crypto.length,",
  "        asxAll: mergedAsxAll.length, cryptoAll: mergedCryptoAll.length,",
  "      }), { headers: CORS });",
  "    }",
  "",
  "    // ── FULL BACKFILL, BATCHED (?backfillFull=1&since=2017-08-07&offset=0&limit=6) ─",
  "    // Fetches complete history for a SLICE of currently-held symbols (ASX",
  "    // via Yahoo for both ASX and crypto, + FX conversion to AUD) and merges it",
  "    // into the stored KV blob. Call repeatedly, passing back `nextOffset`",
  "    // from the previous response, until `done:true`. Small batches keep",
  "    // each call well under Cloudflare's subrequest cap and avoid Yahoo/",
  "    // upstream rate-limiting from bursting too many requests at once.",
  "    if (url.searchParams.get(\"backfillFull\") === \"1\") {",
  "      const since      = url.searchParams.get(\"since\")      || HISTORY_START;",
  "      const offset      = parseInt(url.searchParams.get(\"offset\") || \"0\", 10);",
  "      const limit       = parseInt(url.searchParams.get(\"limit\")  || \"10\", 10);",
  "      // \"fortnightly\" (default, ~26 pts/yr) or \"monthly\" for pre-DAILY_SINCE history",
  "      const resolution  = url.searchParams.get(\"resolution\") || \"fortnightly\";",
  "      try {",
  "        const result = await runFullBackfillBatch(env, since, offset, limit, resolution);",
  "        return new Response(JSON.stringify(result), { headers: CORS });",
  "      } catch (e) {",
  "        return new Response(JSON.stringify({ ok: false, error: e.message }), { headers: CORS });",
  "      }",
  "    }",
  "",
  "    // ── PRUNE STRAY PRE-LISTING HISTORY (?pruneHistory=1&offset=0&limit=10) ─",
  "    // One-off cleanup for entries already in the KV blob from before this",
  "    // worker started floor-filtering on firstTradeDate (see fetchYahooHistory).",
  "    // Same batched offset/nextOffset contract as backfillFull.",
  "    if (url.searchParams.get(\"pruneHistory\") === \"1\") {",
  "      const offset = parseInt(url.searchParams.get(\"offset\") || \"0\", 10);",
  "      const limit  = parseInt(url.searchParams.get(\"limit\")  || \"10\", 10);",
  "      try {",
  "        const result = await runPruneHistoryBatch(env, offset, limit);",
  "        return new Response(JSON.stringify(result), { headers: CORS });",
  "      } catch (e) {",
  "        return new Response(JSON.stringify({ ok: false, error: e.message }), { headers: CORS });",
  "      }",
  "    }",
  "",
  "    // ── Price history since a date (?priceHistory=1&since=YYYY-MM-DD) ─",
  "    // Merges the one-off full-history blob (if present) with every daily",
  "    // snapshot the cron has recorded on/after `since`. Cron snapshots win",
  "    // on overlapping dates (freshest / most authoritative).",
  "    if (url.searchParams.get(\"priceHistory\") === \"1\") {",
  "      const since = url.searchParams.get(\"since\") || \"1970-01-01\";",
  "      const out = {};",
  "",
  "      const blobRaw = await env.PT_KV.get(\"history:blob\");",
  "      if (blobRaw) {",
  "        const blob = JSON.parse(blobRaw);",
  "        for (const [dateKey, dayPrices] of Object.entries(blob)) {",
  "          if (dateKey >= since) out[dateKey] = dayPrices;",
  "        }",
  "      }",
  "",
  "      const list = await env.PT_KV.list({ prefix: \"prices:\" });",
  "      await Promise.all(list.keys.map(async k => {",
  "        const dateKey = k.name.slice(\"prices:\".length);",
  "        if (dateKey >= since) {",
  "          const val = await env.PT_KV.get(k.name);",
  "          if (val) out[dateKey] = { ...(out[dateKey] || {}), ...JSON.parse(val) };",
  "        }",
  "      }));",
  "",
  "      return new Response(JSON.stringify(out), { headers: CORS });",
  "    }",
  "",
  "    // ── Manual trigger for testing the cron logic on demand ───────",
  "    // ?runSnapshotNow=1 — same code path the Cron Trigger calls at 5pm.",
  "    if (url.searchParams.get(\"runSnapshotNow\") === \"1\") {",
  "      await runDailySnapshot(env);",
  "      return new Response(JSON.stringify({ ok: true, date: brisbaneDateKey() }), { headers: CORS });",
  "    }",
  "",
  "    // ── ASX / Yahoo Finance prices (?symbols=DHHF.AX,VAS.AX) ─────",
  "    const symbols = url.searchParams.get(\"symbols\") || \"\";",
  "    if (!symbols) return new Response(\"{}\", { headers: CORS });",
  "    const symList = symbols.split(\",\").map(s => s.trim()).filter(Boolean);",
  "    const results = {};",
  "    await Promise.all(symList.map(async sym => {",
  "      const price = await fetchYahooPrice(sym);",
  "      if (price) results[sym] = price;",
  "    }));",
  "    return new Response(JSON.stringify(results), { headers: CORS });",
  "  },",
  "",
  "  // ── Cron Trigger entry point — runs even if nobody opens the app ────",
  "  async scheduled(event, env, ctx) {",
  "    ctx.waitUntil(runDailySnapshot(env));",
  "  },",
  "};",
].join('\n');

// ── INIT ─────────────────────────────────────────────────────────────
setDate();
// Set default date for dividend form
const dvd=$('dv-date'); if(dvd&&!dvd.value) dvd.value=new Date().toISOString().slice(0,10);
refreshAllBrokerSelects();
renderH(); renderT(); renderR();
const wcBox = $('worker-code-box');
setTimeout(syncAutoLoad, 800); // auto-pull on page open if configured
setTimeout(()=>{ syncHoldingsToWorker(); backfillPortfolioHistory(); }, 1200); // pick up any 5pm snapshots recorded while the app was closed
if(wcBox) wcBox.value = Array.isArray(WORKER_CODE) ? WORKER_CODE.join('\n') : WORKER_CODE;

// ── Pure-JS PDF extractor (no CDN, replaces PDF.js) ─────────────────────