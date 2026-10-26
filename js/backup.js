// ── backup.js ─────────────────────────────────────────────

function triggerDownload(url, filename){
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking synchronously can cancel the download on iOS Safari (this app's main
  // platform) before it has started — give it a moment.
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

// Local (Brisbane) date for filenames — toISOString() is UTC and reads as
// "yesterday" for the first 10 hours of each Brisbane day.
function _bkDate(){ return typeof localDateStr === 'function' ? localDateStr() : new Date().toISOString().slice(0,10); }

// Small localStorage-only settings that had no home in the backup payload. Stored
// as raw strings under data.pt_ls_extras so new keys can be added here alone.
const BACKUP_LS_EXTRAS = ['pt_benchmarks','pt_price_alerts','pt_concentration_alerts',
  'pt_holdings_fy_snapshots','pt_ath',
  'pt_fire_current_age','pt_fire_re_age','pt_fire_fi_age','pt_fire_monthly_contrib','pt_fire_growth_pct','pt_fire_annual_spend'];

// Every localStorage key the app owns must be in exactly one of these three lists. The first is
// handled explicitly in backupExport()/backupConfirm(); BACKUP_LS_EXTRAS (above) is the catch-all
// for small settings; the third is bookkeeping that must NOT travel with the data. Anything else
// that starts with pt_/cf_/su_ is reported by backupUnlistedKeys() the next time you export, so a
// new feature that adds a key can't silently go missing from backups.
const BACKUP_EXPLICIT_KEYS = ['pt_trades','pt_divs','pt_props','pt_spending','pt_prices','cf_worker_url','pt_drp_carry',
  'pt_drp_skipped','pt_expdiv_skipped','pt_drp_settings','pt_brokers','pt_super','su_combined_color','pt_tax','pt_stock_owners',
  'pt_extra_persons','pt_amit','pt_cgt_loss_carry_in','pt_pf_snapshots','pt_cg_overrides','pt_price_cgt_cutoff',
  'pt_price_cgt_cutoff_auto_saved','pt_pf_backfill_date','pt_pf_pruned_date','pt_super_last_fy','pt_property_last_fy',
  'pt_price_feed_url','pt_sync_key','pt_sync_gist_id','pt_sync_device','pt_last_sync'];
const BACKUP_IGNORED_KEYS = [
  'pt_last_backup_export',                       // written by the export itself
  'pt_last_restore',                             // when a backup was last restored here (stops Cloud Sync's auto-pull undoing it)
  'pt_bm_backfill_date','pt_pf_upgrade_date','pt_hist_rebuilt_v2','pt_bm_rebuilt_v2',    // once-a-day "already tried" throttles: restoring one could skip the history
                                                 // backfill a restore needs (the Clear-all routine wipes them for the same reason)
  'pt_price_20270630','pt_price_20270630_auto_saved']; // legacy names of the CGT cutoff keys (read as a fallback on restore)
function backupUnlistedKeys(){
  const known = new Set([...BACKUP_EXPLICIT_KEYS, ...BACKUP_LS_EXTRAS, ...BACKUP_IGNORED_KEYS]);
  const out = [];
  for(let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if(/^(pt|cf|su)_/.test(k) && !known.has(k)) out.push(k);
  }
  return out.sort();
}
// Checks a backup's data section BEFORE anything is written, so a damaged or hand-edited file can't wreck
// the data that's already here. Only types are checked, and only for fields that are present (older backups
// legitimately lack many); the types match what the app's own loaders assume. Returns a message or null.
function backupValidate(d){
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  if(!isObj(d)) return 'the data section is missing';
  const LISTS = ['pt_trades','pt_divs','pt_props','pt_spending','pt_super','pt_amit','pt_brokers','pt_extra_persons'];
  const RECORD_LISTS = ['pt_trades','pt_divs','pt_props','pt_spending','pt_super','pt_amit'];
  const OBJECTS = ['pt_prices','pt_tax','pt_stock_owners','pt_pf_snapshots','pt_cg_overrides','pt_drp_carry','pt_drp_skipped',
    'pt_expdiv_skipped','pt_drp_settings','pt_cgt_loss_carry_in','pt_price_cgt_cutoff','pt_price_20270630'];
  const TEXTS = ['cf_worker_url','su_combined_color','pt_price_cgt_cutoff_auto_saved','pt_price_20270630_auto_saved','pt_pf_backfill_date',
    'pt_pf_pruned_date','pt_super_last_fy','pt_property_last_fy','pt_price_feed_url','pt_sync_key','pt_sync_gist_id','pt_sync_device','pt_last_sync'];
  for(const k of LISTS) if(d[k] != null){
    if(!Array.isArray(d[k])) return `${k} should be a list`;
    if(RECORD_LISTS.includes(k) && d[k].some(x => !isObj(x))) return `${k} contains an entry that isn't a record`;
  }
  for(const k of OBJECTS) if(d[k] != null && !isObj(d[k])) return `${k} should be an object`;
  for(const k of TEXTS) if(d[k] != null && typeof d[k] !== 'string') return `${k} should be text`;
  if(d.pt_ls_extras != null){
    if(!isObj(d.pt_ls_extras)) return 'pt_ls_extras should be an object';
    for(const k of BACKUP_LS_EXTRAS){
      const v = d.pt_ls_extras[k];
      if(v == null) continue;
      if(typeof v !== 'string') return `${k} (in pt_ls_extras) should be text`;
      if(['pt_benchmarks','pt_price_alerts','pt_concentration_alerts','pt_holdings_fy_snapshots'].includes(k)){
        try{ JSON.parse(v); }catch(e){ return `${k} (in pt_ls_extras) is damaged`; }
      }
    }
  }
  if(d.pt_ls_extras_covered != null && !(Array.isArray(d.pt_ls_extras_covered) && d.pt_ls_extras_covered.every(x => typeof x === 'string')))
    return 'pt_ls_extras_covered should be a list of names';
  return null;
}

// After writing a restore, read it back from storage and confirm it matches the file. Returns the keys that don't.
function backupVerifyRestore(d){
  const bad = [];
  const read = k => { try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return undefined; } };
  const size = v => Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : -1);
  const always = { pt_trades: d.pt_trades || [], pt_divs: d.pt_divs || [], pt_props: d.pt_props || [], pt_spending: d.pt_spending || [], pt_prices: d.pt_prices || {} };
  const sometimes = { pt_super: d.pt_super, pt_tax: d.pt_tax, pt_stock_owners: d.pt_stock_owners, pt_extra_persons: d.pt_extra_persons,
    pt_amit: d.pt_amit, pt_pf_snapshots: d.pt_pf_snapshots, pt_cg_overrides: d.pt_cg_overrides, pt_drp_carry: d.pt_drp_carry,
    pt_drp_skipped: d.pt_drp_skipped, pt_expdiv_skipped: d.pt_expdiv_skipped, pt_drp_settings: d.pt_drp_settings,
    pt_cgt_loss_carry_in: d.pt_cgt_loss_carry_in, pt_brokers: (d.pt_brokers && d.pt_brokers.length) ? d.pt_brokers : null };
  for(const [k, v] of Object.entries(always)) if(size(read(k)) !== size(v)) bad.push(k);
  for(const [k, v] of Object.entries(sometimes)) if(v && size(read(k)) !== size(v)) bad.push(k);
  const x = d.pt_ls_extras || {};
  for(const k of BACKUP_LS_EXTRAS) if(typeof x[k] === 'string' && localStorage.getItem(k) !== x[k]) bad.push(k);
  return bad;
}

