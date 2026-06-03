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
      pt_brokers:    getCustomBrokers(),
      pt_super:      superAccounts,
      su_combined_color: localStorage.getItem('su_combined_color') || '#ffffff',
      pt_tax:       taxData,
      pt_stock_owners: stockOwners,
      pt_extra_persons: extraPersons,
      cf_worker_code: WORKER_CODE,
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
    + `${Object.keys(payload.data.pt_prices||{}).length} cached prices`, 'var(--green)');
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
  if(d.pt_drp_settings) localStorage.setItem('pt_drp_settings', JSON.stringify(d.pt_drp_settings));
  if(d.pt_brokers && d.pt_brokers.length) saveCustomBrokers(d.pt_brokers);
  if(d.pt_super){ superAccounts = d.pt_super; saveSuperAccounts(); }
  if(d.pt_tax){ taxData = d.pt_tax; saveTaxData(); }
  if(d.pt_stock_owners){ stockOwners = d.pt_stock_owners; saveStockOwners(); }
  if(d.pt_extra_persons){ extraPersons = d.pt_extra_persons; saveExtraPersons(); }
  if(d.su_combined_color){ suCombinedColor = d.su_combined_color; localStorage.setItem('su_combined_color', d.su_combined_color); }
  // Worker code is embedded in the app — no need to restore it

  _pendingRestore = null;
  $('backup-preview').style.display = 'none';

  // Re-render everything
  refreshAllBrokerSelects();
  renderH(); renderT(); renderR(); renderHD();
  renderFYBar(); renderDividends(); renderDivCharts(); renderDivCards();
  renderProperties(); renderAnalytics();
  try { renderSuperAccounts(); renderSuperCards(); renderSuperChart(); } catch(e){}
  try { renderSpending(); } catch(e){}
  try { renderTax(); } catch(e){}
  try { renderOwnershipGrid(); } catch(e){}

  backupStatus('✓ Restore complete — ' + trades.length + ' trades, ' + dividends.length + ' dividends, ' + properties.length + ' properties.', 'var(--green)');
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
      source: t.source||'', notes: t.notes||'',
      subtype: t.subtype||'', from_symbol: t.fromSymbol||'',
      ca_label: t.caLabel||'', split_ratio: t.splitRatio||'',
      alloc_pct: t.allocPct||'', override_cost_basis: t.overrideCostBasis||'',
    };
  });

  const divRows = dividends.map(d => ({
    date: d.date, symbol: d.symbol, type: d.type,
    amount: +d.amount, fy: dateToFY ? dateToFY(d.date) : '', notes: d.notes||'',
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
      has_manager: p.hasManager||'', notes: p.notes||'',
    };
  });

  const spendRows = spendingData.map(s => ({
    date: s.date, fy: s.fy, amount: s.amount,
    direction: s.amount < 0 ? 'debit' : 'credit',
    category: s.category.startsWith('__') ? (
      {'__TRANSFERS__':'Internal Transfer','__REFUND__':'Refund','__OTHER_INCOME__':'Other Income'}[s.category] || s.category
    ) : s.category,
    merchant: s.merchant, details: s.details,
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
  'export default {',
  '  async fetch(request) {',
  '    const url = new URL(request.url);',
  '    const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };',
  '',
  '    // ── MAIF unit price via Monash Ninja Tables public API ────────',
  '    if (url.searchParams.get("maif") === "1") {',
  '      try {',
  '        const apiUrl = "https://monashinvestors.com/wp-admin/admin-ajax.php"',
  '          + "?action=wp_ajax_ninja_tables_public_action"',
  '          + "&table_id=11330"',
  '          + "&target_action=get-all-data"',
  '          + "&default_sorting=old_first"',
  '          + "&skip_rows=0&limit_rows=0"',
  '          + "&ninja_table_public_nonce=cec8148613";',
  '        const res = await fetch(apiUrl, {',
  '          headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://monashinvestors.com/" }',
  '        });',
  '        if (!res.ok) return new Response(JSON.stringify({ error: "HTTP " + res.status }), { headers: CORS });',
  '        const rows = await res.json();',
  '        let buyPrice = null;',
  '        for (const row of rows) {',
  '          const field = (row.value && row.value.field) ? row.value.field.trim().toLowerCase() : "";',
  '          const val   = (row.value && row.value.value) ? parseFloat(row.value.value) : null;',
  '          if (field === "buy" && val > 0) { buyPrice = val; break; }',
  '        }',
  '        if (buyPrice) return new Response(JSON.stringify({ MAIF: buyPrice }), { headers: CORS });',
  '        return new Response(JSON.stringify({ error: "buy price not found", rows }), { headers: CORS });',
  '      } catch(e) {',
  '        return new Response(JSON.stringify({ error: e.message }), { headers: CORS });',
  '      }',
  '    }',
  '',
  '    // ── Dividend history (?divs=DHHF.AX,VAS.AX) ──────────────────',
  '    if (url.searchParams.get("divs")) {',
  '      const symList = url.searchParams.get("divs").split(",").map(s => s.trim()).filter(Boolean);',
  '      const results = {};',
  '      await Promise.all(symList.map(async sym => {',
  '        try {',
  '          const yUrl = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym)',
  '            + "?events=dividends&interval=1d&range=max";',
  '          const r = await fetch(yUrl, { headers: { "User-Agent": "Mozilla/5.0" } });',
  '          if (!r.ok) { results[sym] = { error: "HTTP " + r.status }; return; }',
  '          const d = await r.json();',
  '          const divMap  = d?.chart?.result?.[0]?.events?.dividends || {};',
  '          const currency = d?.chart?.result?.[0]?.meta?.currency || "AUD";',
  '          results[sym] = {',
  '            currency,',
  '            dividends: Object.values(divMap)',
  '              .map(v => ({ date: new Date(v.date * 1000).toISOString().slice(0,10), amount: v.amount }))',
  '              .sort((a, b) => a.date.localeCompare(b.date))',
  '          };',
  '        } catch(e) { results[sym] = { error: e.message }; }',
  '      }));',
  '      return new Response(JSON.stringify(results), { headers: CORS });',
  '    }',
  '',
  '    // ── ASX / Yahoo Finance prices (?symbols=DHHF.AX,VAS.AX) ─────',
  '    const symbols = url.searchParams.get("symbols") || "";',
  '    if (!symbols) return new Response("{}", { headers: CORS });',
  '    const symList = symbols.split(",").map(s => s.trim()).filter(Boolean);',
  '    const results = {};',
  '    await Promise.all(symList.map(async sym => {',
  '      try {',
  '        const yUrl = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym)',
  '          + "?interval=1d&range=1d";',
  '        const r = await fetch(yUrl, { headers: { "User-Agent": "Mozilla/5.0" } });',
  '        if (!r.ok) return;',
  '        const d = await r.json();',
  '        const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice;',
  '        if (price) results[sym] = price;',
  '      } catch(e) {}',
  '    }));',
  '    return new Response(JSON.stringify(results), { headers: CORS });',
  '  }',
  '};',
].join('\n');

// ── INIT ─────────────────────────────────────────────────────────────
setDate();
// Set default date for dividend form
const dvd=$('dv-date'); if(dvd&&!dvd.value) dvd.value=new Date().toISOString().slice(0,10);
refreshAllBrokerSelects();
renderH(); renderT(); renderR();
const wcBox = $('worker-code-box');
setTimeout(syncAutoLoad, 800); // auto-pull on page open if configured
if(wcBox) wcBox.value = Array.isArray(WORKER_CODE) ? WORKER_CODE.join('\n') : WORKER_CODE;

// ── Pure-JS PDF extractor (no CDN, replaces PDF.js) ─────────────────────