// Before exporting: parse the JSON back and make sure nothing was silently dropped (e.g. a field that was
// undefined disappears from JSON) or shortened. Returns a message or null.
function backupVerifyExport(payload, json){
  let back;
  try{ back = JSON.parse(json); }catch(e){ return 'the file could not be read back (' + e.message + ')'; }
  if(!back || !back.data) return 'the data section was lost';
  const lost = Object.keys(payload.data).filter(k => !(k in back.data));
  if(lost.length) return 'these fields were lost while saving: ' + lost.join(', ');
  const short = Object.keys(payload.data).filter(k => Array.isArray(payload.data[k]) && (!Array.isArray(back.data[k]) || back.data[k].length !== payload.data[k].length));
  if(short.length) return 'these lists came back a different length: ' + short.join(', ');
  return null;
}

// Puts storage back exactly as it was before a failed restore. Frees the space first so the old values fit,
// then restores every key it can — one stubborn key doesn't stop the rest. Returns true only if all went back.
function backupRollback(snap){
  let allBack = true;
  Object.keys(snap).forEach(k => { try{ localStorage.removeItem(k); }catch(e){ allBack = false; } });
  Object.entries(snap).forEach(([k, v]) => {
    if(v === null) return;
    try{ localStorage.setItem(k, v); }catch(e){ allBack = false; console.error('Rollback could not restore', k, e); }
  });
  return allBack;
}
function _bkReload(){ location.reload(); }

// Number of entries in a JSON object/array stored as a string (0 if missing/invalid).
function _bkJsonCount(s){
  try{ const o = typeof s === 'string' ? JSON.parse(s) : s; return o && typeof o === 'object' ? Object.keys(o).length : 0; }
  catch(e){ return 0; }
}

// ── BACKUP STALENESS REMINDER ─────────────────────────────────────────
// This app is localStorage-only with no server database — a cleared
// browser cache or a dead device loses everything unless you've exported
// a JSON backup or pushed to Cloud Sync recently. Tracks whichever of
// those two happened most recently (either one genuinely protects your
// data, so the more recent counts) and nudges you on the Settings page
// once it's been a while.
const BACKUP_STALE_AFTER_DAYS = 30;
function getLastBackupInfo(){
  const exportedAt = localStorage.getItem('pt_last_backup_export');
  const syncedAt = localStorage.getItem('pt_last_sync');
  const dates = [exportedAt, syncedAt].filter(Boolean).map(s=>new Date(s)).filter(d=>!isNaN(d));
  if(!dates.length) return { lastDate: null, daysAgo: null, method: null };
  const lastDate = new Date(Math.max(...dates.map(d=>d.getTime())));
  const method = (exportedAt && lastDate.getTime()===new Date(exportedAt).getTime()) ? 'export' : 'sync';
  const daysAgo = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
  return { lastDate, daysAgo, method };
}
function renderBackupReminder(){
  const el = $('backup-reminder');
  if(!el) return;
  const { daysAgo, method } = getLastBackupInfo();
  if(daysAgo == null){
    el.style.display = '';
    el.style.color = 'var(--gold)';
    el.innerHTML = `⚠ No backup on record yet — this app only stores data in this browser. Download a backup or set up Cloud Sync so you don't lose your trade history.`;
    return;
  }
  if(daysAgo >= BACKUP_STALE_AFTER_DAYS){
    el.style.display = '';
    el.style.color = 'var(--gold)';
    el.innerHTML = `⚠ Last ${method==='export'?'backup download':'cloud sync'} was <b>${daysAgo} day${daysAgo===1?'':'s'} ago</b> — worth doing a fresh one.`;
    return;
  }
  el.style.display = '';
  el.style.color = 'var(--green)';
  el.innerHTML = `✓ Last ${method==='export'?'backup download':'cloud sync'} was ${daysAgo===0?'today':daysAgo+' day'+(daysAgo===1?'':'s')+' ago'}.`;
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
      // CGT simulator's saved/auto-snapshotted price at the CGT_CUTOFF_DATE cutoff (cgt.js)
      pt_price_cgt_cutoff: JSON.parse(localStorage.getItem('pt_price_cgt_cutoff')||'{}'),
      pt_price_cgt_cutoff_auto_saved: localStorage.getItem('pt_price_cgt_cutoff_auto_saved') || '',
      // Minor cache/config flags — small, no reason to drop them from the backup
      pt_pf_backfill_date: localStorage.getItem('pt_pf_backfill_date') || '',
      pt_pf_pruned_date:   localStorage.getItem('pt_pf_pruned_date') || '',
      pt_super_last_fy:    localStorage.getItem('pt_super_last_fy') || '',
      pt_property_last_fy: localStorage.getItem('pt_property_last_fy') || '',
      pt_price_feed_url:   localStorage.getItem('pt_price_feed_url') || '',
      // GitHub Gist Cloud Sync device/credential state — included so a restore
      // fully re-establishes sync without you having to re-paste your token.
      // NOTE: this puts your GitHub PAT in plaintext in the downloaded JSON —
      // keep backup files as private as you would the token itself.
      pt_sync_key:      localStorage.getItem('pt_sync_key') || '',
      pt_sync_gist_id:  localStorage.getItem('pt_sync_gist_id') || '',
      pt_sync_device:   localStorage.getItem('pt_sync_device') || '',
      pt_last_sync:     localStorage.getItem('pt_last_sync') || '',
      // Benchmark history, price/concentration alert thresholds, FIRE calculator inputs.
      // (Cloud Sync's own payload is built elsewhere — same omission worth checking there.)
      pt_ls_extras: Object.fromEntries(BACKUP_LS_EXTRAS.map(k=>[k, localStorage.getItem(k)]).filter(([,v])=>v!=null)),
      // Which extras this backup looked at. A key listed here but missing from pt_ls_extras was genuinely
      // unset (e.g. a FIRE age you'd cleared), so restore mirrors that. Older backups lack this list and
      // may simply pre-date a key, so for them restore only ever writes — never deletes.
      pt_ls_extras_covered: BACKUP_LS_EXTRAS.slice(),
    }
  };

  const unlisted = backupUnlistedKeys();
  if(unlisted.length) console.warn('Backup: these stored keys are NOT included in backups:', unlisted);

  const json = JSON.stringify(payload, null, 2);
  const exportErr = backupVerifyExport(payload, json);
  if(exportErr){
    console.error('Backup export self-check failed:', exportErr);
    backupStatus('✗ Backup NOT downloaded — ' + exportErr + '. Nothing was changed; please report this.', 'var(--red)');
    notify('Backup failed its self-check — not downloaded', 'err');
    return;
  }
  const blob = new Blob([json], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const date = _bkDate();
  triggerDownload(url, `portfolio-backup-${date}.json`);
  localStorage.setItem('pt_last_backup_export', new Date().toISOString());
  if(typeof renderBackupReminder === 'function') renderBackupReminder();

  backupStatus(`✓ Backup downloaded — ${payload.data.pt_trades.length} trades, `
    + `${payload.data.pt_divs.length} dividends, `
    + `${payload.data.pt_props.length} properties, `
    + `${payload.data.pt_spending.length} spending records, `
    + `${(payload.data.pt_super||[]).length} super accounts, `
    + `${payload.data.pt_brokers.length} custom brokers, `
    + `${payload.data.pt_amit.length} AMIT adjustments, `
    + `${Object.keys(payload.data.pt_prices||{}).length} cached prices, `
    + `${Object.keys(payload.data.pt_pf_snapshots||{}).length} portfolio history days, `
    + `${_bkJsonCount(payload.data.pt_ls_extras.pt_holdings_fy_snapshots)} Net Worth year-end snapshots, `
    + `${Object.keys(payload.data.pt_ls_extras).filter(k=>k.startsWith('pt_fire_')).length} FIRE inputs, `
    + `${_bkJsonCount(payload.data.pt_ls_extras.pt_benchmarks)} benchmark days`
    + (unlisted.length ? ` — ⚠ ${unlisted.length} stored setting${unlisted.length===1?'':'s'} NOT covered by backups: ${unlisted.join(', ')}` : ''),
    unlisted.length ? 'var(--gold)' : 'var(--green)');
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

    const invalid = backupValidate(payload.data);
    if(invalid){
      backupStatus('✗ This backup file looks damaged — ' + invalid + '. Nothing was changed.', 'var(--red)');
      input.value = '';
      return;
    }

    const d = payload.data;
    const exportDate = payload.exportedAt ? payload.exportedAt.slice(0,10) : 'unknown date';

    // Build preview
    const x = d.pt_ls_extras || {};
    const fireKeys = BACKUP_LS_EXTRAS.filter(k => k.startsWith('pt_fire_'));
    const money = v => isFinite(parseFloat(v)) ? n2(parseFloat(v)) : '—';
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
      ['Net Worth year-end snapshots', _bkJsonCount(x.pt_holdings_fy_snapshots), _bkJsonCount(localStorage.getItem('pt_holdings_fy_snapshots'))],
      ['Net Worth FIRE inputs saved', fireKeys.filter(k => typeof x[k] === 'string').length, fireKeys.filter(k => localStorage.getItem(k) != null).length],
      ['All-time high',              money(x.pt_ath), money(localStorage.getItem('pt_ath'))],
      ['Benchmark history (days)',   _bkJsonCount(x.pt_benchmarks), Object.keys(benchmarkHistory||{}).length],
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
  for(const k of ['pt_trades','pt_divs','pt_props','pt_spending']){
    if(d[k] != null && !Array.isArray(d[k])){ notify(`Backup field ${k} is malformed — restore aborted, nothing changed.`,'err'); return; }
  }
  if(d.pt_prices != null && (typeof d.pt_prices !== 'object' || Array.isArray(d.pt_prices))){ notify('Backup field pt_prices is malformed — restore aborted, nothing changed.','err'); return; }

  const invalid = backupValidate(d);
  if(invalid){ notify('Backup looks damaged (' + invalid + ') — restore aborted, nothing changed.','err'); return; }

  // Snapshot everything the restore can touch, so a failure part-way puts it all back.
  const snapshot = {};
  [...BACKUP_EXPLICIT_KEYS, ...BACKUP_LS_EXTRAS].forEach(k => { snapshot[k] = localStorage.getItem(k); });

  try {
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
  // pt_price_20270630 fallback: backups taken before the CGT cutoff-key rename used that property name
  { const cutoffPrices = d.pt_price_cgt_cutoff || d.pt_price_20270630;
    if(cutoffPrices) localStorage.setItem('pt_price_cgt_cutoff', JSON.stringify(cutoffPrices)); }
  { const cutoffAutoSaved = d.pt_price_cgt_cutoff_auto_saved || d.pt_price_20270630_auto_saved;
    if(cutoffAutoSaved) localStorage.setItem('pt_price_cgt_cutoff_auto_saved', cutoffAutoSaved); }
  if(d.pt_pf_backfill_date) localStorage.setItem('pt_pf_backfill_date', d.pt_pf_backfill_date);
  if(d.pt_pf_pruned_date)   localStorage.setItem('pt_pf_pruned_date',   d.pt_pf_pruned_date);
  if(d.pt_super_last_fy)    localStorage.setItem('pt_super_last_fy',    d.pt_super_last_fy);
  if(d.pt_property_last_fy) localStorage.setItem('pt_property_last_fy', d.pt_property_last_fy);
  if(d.pt_price_feed_url)   localStorage.setItem('pt_price_feed_url',   d.pt_price_feed_url);
  if(d.pt_sync_key)      { syncKey = d.pt_sync_key; localStorage.setItem('pt_sync_key', d.pt_sync_key); }
  if(d.pt_sync_gist_id)    localStorage.setItem('pt_sync_gist_id', d.pt_sync_gist_id);
  if(d.pt_sync_device)   { syncDevice = d.pt_sync_device; localStorage.setItem('pt_sync_device', d.pt_sync_device); }
  if(d.pt_last_sync)       localStorage.setItem('pt_last_sync', d.pt_last_sync);
  if(d.pt_ls_extras && typeof d.pt_ls_extras === 'object'){
    // Keys this backup covered but has no value for were unset when it was made — remove them locally too,
    // otherwise a "replace all" restore leaves stale values behind (e.g. a FIRE age you'd since cleared).
    // Backups without the covered list (older versions) only ever write, never delete.
    const covered = Array.isArray(d.pt_ls_extras_covered) ? new Set(d.pt_ls_extras_covered) : null;
    BACKUP_LS_EXTRAS.forEach(k => {
      if(typeof d.pt_ls_extras[k] === 'string') localStorage.setItem(k, d.pt_ls_extras[k]);
      else if(covered && covered.has(k)) localStorage.removeItem(k);
    });
    if(typeof d.pt_ls_extras.pt_benchmarks === 'string'){ try{ benchmarkHistory = JSON.parse(d.pt_ls_extras.pt_benchmarks); }catch(e){} }
    else if(covered && covered.has('pt_benchmarks')) benchmarkHistory = {};
  }
  // Worker code is embedded in the app — no need to restore it

  // Read it all back from storage and confirm it matches the file before calling it a success.
  const unverified = backupVerifyRestore(d);
  if(unverified.length) throw new Error('could not confirm what was saved for ' + unverified.join(', '));
  } catch(err) {
    // Most likely a localStorage quota error part-way through. Put the previous data back so the app is
    // never left on a mix of old and restored data. In-memory copies were already replaced, so reload.
    console.error('Restore failed:', err);
    if(backupRollback(snapshot)){
      backupStatus('✗ Restore failed (' + err.message + ') — your previous data has been put back unchanged. Reloading…', 'var(--red)');
      notify('Restore failed — previous data put back', 'err');
      setTimeout(_bkReload, 2500);
    } else {
      backupStatus('✗ Restore failed part-way: ' + err.message + ' — and the previous data could not be put back, so data may be partially restored. Do NOT push to Cloud Sync; re-run the restore or pull from the cloud.', 'var(--red)');
      notify('Restore failed: ' + err.message, 'err');
    }
    return;
  }
  // Tell Cloud Sync this device's data is newer than any cloud copy saved before now — otherwise the
  // auto-pull on the next page open would silently overwrite a restored (older) backup with that copy.
  try{ localStorage.setItem('pt_last_restore', new Date().toISOString()); }catch(e){}

  _pendingRestore = null;
  $('backup-preview').style.display = 'none';

  // Re-render everything
  try { resetMtmCache(); } catch(e){} // pfSnapshots just changed — drop the stale mark-to-market date cache
  refreshAllBrokerSelects();
  renderH(); renderT(); renderR(); renderHD();
  renderFYBar(); renderDividends(); renderDivCharts(); renderDivCards();
  renderProperties(); renderAnalytics();
  try { renderSuperAccounts(); renderSuperCards(); renderSuperChart(); } catch(e){}
  try { renderSpending(); } catch(e){}
  try { renderTax(); } catch(e){}
  try { renderOwnershipGrid(); } catch(e){}
  try { if(typeof renderBenchmarkSection === 'function') renderBenchmarkSection(); } catch(e){}
  try { if(typeof renderNetWorth === 'function') renderNetWorth(); } catch(e){}
  try { if(typeof renderPriceAlertSettings === 'function'){ renderPriceAlertSettings(); renderConcentrationAlertSettings(); } } catch(e){}
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
  const date = _bkDate();

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
    const blob = new Blob(['\uFEFF' + csv], {type:'text/csv;charset=utf-8'}); // BOM so Excel reads UTF-8 correctly
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
    franking_pct: d.frankingPct == null ? '' : d.frankingPct, // csvImportDividends already reads this; export used to drop it
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
      // Per-FY historical value/loan/offset entries (see the property
      // form's "Historical Value, Loan Remaining & Offset Balance at 30
      // June" fields, and checkPropertyFYRollover's auto-capture) — kept
      // as JSON blobs like Super's fy_data_json below, since each is a
      // sparse {year: number} map rather than a flat column.
      fy_data_json: JSON.stringify(p.fyData||{}),
      fy_debt_data_json: JSON.stringify(p.fyDebtData||{}),
      fy_offset_data_json: JSON.stringify(p.fyOffsetData||{}),
      weekly_rent: p.weeklyRent||0, annual_expenses: p.annualExpenses||0,
      has_manager: p.hasManager||'', owner: p.owner||'', notes: csvSafe(p.notes||''),
      // Fields that drive CGT / sale estimates — without these a CSV round-trip turns a sold property back
      // into an unsold one and drops its cost-base improvements.
      capital_improvements: p.capitalImprovements||0,
      sold: p.sold ? 'yes' : '', sold_date: p.soldDate||'', sale_price: p.salePrice||0, selling_costs: p.sellingCosts||0,
      est_sell_cost_pct: p.estSellCostPct||0, main_res_exempt: p.mainResExempt ? 'yes' : '',
      debt_recycling: p.debtRecycling ? 'yes' : '', dr_symbols: JSON.stringify(p.drSymbols||[]),
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
    {key: 'export_date',    value: localDateStr()},
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

// Parse CSV text → array of {header: value} objects.
// RFC-4180 state machine over the WHOLE text. The old version split on newlines first
// and stripped every quote character, which (a) turned "" into nothing, so any JSON
// cell the app itself exports (splits_json, fy_data_json, contrib_json…) came back as
// invalid JSON and was silently dropped, and (b) broke any quoted field containing a
// newline into extra bogus rows.
function csvParseRows(text){
  text = String(text).replace(/^\uFEFF/,'');
  const table = []; let row = [], cur = '', inQ = false;
  for(let i = 0; i < text.length; i++){
    const ch = text[i];
    if(inQ){
      if(ch === '"'){ if(text[i+1] === '"'){ cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if(ch === '"'){ inQ = true; }
    else if(ch === ','){ row.push(cur); cur = ''; }
    else if(ch === '\n' || ch === '\r'){
      if(ch === '\r' && text[i+1] === '\n') i++;
      row.push(cur); cur = '';
      if(row.some(v => v.trim())) table.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur); if(row.some(v => v.trim())) table.push(row);
  if(table.length < 2) return [];
  const headers = table[0].map(h => h.trim().toLowerCase().replace(/[\uFEFF]/g,'').replace(/\s+/g,'_'));
  return table.slice(1).map(vals => {
    const obj = {};
    // csvSafe() (helpers.js) prefixes ' onto text starting with = + - @ to stop spreadsheet
    // formula injection on EXPORT. Undo it on import, otherwise every note/merchant such as
    // "-refund" comes back permanently changed as "'-refund".
    headers.forEach((h, idx) => { obj[h] = (vals[idx] || '').trim().replace(/^'(?=[=+\-@])/, ''); });
    return obj;
  });
}

// Kept for any external caller; csvParseRows no longer uses it.
function csvSplitLine(line){
  const out = []; let cur = '', inQ = false;
  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    if(inQ){ if(ch === '"'){ if(line[i+1] === '"'){ cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if(ch === '"') inQ = true;
    else if(ch === ','){ out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ── CSV value normalisers ─────────────────────────────────────────────
// calcH() and the CGT engine treat ANY trade type that isn't buy/drp/corporate_action as a SELL, so an
// unrecognised or differently-cased type ("Buy", "purchase") must never be stored as-is.
function csvNum(v){ const n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g,'')); return isNaN(n) ? 0 : n; }
function csvNormDate(v){ return typeof ndFlex === 'function' ? ndFlex(v) : String(v||'').trim(); }
function csvNormTradeType(v){
  const k = String(v||'').trim().toLowerCase().replace(/[\s\-]+/g,'_');
  const map = { buy:'buy', purchase:'buy', bought:'buy', sell:'sell', sale:'sell', sold:'sell', drp:'drp',
                corporate_action:'corporate_action', corporateaction:'corporate_action' };
  return map[k] || '';          // '' = unrecognised → row is rejected
}
function csvNormAssetType(v){
  const k = String(v||'').trim().toLowerCase();
  const valid = ['asx_stock','etf','lic','reit','crypto','bond','managed','commodity','super'];
  if(valid.includes(k)) return k;
  return 'asx_stock';           // includes the legacy/blank 'stock' value
}
function csvNormDivType(v){
  const k = String(v||'dividend').trim().toLowerCase().replace(/[^a-z]/g,'');
  const valid = ['dividend','distribution','interest','staking','airdrop','drp'];
  if(valid.includes(k)) return k;
  if(k.startsWith('distrib')) return 'distribution';
  if(k.startsWith('interest')) return 'interest';
  return 'dividend';
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
      date:      csvNormDate(r.date),
      type:      csvNormTradeType(r.type),
      symbol:    (r.symbol || '').toUpperCase(),
      assetType: csvNormAssetType(r.asset_type || r.assettype),
      units:     csvNum(r.units),
      price:     csvNum(r.price),
      fees:      csvNum(r.fees),
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
    if(!t.date || !t.type || !t.symbol || !t.units || t.units <= 0){ errors++; continue; }
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
    let frkV = r.frankingPct ?? r.franking_pct ?? r['franking%'] ?? r.frankingpct ?? null;
    if(frkV === '') frkV = null; // blank cell = unknown, NOT 0% franked
    const frkPct = frkV !== null ? Math.min(100,Math.max(0,parseFloat(frkV)||0)) : null;
    const d = {
      date:   csvNormDate(r.date),
      symbol: (r.symbol || '').toUpperCase(),
      amount: csvNum(r.amount),
      type:   csvNormDivType(r.type),
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
  const yn = v => /^(y|yes|true|1)$/i.test(String(v||'').trim());
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
      capitalImprovements: csvNum(g(r,'capital_improvements','capitalimprovements')),
      sold:          yn(g(r,'sold')),
      soldDate:      csvNormDate(g(r,'sold_date','solddate')),
      salePrice:     csvNum(g(r,'sale_price','saleprice')),
      sellingCosts:  csvNum(g(r,'selling_costs','sellingcosts')),
      estSellCostPct: csvNum(g(r,'est_sell_cost_pct','estsellcostpct')),
      mainResExempt: yn(g(r,'main_res_exempt','mainresexempt')),
      debtRecycling: yn(g(r,'debt_recycling','debtrecycling')),
      drSymbols:     (()=>{ const v = g(r,'dr_symbols','drsymbols'); if(!v) return [];
                            try{ const a = JSON.parse(v); if(Array.isArray(a)) return a; }catch(e){}
                            return String(v).split(/[,;\s]+/).filter(Boolean); })(),
    };
    // Per-FY historical value/loan/offset maps — same fy_data_json pattern
    // Super's CSV import already uses. Missing/unparseable columns (older
    // exports made before this data was captured) just leave that
    // property with no history, same as a brand-new property would have.
    const parseFyJson = (json) => { try{ const v = JSON.parse(json); return (v && typeof v === 'object') ? v : {}; }catch(e){ return {}; } };
    p.fyData       = parseFyJson(g(r,'fy_data_json','fydatajson'));
    p.fyDebtData   = parseFyJson(g(r,'fy_debt_data_json','fydebtdatajson'));
    p.fyOffsetData = parseFyJson(g(r,'fy_offset_data_json','fyoffsetdatajson'));
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
    const rawCat = r.category || '';
    const category = CAT_REVERSE[catRaw]
      || SP_CAT_MAP[rawCat]
      || SP_CAT_MAP[rawCat.toLowerCase()]
      || rawCat
      || (amt > 0 ? '__OTHER_INCOME__' : 'Other Shopping'); // same sign rule as spending.js parseFormatGeneric()
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
  "// WORKER_VERSION 2026-10-26b — exchange-timezone date keys, explicit daily windows, weekend carry-forward",
  "const CORS = { \"Content-Type\": \"application/json\", \"Access-Control-Allow-Origin\": \"*\", \"Access-Control-Expose-Headers\": \"X-Worker-Version\", \"X-Worker-Version\": \"2\" };",
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
  "// ── Benchmarks — always fetched at 5pm and always included in a full",
  "// backfill, independent of what's actually held. This is what makes",
  "// benchmark.js's ASX 200 (STW) / BTC comparison chart resilient to",
  "// missed logins: the cron and backfill below no longer skip these just",
  "// because you don't personally hold STW or bitcoin.",
  "const BENCHMARK_ASX_SYMS   = [\"STW.AX\"];",
  "const BENCHMARK_CRYPTO_IDS = [\"bitcoin\"];",
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
  "// ── Shared: fetch crypto prices (AUD) ────────────────────────────────",
  "// CoinGecko's public API now returns 403 to many unauthenticated requests",
  "// (including from Workers), so it's tried first but is no longer relied on:",
  "// anything it doesn't return is filled from Yahoo Finance (<SYM>-USD, the",
  "// same source the history backfill uses) converted to AUD. Optionally set a",
  "// free CoinGecko demo key as a Worker secret named CG_API_KEY to make the",
  "// first attempt succeed. symHints = { coingeckoId: 'SYM' } lets the app pass",
  "// symbols for coins not in CG_ID_TO_SYM below.",
  "async function fetchUsdToAud() {",
  "  try {",
  "    const p = await fetchYahooPrice(\"AUDUSD=X\"); // USD per 1 AUD",
  "    if (p && p > 0) return 1 / p;",
  "  } catch (e) {}",
  "  try {",
  "    const r = await fetch(\"https://api.frankfurter.app/latest?from=USD&to=AUD\");",
  "    if (r.ok) { const d = await r.json(); if (d?.rates?.AUD) return d.rates.AUD; }",
  "  } catch (e) {}",
  "  return null;",
  "}",
  "async function fetchCryptoPrices(ids, symHints, env) {",
  "  if (!ids.length) return {};",
  "  const out = {};",
  "  // 1) CoinGecko (bulk, native AUD)",
  "  try {",
  "    const headers = { \"User-Agent\": \"Mozilla/5.0\", \"Accept\": \"application/json\" };",
  "    if (env && env.CG_API_KEY) headers[\"x-cg-demo-api-key\"] = env.CG_API_KEY;",
  "    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=aud`, { headers });",
  "    if (r.ok) {",
  "      const d = await r.json();",
  "      for (const id of ids) if (d[id]?.aud) out[id] = d[id].aud;",
  "    }",
  "  } catch (e) {}",
  "  // 2) Yahoo fallback for whatever is still missing",
  "  const missing = ids.filter(id => out[id] == null);",
  "  if (missing.length) {",
  "    const fx = await fetchUsdToAud();",
  "    if (fx) {",
  "      await Promise.all(missing.map(async id => {",
  "        const sym = CG_ID_TO_SYM[id] || (symHints && symHints[id]);",
  "        if (!sym) return;",
  "        const usd = await fetchYahooPrice(cryptoYahooTicker(id, sym));",
  "        if (usd) out[id] = +(usd * fx).toPrecision(10);",
  "      }));",
  "    }",
  "  }",
  "  return out;",
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
  "  const heldAsx    = heldAsxRaw    ? JSON.parse(heldAsxRaw)    : [];",
  "  const heldCrypto = heldCryptoRaw ? JSON.parse(heldCryptoRaw) : [];",
  "  // Union with the benchmark set so STW/BTC get a price recorded every",
  "  // 5pm even on days/portfolios where you don't actually hold them.",
  "  const asxSyms   = [...new Set([...heldAsx,    ...BENCHMARK_ASX_SYMS])];",
  "  const cryptoIds = [...new Set([...heldCrypto, ...BENCHMARK_CRYPTO_IDS])];",
  "",
  "  const prices = {};",
  "  await Promise.all(asxSyms.map(async sym => {",
  "    const price = await fetchYahooPrice(sym);",
  "    if (price) prices[sym] = price;",
  "  }));",
  "  const cryptoPrices = await fetchCryptoPrices(cryptoIds, null, env);",
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
  "// ── RUNBOOK: a held coin/stock renames or migrates on Yahoo ──────────",
  "// Symptom: backfillFull reports 0 days for a symbol you know has traded",
  "// for years, OR Portfolio Change silently drops that source/symbol from",
  "// a window it used to cover. Cause: Yahoo tracks the same underlying",
  "// asset under a NEW ticker after a rebrand/delisting/rename and simply",
  "// has no data under the old one anymore (seen twice: FTM→Sonic, DW8→KDY).",
  "// Fix, same shape both times:",
  "//   1. Find the new Yahoo ticker (search finance.yahoo.com for the asset).",
  "//   2. Add one line to CG_ID_TO_YAHOO_TICKER_OVERRIDE (crypto) or",
  "//      ASX_TICKER_OVERRIDE (ASX stock) below, keyed by the OLD",
  "//      id/symbol — the one still used in the trade ledger.",
  "//   3. Re-run ?backfillFull=1 (or tap RUN BACKFILL in Settings) — no",
  "//      code path elsewhere needs to change, results still land under",
  "//      the original key so calcH()/markToMarketAt() keep working as-is.",
  "// Variant — the CURRENT ticker is already correct and live (so no",
  "// override needed), but its Yahoo history doesn't reach back through an",
  "// earlier rebrand (seen once: PathDAO→VIRTUAL). Fix: find the OLD ticker",
  "// on Yahoo and add it to CG_ID_PREDECESSOR_TICKER below instead — its",
  "// history gets merged in underneath the current ticker's, only filling",
  "// dates the current ticker doesn't already cover.",
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
  "  'axie-infinity':'AXS', olympus:'OHM', 'virtual-protocol':'VIRTUAL',",
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
  "// For a rename where the asset's EARLY history lives under a ticker Yahoo",
  "// no longer updates, but the CURRENT ticker (via CG_ID_TO_SYM/the override",
  "// above) is still live and correct going forward — unlike the override",
  "// above, which fully replaces the query, this ADDS the old ticker's",
  "// history underneath the current one. Keyed by CoinGecko id → the old",
  "// Yahoo ticker. Example: virtual-protocol (VIRTUAL) was originally",
  "// PathDAO — Yahoo's continuous, currently-updating VIRTUAL-USD only",
  "// starts at the rebrand, but PATH1-USD carries the 2021+ pre-rebrand",
  "// history under the old identity.",
  "const CG_ID_PREDECESSOR_TICKER = {",
  "  'virtual-protocol': 'PATH1-USD',",
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
  "// Calendar date (YYYY-MM-DD) of a Yahoo timestamp IN THE EXCHANGE'S OWN TIMEZONE.",
  "// Yahoo stamps an ASX daily bar at 10:00 Sydney time, which is 23:00 UTC the PREVIOUS day while",
  "// daylight saving applies (Oct-Apr) — slicing the UTC ISO string keyed every bar one day early in",
  "// summer (Monday's bar landed on Sunday, Friday's on Thursday). Crypto is stamped at 00:00 UTC, so",
  "// its timezone is UTC and nothing changes for it.",
  "const _dtfCache = {};",
  "function exchangeDateKey(tsSec, tz) {",
  "  const d = new Date(tsSec * 1000);",
  "  if (tz) {",
  "    try {",
  "      // The formatter is built ONCE per timezone: constructing an Intl.DateTimeFormat is very",
  "      // expensive (~75µs) and doing it per bar blew the Worker's CPU limit during backfill.",
  "      const f = _dtfCache[tz] || (_dtfCache[tz] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }));",
  "      return f.format(d);",
  "    } catch (e) { /* unknown tz name → fall through to UTC */ }",
  "  }",
  "  return d.toISOString().slice(0, 10);",
  "}",
  "",
  "// One Yahoo chart request for an explicit [period1, period2) window at 1-day granularity.",
  "// range=max is NOT used for the series any more: for long histories Yahoo silently returns WEEKLY",
  "// or MONTHLY bars even when interval=1d is requested (stamped at local midnight, carrying the",
  "// week's/month's closing price), which produced Sunday-dated \"weekly\" and month-end-dated \"monthly\"",
  "// points holding prices from days later. An explicit short window always comes back daily.",
  "async function fetchYahooChunk(sym, period1, period2) {",
  "  try {",
  "    const url = \"https://query1.finance.yahoo.com/v8/finance/chart/\" + encodeURIComponent(sym)",
  "      + \"?interval=1d&period1=\" + period1 + \"&period2=\" + period2;",
  "    const r = await fetch(url, { headers: { \"User-Agent\": \"Mozilla/5.0\" } });",
  "    if (!r.ok) return { series: {}, firstTradeDate: null };",
  "    const d = await r.json();",
  "    const result = d?.chart?.result?.[0];",
  "    if (!result) return { series: {}, firstTradeDate: null };",
  "    const tz        = result.meta?.exchangeTimezoneName || null;",
  "    const ts        = result.timestamp || [];",
  "    const closes    = result.indicators?.quote?.[0]?.close || [];",
  "    const adjcloses = result.indicators?.adjclose?.[0]?.adjclose || [];",
  "    // meta.firstTradeDate is Yahoo's record of the real first trading day (pre-listing placeholder",
  "    // prices sometimes appear in the series) — used as a floor by the caller.",
  "    const keyOf = t => exchangeDateKey(t, tz);   // cached formatter: ~1µs per bar",
  "    const firstTradeDate = result.meta?.firstTradeDate ? keyOf(result.meta.firstTradeDate) : null;",
  "    const series = {};",
  "    ts.forEach((t, i) => {",
  "      // Prefer the real close; only fall back to the dividend-adjusted close if close is missing.",
  "      const c = closes[i] != null ? closes[i] : adjcloses[i];",
  "      if (c == null) return;",
  "      series[keyOf(t)] = c;",
  "    });",
  "    return { series, firstTradeDate };",
  "  } catch (e) { return { series: {}, firstTradeDate: null }; }",
  "}",
  "",
  "// Full DAILY close history for an ASX (or any Yahoo) ticker from `sinceStr` to now, fetched in",
  "// 3-year windows (a handful of requests per symbol).",
  "async function fetchYahooHistory(sym, sinceStr) {",
  "  const nowSec  = Math.floor(Date.now() / 1000);",
  "  const startMs = new Date((sinceStr || HISTORY_START) + 'T00:00:00Z').getTime();",
  "  const START   = Math.floor(startMs / 1000) - 14 * 86400;",
  "  const CHUNK   = 3 * 365 * 86400;",
  "  const out = {};",
  "  let firstTradeDate = null;",
  "  for (let p1 = START; p1 < nowSec; p1 += CHUNK) {",
  "    const part = await fetchYahooChunk(sym, p1, Math.min(p1 + CHUNK, nowSec + 86400));",
  "    if (part.firstTradeDate && (!firstTradeDate || part.firstTradeDate < firstTradeDate)) firstTradeDate = part.firstTradeDate;",
  "    Object.assign(out, part.series);",
  "  }",
  "  if (firstTradeDate) for (const k of Object.keys(out)) if (k < firstTradeDate) delete out[k];",
  "  return out;",
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
  "    const meta = d?.chart?.result?.[0]?.meta;",
  "    const ftd = meta?.firstTradeDate;",
  "    return ftd ? exchangeDateKey(ftd, meta?.exchangeTimezoneName) : null;",
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
  "  // Also union in the benchmark set here — same reasoning as runDailySnapshot,",
  "  // but for the one-off full-history pull: this is what lets STW/BTC get",
  "  // their entire back-to-2018 history fetched via RUN BACKFILL even if",
  "  // they've never been an actual holding.",
  "  const asxSymsHeld   = heldAsxAllRaw    ? JSON.parse(heldAsxAllRaw)    : (heldAsxRaw    ? JSON.parse(heldAsxRaw)    : []); // e.g. \"DHHF.AX\"",
  "  const cryptoIdsHeld = heldCryptoAllRaw ? JSON.parse(heldCryptoAllRaw) : (heldCryptoRaw ? JSON.parse(heldCryptoRaw) : []); // e.g. \"bitcoin\"",
  "  const asxSyms   = [...new Set([...asxSymsHeld,   ...BENCHMARK_ASX_SYMS])];",
  "  const cryptoIds = [...new Set([...cryptoIdsHeld, ...BENCHMARK_CRYPTO_IDS])];",
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
  "      const fullSeries = await fetchYahooHistory(asxYahooTicker(item.key), since);",
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
  "    const fullSeries = await fetchYahooHistory(ticker, since);",
  "    // Predecessor-ticker merge (see RUNBOOK above) — only fills dates the",
  "    // current ticker doesn't already have, so a live/current ticker's own",
  "    // data always wins on any overlapping date.",
  "    const predTicker = CG_ID_PREDECESSOR_TICKER[item.key];",
  "    let predDaysMerged = 0;",
  "    if (predTicker) {",
  "      const predSeries = await fetchYahooHistory(predTicker, since);",
  "      for (const [d, v] of Object.entries(predSeries)) {",
  "        if (fullSeries[d] == null) { fullSeries[d] = v; predDaysMerged++; }",
  "      }",
  "    }",
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
  "    report.push({ symbol: item.key, type: 'crypto', ticker, days: days.length, rawDays: Object.keys(rawAud).length, ...(predTicker ? { predecessorTicker: predTicker, predecessorDaysMerged: predDaysMerged } : {}) });",
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
  "          const divTz    = d?.chart?.result?.[0]?.meta?.exchangeTimezoneName || null;",
  "          results[sym] = {",
  "            currency,",
  "            dividends: Object.values(divMap)",
  "              .map(v => ({ date: exchangeDateKey(v.date, divTz), amount: v.amount }))",
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
  "      // Carry each symbol's last reading across non-trading days (weekends, public holidays) inside the",
  "      // daily-resolution window, for at most 5 calendar days. This lets the app overwrite any stale value an",
  "      // earlier (mis-dated) backfill left on those days, and keeps weekend dates priced.",
  "      const fillFrom = since > DAILY_SINCE ? since : DAILY_SINCE;",
  "      const todayKey = brisbaneDateKey();",
  "      const dayMs = 86400000;",
  "      const lastSeen = {};   // symbol -> { p: price, t: ms of the day it was read }",
  "      for (const k of Object.keys(out).sort()) {",
  "        if (k >= fillFrom) break;",
  "        for (const [sym, p] of Object.entries(out[k])) lastSeen[sym] = { p, t: new Date(k + 'T00:00:00Z').getTime() };",
  "      }",
  "      for (let t = new Date(fillFrom + 'T00:00:00Z').getTime(); ; t += dayMs) {",
  "        const k = new Date(t).toISOString().slice(0, 10);",
  "        if (k > todayKey) break;",
  "        const day = out[k] || (out[k] = {});",
  "        for (const [sym, p] of Object.entries(day)) lastSeen[sym] = { p, t };",
  "        for (const [sym, rec] of Object.entries(lastSeen)) {",
  "          if (day[sym] == null && (t - rec.t) / dayMs <= 5) day[sym] = rec.p;",
  "        }",
  "      }",
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
  "    // ── Crypto prices, AUD (?cryptoPrices=bitcoin,ethereum&hints=bitcoin:BTC) ──",
  "    const cryptoIds = url.searchParams.get(\"cryptoPrices\");",
  "    if (cryptoIds) {",
  "      const ids = cryptoIds.split(\",\").map(s => s.trim()).filter(Boolean);",
  "      const hints = {};",
  "      (url.searchParams.get(\"hints\") || \"\").split(\",\").forEach(p => {",
  "        const [id, sym] = p.split(\":\");",
  "        if (id && sym && /^[A-Za-z0-9]{1,12}$/.test(sym)) hints[id.trim()] = sym.trim().toUpperCase();",
  "      });",
  "      return new Response(JSON.stringify(await fetchCryptoPrices(ids, hints, env)), { headers: CORS });",
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
const dvd=$('dv-date'); if(dvd&&!dvd.value) dvd.value=localDateStr();
refreshAllBrokerSelects();
renderH(); renderT(); renderR();
const wcBox = $('worker-code-box');
setTimeout(syncAutoLoad, 800); // auto-pull on page open if configured
setTimeout(()=>{ syncHoldingsToWorker(); backfillPortfolioHistory(); if(typeof backfillBenchmarkHistory==='function') backfillBenchmarkHistory(); }, 1200); // pick up any 5pm snapshots recorded while the app was closed (portfolio + benchmark)
setTimeout(()=>{ try{ prunePfSnapshotHistory(); }catch(e){} }, 1800); // downsample old daily snapshots once/day — keeps pfSnapshots bounded long-term
if(wcBox) wcBox.value = Array.isArray(WORKER_CODE) ? WORKER_CODE.join('\n') : WORKER_CODE;

// ── Pure-JS PDF extractor (no CDN, replaces PDF.js) ─────────────────────