// ── properties.js ─────────────────────────────────────────────

function saveProps(){ localStorage.setItem('pt_props', JSON.stringify(properties)); }

// ── CALC HELPERS ──────────────────────────────────────────────────────
function calcMonthlyPI(principal, annualRate, years){
  if(!principal||!annualRate||!years) return 0;
  const r = (annualRate/100)/12;
  const n = years*12;
  if(r===0) return principal/n;
  return +(principal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1)).toFixed(2);
}

// ── SUPER ────────────────────────────────────────────────────────













// ── SUPER ────────────────────────────────────────────────────────
let suChart = null;
let suChartShowAll = false;
let syncKey = localStorage.getItem('pt_sync_key')||'';
let syncDevice = localStorage.getItem('pt_sync_device')||('Device-'+Math.random().toString(36).slice(2,6));
let syncStatus = 'idle'; // idle | syncing | ok | error | conflict
let suCombinedColor = localStorage.getItem('su_combined_color') || '#ffffff';
let suCardView = 0; // 0=combined, 1..n = account index

function toggleSuperAccount(headerEl){
  const id   = headerEl.dataset.id;
  const body = document.getElementById('su-body-'+id);
  const icon = document.getElementById('su-toggle-'+id);
  if(!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if(icon){
    icon.textContent  = isOpen ? '›' : '⌄';
    icon.style.color  = isOpen ? 'var(--text3)' : 'var(--blue)';
    icon.style.transform = isOpen ? '' : 'rotate(0deg)';
    icon.style.fontSize  = isOpen ? '18px' : '16px';
  }
  headerEl.style.borderColor = isOpen ? '' : 'var(--blue)';
}

function toggleSuperSection(headerEl){
  // Individual section toggle (CONTRIBUTIONS / CARRY-FORWARD / INVESTMENT RETURN)
  const body   = headerEl.nextElementSibling;
  const icon   = headerEl.querySelector('span');
  if(!body || !icon) return;
  const isOpen = body.style.display !== 'none';
  body.style.display  = isOpen ? 'none' : '';
  body.style.marginTop = isOpen ? '' : '10px';
  icon.textContent    = isOpen ? '+' : '−';
  icon.style.color    = isOpen ? 'var(--text3)' : 'var(--blue)';
}


function saveSuperAccounts(){ localStorage.setItem('pt_super', JSON.stringify(superAccounts)); }

function toggleSuperForm(forceOpen){
  const body   = $('su-form-body');
  const toggle = $('su-form-toggle');
  if(!body) return;
  const isOpen = body.style.display !== 'none';
  const open   = forceOpen !== undefined ? forceOpen : !isOpen;
  body.style.display = open ? '' : 'none';
  toggle.textContent = open ? '\u2212' : '+';
  toggle.style.color = open ? 'var(--blue)' : 'var(--text3)';
}

function readSuperForm(){
  const fyData = {};
  document.querySelectorAll('.su-fy-input').forEach(inp => {
    const yr = +inp.dataset.fy;
    const val = parseFloat(inp.value);
    if(!isNaN(val) && val > 0) fyData[yr] = val;
  });
  const contrib = {};
  document.querySelectorAll('.su-contrib').forEach(inp => {
    const key = inp.dataset.contrib;
    const val = parseFloat(inp.value);
    if(!isNaN(val) && val > 0) contrib[key] = val;
  });
  const colorEl = $('su-color');
  return {
    id:      $('su-edit-id').dataset.id || null,
    name:    $('su-name').value.trim(),
    balance: parseFloat($('su-balance').value) || 0,
    color:   colorEl ? colorEl.value : '#3b82f6',
    fyData,
    contrib,
  };
}

// ATO general concessional contributions cap by financial year.
// FY18–FY21: $25,000 · FY22–FY24: $27,500 · FY25–FY26: $30,000 · FY27 onward: $32,500
// (indexed to AWOTE in $2,500 steps — update the last line again once the ATO announces the next rise)
function getConcessionalCap(fy){
  if(fy <= 2021) return 25000;
  if(fy <= 2024) return 27500;
  if(fy <= 2026) return 30000;
  return 32500;
}

// ATO general transfer balance cap (TBC) by financial year — this is also the
// total-super-balance threshold at/above which the non-concessional cap is nil.
// FY18–FY21: $1.6m · FY22–FY23: $1.7m · FY24–FY25: $1.9m · FY26: $2.0m · FY27 onward: $2.1m
function getTransferBalanceCap(fy){
  if(fy <= 2021) return 1600000;
  if(fy <= 2023) return 1700000;
  if(fy <= 2025) return 1900000;
  if(fy <= 2026) return 2000000;
  return 2100000;
}

// Non-concessional (after-tax) contributions cap = 4x the concessional cap.
function getNonConcessionalCap(fy){ return getConcessionalCap(fy) * 4; }

// Bring-forward eligibility: how many years of NCC cap can be brought forward
// based on total super balance (TSB) at the end of the previous financial year.
//   TSB >= TBC                    → not eligible, cap = $0
//   TSB <  TBC - 2×annual cap     → 3-year bring-forward
//   TSB <  TBC - 1×annual cap     → 2-year bring-forward
//   otherwise                     → 1 year only (no bring-forward)
function calcNonConcessional(priorTSB, fy){
  fy = fy || (()=>{ const _n=new Date(); return _n.getMonth()>=6 ? _n.getFullYear()+1 : _n.getFullYear(); })();
  const tbc = getTransferBalanceCap(fy);
  const annualCap = getNonConcessionalCap(fy);
  const tsb = +priorTSB || 0;
  let bringForwardYears, cap, eligible;
  if(!priorTSB && priorTSB !== 0){
    // No balance entered — assume eligible at the standard annual cap (can't
    // determine bring-forward tier without a TSB figure).
    eligible = true; bringForwardYears = 1; cap = annualCap;
  } else if(tsb >= tbc){
    eligible = false; bringForwardYears = 0; cap = 0;
  } else if(tsb < tbc - 2*annualCap){
    eligible = true; bringForwardYears = 3; cap = 3*annualCap;
  } else if(tsb < tbc - annualCap){
    eligible = true; bringForwardYears = 2; cap = 2*annualCap;
  } else {
    eligible = true; bringForwardYears = 1; cap = annualCap;
  }
  return { fy, tbc, annualCap, tsb, eligible, bringForwardYears, cap };
}

// Tracks an already-triggered bring-forward period across its full length.
// The tier (1/2/3 years) and total cap are locked in at the FY it was
// triggered, using that FY's rules and the balance just before it — they
// don't change even if the cap or your balance change in later years.
// Returns null if no bf_start_fy has been entered (nothing to track).
function calcBringForwardPeriod(contrib, curFY){
  const startFY = +contrib.bf_start_fy || 0;
  if(!startFY) return null;
  const triggerTSB = (contrib.bf_trigger_tsb != null && contrib.bf_trigger_tsb !== '') ? +contrib.bf_trigger_tsb : null;
  const lock  = calcNonConcessional(triggerTSB, startFY);
  const years = Math.max(1, lock.bringForwardYears || 1);
  const endFY = startFY + years - 1;
  const usedByYear = [+contrib.bf_used_y1||0, +contrib.bf_used_y2||0, +contrib.bf_used_y3||0].slice(0, years);
  const usedTotal  = usedByYear.reduce((s,v)=>s+v, 0);
  return {
    startFY, endFY, years,
    totalCap: lock.cap, annualCapAtTrigger: lock.annualCap,
    triggerTSB: lock.tsb, triggerEligible: lock.eligible, triggerTBC: lock.tbc,
    usedByYear, usedTotal, remaining: Math.max(0, lock.cap - usedTotal),
    isActive:  curFY >= startFY && curFY <= endFY,
    isExpired: curFY > endFY,
    isFuture:  curFY < startFY,
  };
}

function calcCarryForward(contrib, currentBalance){
  const _n = new Date();
  const CUR_FY = _n.getMonth() >= 6 ? _n.getFullYear()+1 : _n.getFullYear();
  const BALANCE_THRESHOLD = 500000;
  const eligible = !currentBalance || currentBalance < BALANCE_THRESHOLD;
  const curCap = getConcessionalCap(CUR_FY);
  const windowYears = [CUR_FY-5,CUR_FY-4,CUR_FY-3,CUR_FY-2,CUR_FY-1].filter(y=>y>=2019);
  const breakdown = windowYears.map(yr => {
    const cap     = getConcessionalCap(yr);
    const entered = contrib['cf_unused_fy'+yr];
    const unused  = entered != null ? Math.max(0, Math.min(+entered, cap)) : 0;
    return { yr, cap, unused };
  });
  const totalUnused = breakdown.reduce((s, r) => s + r.unused, 0);
  const curEmp = +(contrib.empCC_cur || 0);
  const curPer = +(contrib.perCC_cur || 0);
  const curCC  = curEmp + curPer;
  const cfUsedThisYear      = Math.max(0, curCC - curCap);
  const cfRemainingThisYear = eligible ? Math.max(0, totalUnused - cfUsedThisYear) : 0;
  const totalCapThisYear    = eligible ? curCap + totalUnused : curCap;
  return { eligible, currentBalance:currentBalance||0, breakdown, totalUnused, curCC, curFY:CUR_FY, curCap, cfUsedThisYear, cfRemainingThisYear, totalCapThisYear };
}



function calcSuperPreview(){
  // Reads current form state and shows a live ROI preview
  // Uses the same logic as renderSuperAccounts
  const preview = $('su-preview');
  if(!preview) return;

  const _np = new Date();
  const CUR_FY   = _np.getMonth() >= 6 ? _np.getFullYear()+1 : _np.getFullYear();
  const PREV_FY  = CUR_FY - 1;
  const PREV2_FY = CUR_FY - 2;

  const curBal  = parseFloat($('su-balance')?.value) || 0;
  if(!curBal){ preview.style.display='none'; return; }

  // Read FY balances from inputs
  const fyData = {};
  document.querySelectorAll('.su-fy-input').forEach(inp => {
    const yr  = +inp.dataset.fy;
    const val = parseFloat(inp.value);
    if(!isNaN(val) && val > 0) fyData[yr] = val;
  });
  const prevBal  = fyData[PREV_FY]  || null;
  const prev2Bal = fyData[PREV2_FY] || null;

  // Read contributions
  const getC = key => {
    const el = document.querySelector(`.su-contrib[data-contrib="${key}"]`);
    return el ? (parseFloat(el.value) || 0) : 0;
  };
  const empCC_cur  = getC('empCC_cur'),  perCC_cur  = getC('perCC_cur');
  const empCC_prev = getC('empCC_prev'), perCC_prev = getC('perCC_prev');

  function calcROI(startBal, endBal, empCC, perCC){
    if(!startBal || !endBal) return null;
    const afterTaxCC = ((empCC||0) + (perCC||0)) * 0.85;
    const gain       = endBal - startBal - afterTaxCC;
    const avgBal     = (startBal + endBal) / 2;
    const roi        = avgBal > 0 ? (gain / avgBal) * 100 : null;
    return { gain, roi, afterTaxCC };
  }

  const roi_cur  = prevBal  ? calcROI(prevBal,  curBal,  empCC_cur,  perCC_cur)  : null;
  const roi_prev = prev2Bal ? calcROI(prev2Bal, prevBal, empCC_prev, perCC_prev) : null;

  const clr = v => v === null ? 'neu' : v >= 0 ? 'pos' : 'neg';
  const fmt = (v, prefix='$') => v === null ? '—' : (v>=0?'+':'')+prefix+n2(v);
  const fmtPct = v => v === null ? '—' : (v>=0?'+':'')+v.toFixed(2)+'%';

  const items = [
    {l:'Current Balance',          v:n2(curBal),           c:'neu'},
    prevBal  ? {l:'FY'+PREV_FY+' Balance', v:n2(prevBal), c:'neu'} : null,
    roi_cur  ? {l:'FY'+CUR_FY+' Inv. Gain',  v:fmt(roi_cur.gain),       c:clr(roi_cur.gain)}  : null,
    roi_cur  ? {l:'FY'+CUR_FY+' ROI',        v:fmtPct(roi_cur.roi),     c:clr(roi_cur.roi)}   : null,
    prev2Bal ? {l:'FY'+PREV2_FY+' Balance',  v:n2(prev2Bal),        c:'neu'}               : null,
    roi_prev ? {l:'FY'+PREV_FY+' Inv. Gain', v:fmt(roi_prev.gain),      c:clr(roi_prev.gain)} : null,
    roi_prev ? {l:'FY'+PREV_FY+' ROI',       v:fmtPct(roi_prev.roi),    c:clr(roi_prev.roi)}  : null,
  ].filter(Boolean);

  $('su-preview-grid').innerHTML = items.map(i=>
    `<div><div style="color:var(--text3);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px">${i.l}</div>
     <div class="${i.c}" style="font-size:13px;font-weight:600">${i.v}</div></div>`
  ).join('');
  preview.style.display = '';
}

function saveSuperAccount(){
  const a = readSuperForm();
  if(!a.name){ notify('Enter an account name.','err'); return; }
  if(a.id){
    const idx = superAccounts.findIndex(x => x.id === a.id);
    if(idx >= 0) superAccounts[idx] = { ...superAccounts[idx], ...a };
  } else {
    a.id = 'su_' + uid();
    superAccounts.push(a);
  }
  saveSuperAccounts();
  clearSuperForm();
  renderSuperAccounts();
  renderSuperCards();
  renderSuperChart();
  notify('Super account saved \u2713');
}

function clearSuperForm(){
  if($('su-name'))    $('su-name').value    = '';
  if($('su-balance')) $('su-balance').value = '';
  if($('su-color'))   { $('su-color').value = '#3b82f6'; $('su-color-label').textContent='#3b82f6'; }
  document.querySelectorAll('.su-fy-input').forEach(inp => inp.value = '');
  document.querySelectorAll('.su-contrib').forEach(inp => inp.value = '');
  $('su-edit-id').textContent = ''; $('su-edit-id').dataset.id = '';
  $('su-form-title-text').textContent = 'Add Super Account';
  toggleSuperForm(false);
  $('su-preview').style.display = 'none';
  updateBfYearLabels();
}

// Relabel the three bring-forward "NCC used" fields with the actual FY numbers
// once a start year is entered (FY2027, FY2028, FY2029 instead of Year 1/2/3).
function updateBfYearLabels(){
  const startEl = document.querySelector('.su-contrib[data-contrib="bf_start_fy"]');
  const start = startEl ? parseInt(startEl.value) : NaN;
  [1,2,3].forEach(n=>{
    const el = $('bf-y'+n+'-label');
    if(!el) return;
    el.textContent = (!isNaN(start) && start>0) ? ('NCC used — FY'+(start+n-1)) : ('NCC used — Year '+n);
  });
}

function updateSuperFormFYLabels(){
  const _n = new Date();
  const CUR_FY  = _n.getMonth() >= 6 ? _n.getFullYear()+1 : _n.getFullYear();
  const PREV_FY = CUR_FY - 1;
  const el = id => document.getElementById(id);
  if(el('su-contrib-cur-label'))  el('su-contrib-cur-label').textContent  = 'CONTRIBUTIONS THIS YEAR (FY'+CUR_FY+')';
  if(el('su-contrib-prev-label')) el('su-contrib-prev-label').textContent = 'CONTRIBUTIONS PREVIOUS YEAR (FY'+PREV_FY+')';
  if(el('su-bal-prev-label'))     el('su-bal-prev-label').textContent     = 'Super Balance at 30 Jun FY'+PREV_FY;
  const cfWrap = el('su-cf-fields');
  if(cfWrap){
    const windowYears = [CUR_FY-5,CUR_FY-4,CUR_FY-3,CUR_FY-2,CUR_FY-1].filter(y=>y>=2019);
    cfWrap.innerHTML = windowYears.map(yr =>
      '<div><label class="fl" style="font-size:10px">FY'+yr+' — Unused cap (from ATO)</label>'+
      '<input class="fi su-contrib" data-contrib="cf_unused_fy'+yr+'" type="number" placeholder="e.g. 5000" step="any" min="0" style="padding:4px 8px" oninput="calcSuperPreview()"></div>'
    ).join('');
  }
  const fyWrap = el('su-fy-fields');
  if(fyWrap){
    let html='';
    for(let y=2016;y<=PREV_FY;y++){
      html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'+
        '<label style="font-family:var(--mono);font-size:11px;color:var(--text3);width:54px;flex-shrink:0">FY'+y+'</label>'+
        '<input class="fi su-fy-input" data-fy="'+y+'" type="number" placeholder="0" step="any" min="0" style="flex:1;padding:4px 8px" oninput="renderSuperChart()"></div>';
    }
    fyWrap.innerHTML = html;
  }
}

function editSuperAccount(btn){
  const id = btn.dataset.id;
  const a  = superAccounts.find(x => x.id === id);
  if(!a) return;
  updateSuperFormFYLabels();
  $('su-name').value    = a.name    || '';
  $('su-balance').value = a.balance || '';
  const ec = a.color || '#3b82f6';
  if($('su-color')){ $('su-color').value = ec; $('su-color-label').textContent = ec; }
  document.querySelectorAll('.su-fy-input').forEach(inp => {
    const yr = +inp.dataset.fy;
    inp.value = (a.fyData && a.fyData[yr]) ? a.fyData[yr] : '';
  });
  document.querySelectorAll('.su-contrib').forEach(inp => {
    const key = inp.dataset.contrib;
    if(key) inp.value = (a.contrib && a.contrib[key] != null) ? a.contrib[key] : '';
  });
  document.querySelectorAll('.su-contrib').forEach(inp => {
    const key = inp.dataset.contrib;
    inp.value = (a.contrib && a.contrib[key]) ? a.contrib[key] : '';
  });
  $('su-edit-id').dataset.id = a.id;
  $('su-form-title-text').textContent = 'Edit \u2014 ' + a.name;
  toggleSuperForm(true);
  updateBfYearLabels();
  $('su-form-wrap').scrollIntoView({ behavior:'smooth' });
}

function deleteSuperAccount(btn){
  if(!confirm('Delete this super account?')) return;
  superAccounts = superAccounts.filter(a => a.id !== btn.dataset.id);
  saveSuperAccounts();
  renderSuperAccounts();
  renderSuperCards();
  renderSuperChart();
  notify('Account deleted.','ok');
}

function renderSuperCards(){
  const el = $('su-cards');
  if(!el) return;

  // Clamp view index in case accounts were deleted
  if(suCardView > superAccounts.length) suCardView = 0;

  const _now    = new Date();
  const CUR_FY  = _now.getMonth() >= 6 ? _now.getFullYear()+1 : _now.getFullYear();
  const PREV_FY = CUR_FY - 1;  // most recently completed FY
  const COLORS  = ['#3b82f6','#10b981','#f59e0b','#ef4444','#a855f7','#ec4899','#14b8a6'];

  // Helper: get balance for an account at end of a given FY (or null)
  const fyBal = (a, fy) => (a.fyData && a.fyData[fy]) ? +a.fyData[fy] : null;

  let balLabel, balVal, balSub, prevLabel, prevVal, growthVal, growthPct, accentColor;

  if(suCardView === 0){
    // ── Combined view ──
    const totalBal  = superAccounts.reduce((s,a) => s + (+a.balance||0), 0);
    const totalPrev = superAccounts.reduce((s,a) => s + (fyBal(a, PREV_FY)||0), 0);
    const growth    = totalPrev > 0 ? totalBal - totalPrev : null;
    const gPct      = growth !== null && totalPrev > 0 ? (growth/totalPrev)*100 : null;
    const n         = superAccounts.length;
    balLabel  = 'Total Balance';
    balVal    = n2(totalBal);
    balSub    = n + ' account' + (n===1?'':'s') + (n>0?' · click to cycle ↻':'');
    prevLabel = 'FY' + PREV_FY + ' Balance';
    prevVal   = totalPrev > 0 ? n2(totalPrev) : '—';
    growthVal = growth !== null ? (growth>=0?'+':'') + n2(growth) : '—';
    growthPct = gPct   !== null ? (gPct>=0?'+':'')   + gPct.toFixed(1)+'%' : '';
    accentColor = null;
    el.style.outline = '';
  } else {
    // ── Single account view ──
    const a    = superAccounts[suCardView - 1];
    const bal  = +a.balance||0;
    const prev = fyBal(a, PREV_FY);
    const growth = prev !== null ? bal - prev : null;
    const gPct   = growth !== null && prev > 0 ? (growth/prev)*100 : null;
    const _a = superAccounts[suCardView-1];
    accentColor  = (_a && _a.color) ? _a.color : COLORS[(suCardView-1) % COLORS.length];
    balLabel  = a.name;
    balVal    = n2(bal);
    balSub    = 'click to cycle ↻';
    prevLabel = 'FY' + PREV_FY + ' Balance';
    prevVal   = prev !== null ? n2(prev) : '—';
    growthVal = growth !== null ? (growth>=0?'+':'') + n2(growth) : '—';
    growthPct = gPct   !== null ? (gPct>=0?'+':'')   + gPct.toFixed(1)+'%' : '';
    el.style.outline = '2px solid ' + accentColor;
    el.style.borderRadius = '7px';
  }

  const growthClass = growthVal.startsWith('+') ? 'pos' : growthVal.startsWith('-') ? 'neg' : 'neu';

  el.innerHTML = [
    { l: balLabel,              v: balVal,   s: 'neu',        sub: balSub,
      onclick: 'cycleSuperCardView()' },
    { l: prevLabel,             v: prevVal,  s: 'neu',        sub: 'End of FY' + PREV_FY,
      onclick: 'cycleSuperCardView()' },
    { l: 'Growth since FY' + PREV_FY, v: growthVal, s: growthClass, sub: growthPct,
      onclick: 'cycleSuperCardView()' },
  ].map(c =>
    `<div class="card" onclick="${c.onclick}" style="cursor:pointer">
      <div class="card-label">${c.l}</div>
      <div class="card-value ${c.s}">${c.v}</div>
      <div class="card-sub">${c.sub}</div>
    </div>`
  ).join('');

  if(suCardView === 0){ el.style.outline = ''; el.style.borderRadius = ''; }
}

function cycleSuperCardView(){
  if(!superAccounts.length) return;
  suCardView = (suCardView + 1) % (superAccounts.length + 1);
  renderSuperCards();
}

// Snapshot each account's balance into fyData when a new financial year starts,
// so growth/ROI figures have a same-day-yesterday baseline instead of needing
// manual entry. Wrapped defensively so it can never break the render chain.
function checkSuperFYRollover(){
  try{
    const _d = new Date();
    const CUR_FY  = _d.getMonth() >= 6 ? _d.getFullYear()+1 : _d.getFullYear();
    const PREV_FY = CUR_FY - 1;
    const lastFY  = +(localStorage.getItem('pt_super_last_fy')||0);

    if(lastFY && lastFY < CUR_FY && Array.isArray(superAccounts)){
      let changed = false;
      superAccounts.forEach(a=>{
        if(!a.fyData) a.fyData = {};
        if(a.fyData[PREV_FY] == null && a.balance != null){
          a.fyData[PREV_FY] = +a.balance;
          changed = true;
        }
        // Roll "this year" contributions into "previous year" so they stay
        // attached to the correct FY once the labels advance, instead of
        // being silently mislabelled as the new (empty) current year.
        if(!a.contrib) a.contrib = {};
        const c = a.contrib;
        const hadCur = c.empCC_cur != null || c.perCC_cur != null || c.ncc_cur != null;
        if(hadCur){
          c.empCC_prev = c.empCC_cur || 0;
          c.perCC_prev = c.perCC_cur || 0;
          c.ncc_prev   = c.ncc_cur   || 0;
          delete c.empCC_cur; delete c.perCC_cur; delete c.ncc_cur;
          changed = true;
        }
      });
      if(changed){
        saveSuperAccounts();
        if(typeof notify === 'function') notify('Super balances & contributions rolled over to FY'+CUR_FY+' ✓','ok');
      }
    }
    localStorage.setItem('pt_super_last_fy', CUR_FY);
  }catch(e){ console.warn('checkSuperFYRollover error:', e); }
}

function renderSuperAccounts(){
  const wrap = $('su-accounts-wrap');
  checkSuperFYRollover();
  updateSuperFormFYLabels();
  if(!wrap) return;
  if(!superAccounts.length){
    wrap.innerHTML = '<div class="empty"><div class="empty-icon">\uD83C\uDFE6</div>No super accounts yet. Add one above.</div>';
    return;
  }

  const _d = new Date();
  const CUR_FY  = _d.getMonth() >= 6 ? _d.getFullYear()+1 : _d.getFullYear();
  const PREV_FY = CUR_FY - 1;
  const PREV2_FY= CUR_FY - 2;
  const COLORS  = ['#3b82f6','#10b981','#f59e0b','#ef4444','#a855f7','#ec4899','#14b8a6'];

  function calcROI(startBal, endBal, empCC, perCC){
    if(!startBal || !endBal) return null;
    const afterTaxCC = ((empCC||0) + (perCC||0)) * 0.85;
    const gain       = endBal - startBal - afterTaxCC;
    const avgBal     = (startBal + endBal) / 2;
    const roi        = avgBal > 0 ? (gain / avgBal) * 100 : null;
    return { gain, roi, afterTaxCC };
  }

  const stat = (label, val, cls='neu', sub='') =>
    `<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px">${label}</div>
     <div class="${cls}" style="font-family:var(--mono);font-size:13px;font-weight:600">${val}</div>
     ${sub?`<div style="font-size:10px;color:var(--text3);margin-top:1px">${sub}</div>`:''}</div>`;

  // Collapsible section helper
  const collapsible = (title, body) => `
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:14px;margin-top:12px">
        <div onclick="toggleSuperSection(this)" style="font-family:var(--mono);font-size:10px;color:var(--text2);letter-spacing:.1em;text-transform:uppercase;margin-bottom:0;display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none">
          ${title}<span style="font-size:16px;color:var(--blue);line-height:1;font-weight:300">−</span>
        </div>
        <div class="su-section-body" style="margin-top:12px">
          ${body}
        </div>
      </div>`;

  wrap.innerHTML = superAccounts.map((a, i) => {
    const color    = a.color || COLORS[i % COLORS.length];
    const curBal   = +a.balance || 0;
    const prevBal  = a.fyData && a.fyData[PREV_FY]  ? +a.fyData[PREV_FY]  : null;
    const prev2Bal = a.fyData && a.fyData[PREV2_FY] ? +a.fyData[PREV2_FY] : null;
    const contrib  = a.contrib || {};

    const empCC_cur  = +contrib.empCC_cur  || 0;
    const perCC_cur  = +contrib.perCC_cur  || 0;
    const ncc_cur    = +contrib.ncc_cur    || 0;
    const empCC_prev = +contrib.empCC_prev || 0;
    const perCC_prev = +contrib.perCC_prev || 0;
    const ncc_prev   = +contrib.ncc_prev   || 0;

    const roi_cur  = prevBal  !== null ? calcROI(prevBal,  curBal,  empCC_cur,  perCC_cur)  : null;
    const roi_prev = prev2Bal !== null ? calcROI(prev2Bal, prevBal, empCC_prev, perCC_prev) : null;

    const fmtROI  = r => r === null ? '—'
      : `<span class="${r.roi>=0?'pos':'neg'}">${r.roi>=0?'+':''}${r.roi.toFixed(2)}%</span>`;
    const fmtGain = r => r === null ? '—'
      : `<span class="${r.gain>=0?'pos':'neg'}">${r.gain>=0?'+':''}${n2(r.gain)}</span>`;

    const contribCur  = empCC_cur  + perCC_cur;
    const contribPrev = empCC_prev + perCC_prev;
    const hasContrib  = contribCur || contribPrev || ncc_cur || ncc_prev;

    // ── CONTRIBUTIONS panel ─────────────────────────────────────
    const contribBody = hasContrib ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div>
              <div style="font-size:10px;color:var(--text3);margin-bottom:8px;font-family:var(--mono)">FY${CUR_FY} — in progress</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                ${stat('Employer CC',     empCC_cur  ? n2(empCC_cur)          : '—')}
                ${stat('Personal CC',     perCC_cur  ? n2(perCC_cur)          : '—')}
                ${stat('Total CC',        contribCur ? n2(contribCur)         : '—')}
                ${stat('After-tax (85%)', contribCur ? n2(contribCur*0.85)    : '—', 'pos')}
                ${ncc_cur  ? stat('Non-Concessional', n2(ncc_cur))            : ''}
              </div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text3);margin-bottom:8px;font-family:var(--mono)">FY${PREV_FY} — completed</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                ${stat('Employer CC',     empCC_prev  ? n2(empCC_prev)         : '—')}
                ${stat('Personal CC',     perCC_prev  ? n2(perCC_prev)         : '—')}
                ${stat('Total CC',        contribPrev ? n2(contribPrev)        : '—')}
                ${stat('After-tax (85%)', contribPrev ? n2(contribPrev*0.85)   : '—', 'pos')}
                ${ncc_prev ? stat('Non-Concessional', n2(ncc_prev))            : ''}
              </div>
            </div>
          </div>` :
      `<div style="color:var(--text3);font-size:11px">No contributions entered yet. Edit this account and fill in the contribution fields above.</div>`;

    const contribPanel = collapsible('CONTRIBUTIONS', contribBody);

    // ── CARRY-FORWARD panel ───────────────────────────────────────
    const cf = calcCarryForward(a.contrib||{}, a.contrib?.bal_prevyr || a.balance);
    const cfRows = cf.breakdown.map(r => {
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;
          padding:4px 8px;border-radius:4px;background:${r.unused>0?'rgba(129,140,248,0.06)':'transparent'}">
          <span style="font-family:var(--mono);font-size:11px;color:var(--text3)">FY${r.yr}</span>
          <span style="font-family:var(--mono);font-size:12px;font-weight:600;
            color:${r.unused>0?'#818cf8':'var(--text3)'}">
            ${r.unused > 0 ? n2(r.unused) : '—'}
          </span>
        </div>`;
    }).join('');

    const cfBody = `
      <div style="padding:4px 0">
        ${!cf.eligible ? `
          <div style="padding:10px;background:rgba(239,68,68,0.1);border-radius:6px;
            color:var(--neg);font-size:12px;margin-bottom:12px">
            ⚠ Not eligible — super balance ≥ $500,000 at 30 Jun FY${PREV_FY}
            (${n2(cf.currentBalance)})
          </div>` : ''}

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
          ${stat('Available to Use',
            cf.eligible ? n2(cf.cfRemainingThisYear) : '—',
            cf.cfRemainingThisYear>0 ? 'pos' : 'neu',
            'unused from last 5 FYs')}
          ${stat('Total Cap FY'+CUR_FY,
            n2(cf.totalCapThisYear),
            'neu',
            'base '+n2(cf.curCap)+' + carry-forward')}
          ${stat('CC Used This Year',
            n2(cf.curCC),
            cf.curCC > cf.totalCapThisYear ? 'neg' : cf.curCC > cf.curCap ? 'pos' : 'neu',
            cf.curCC > cf.curCap ? 'includes carry-forward' : 'of '+n2(cf.curCap)+' base cap')}
        </div>

        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);
          letter-spacing:.05em;margin-bottom:8px">UNUSED CAP BY YEAR</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${cfRows}
        </div>

        ${cf.totalUnused > 0 && cf.eligible ? `
          <div style="margin-top:14px;padding:12px;background:rgba(129,140,248,0.1);
            border-radius:6px;border:1px solid rgba(129,140,248,0.3);font-size:12px;line-height:1.6">
            <b style="color:#818cf8">${n2(cf.totalUnused)}</b> in unused concessional cap
            available to carry forward into FY${CUR_FY}.
            ${cf.curCC > cf.curCap
              ? `Currently using <b style="color:#818cf8">${n2(cf.cfUsedThisYear)}</b>
                 of carry-forward this year — <b>${n2(cf.cfRemainingThisYear)}</b> still available.`
              : `You can contribute up to an extra <b style="color:#818cf8">${n2(cf.cfRemainingThisYear)}</b>
                 before 30 Jun ${CUR_FY} to use the full carry-forward.`}
          </div>` : ''}

        <div style="font-size:10px;color:var(--text3);margin-top:10px;line-height:1.6">
          Enter actual CC totals used each year in the Contributions section above.
          Leave blank = assume full cap was used (no carry-forward for that year).
          Carry-forward only available if balance &lt; $500,000 at 30 Jun FY${PREV_FY}.
          ATO caps: FY2022–FY2024 = $27,500/yr · FY2025–FY2026 = $30,000/yr · FY2027+ = $32,500/yr
        </div>
      </div>`;
    const cfPanel = collapsible('CARRY-FORWARD CC', cfBody);

    // ── NON-CONCESSIONAL panel ──────────────────────────────────
    const priorTSBRaw = contrib.bal_prevyr;
    const nc = calcNonConcessional(priorTSBRaw != null && priorTSBRaw !== '' ? +priorTSBRaw : null, CUR_FY);
    const bfLabel = nc.bringForwardYears === 3 ? '3-year bring-forward'
                  : nc.bringForwardYears === 2 ? '2-year bring-forward'
                  : nc.bringForwardYears === 1 ? 'standard (no bring-forward)' : '—';

    const bf = calcBringForwardPeriod(contrib, CUR_FY);
    const bfPeriodBlock = bf ? `
        <div style="padding:12px;border-radius:6px;margin-bottom:14px;
          background:${bf.isExpired?'rgba(74,85,104,0.15)':bf.isActive?'rgba(16,185,129,0.1)':'rgba(255,176,0,0.1)'};
          border:1px solid ${bf.isExpired?'var(--border2)':bf.isActive?'var(--green)':'var(--gold)'}">
          <div style="font-family:var(--mono);font-size:11px;letter-spacing:.05em;margin-bottom:8px;
            color:${bf.isExpired?'var(--text3)':bf.isActive?'var(--green)':'var(--gold)'}">
            ${bf.isExpired?'ENDED':bf.isActive?'ACTIVE':'STARTS'} — ${bf.years}-YEAR BRING-FORWARD, FY${bf.startFY}–FY${bf.endFY}
          </div>
          ${!bf.triggerEligible ? `<div style="color:var(--neg);font-size:11px;margin-bottom:8px">
            ⚠ Balance entered for FY${bf.startFY} (${n2(bf.triggerTSB)}) was at/above that year's transfer balance cap
            (${n2(bf.triggerTBC)}) — you may not actually have been eligible to trigger this period. Double-check.</div>` : ''}
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
            ${stat('Total Cap Locked', n2(bf.totalCap), 'neu', 'as at FY'+bf.startFY+' rules')}
            ${stat('Used So Far', n2(bf.usedTotal), bf.usedTotal>bf.totalCap?'neg':'neu', bf.usedTotal>bf.totalCap?'exceeds locked cap':'across the period')}
            ${stat('Remaining', n2(bf.remaining), bf.remaining>0?'pos':'neu', bf.isExpired?'period ended':'still available')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(${bf.years},1fr);gap:8px;margin-top:10px">
            ${bf.usedByYear.map((v,i)=>stat('FY'+(bf.startFY+i), n2(v))).join('')}
          </div>
        </div>` : '';

    const standaloneBlock = (bf && bf.isActive) ? `
        <div style="font-size:11px;color:var(--text3);padding:10px;background:var(--surface2);border-radius:6px">
          Currently within the tracked bring-forward period above — a new bring-forward can't be triggered again until FY${bf.endFY+1}.
        </div>` : `
        <div style="padding:4px 0">
        ${!nc.eligible ? `
          <div style="padding:10px;background:rgba(239,68,68,0.1);border-radius:6px;
            color:var(--neg);font-size:12px;margin-bottom:12px">
            ⚠ Not eligible — total super balance ≥ ${n2(nc.tbc)} at 30 Jun FY${PREV_FY}
            (${n2(nc.tsb)})
          </div>` : ''}
        ${(priorTSBRaw==null||priorTSBRaw==='') ? `
          <div style="padding:10px;background:rgba(255,176,0,0.1);border-radius:6px;
            color:var(--gold);font-size:12px;margin-bottom:12px">
            Enter "Super Balance at 30 Jun FY${PREV_FY}" above to determine bring-forward eligibility.
            Showing the standard annual cap for now.
          </div>` : ''}

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
          ${stat('NCC Cap FY'+CUR_FY, nc.eligible ? n2(nc.annualCap) : '$0.00', 'neu', 'standard annual cap')}
          ${stat('Bring-Forward Cap', nc.eligible ? n2(nc.cap) : '$0.00',
              nc.bringForwardYears>1 ? 'pos' : 'neu', bfLabel)}
          ${stat('NCC Made This Year', ncc_cur ? n2(ncc_cur) : '—',
              ncc_cur > nc.cap ? 'neg' : 'neu',
              ncc_cur > nc.cap ? 'exceeds available cap' : 'of '+n2(nc.cap)+' available')}
        </div>

        <div style="font-size:10px;color:var(--text3);margin-top:6px;line-height:1.6">
          Non-concessional cap = 4× the concessional cap (${n2(nc.annualCap)} for FY${CUR_FY}).
          Nil if total super balance ≥ the general transfer balance cap (${n2(nc.tbc)} for FY${CUR_FY}) at 30 Jun FY${PREV_FY}.
          ${bf ? `Once you trigger a new period, fill in "Bring-forward triggered in FY" above to lock it in and track it here.`
               : `If you trigger a 2- or 3-year bring-forward this year, fill in the Bring-Forward section above to lock it in and track it across the whole period.`}
        </div>
      </div>`;

    const ncBody = bfPeriodBlock + standaloneBlock;
    const ncPanel = collapsible('NON-CONCESSIONAL CONTRIBUTIONS', ncBody);

    // ── INVESTMENT RETURN panel ──────────────────────────────────
    const needsFYData = prevBal === null;
    const roiBody = needsFYData
      ? `<div style="color:var(--text3);font-size:11px">Enter FY${PREV_FY} balance in the form above to calculate investment return.</div>`
      : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div>
            <div style="font-size:10px;color:var(--text3);margin-bottom:8px;font-family:var(--mono)">FY${CUR_FY} — Current vs FY${PREV_FY} end</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              ${stat('Start (FY'+PREV_FY+')',  n2(prevBal))}
              ${stat('End (Current)',           n2(curBal))}
              ${stat('After-tax CC',            roi_cur ? n2(roi_cur.afterTaxCC)       : '$0.00')}
              ${stat('Inv. Gain',               roi_cur ? fmtGain(roi_cur)                  : n2(curBal-prevBal))}
              ${stat('Avg Balance',             n2((prevBal+curBal)/2))}
              ${stat('ROI %',                   roi_cur ? fmtROI(roi_cur)                   : '—')}
            </div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text3);margin-bottom:8px;font-family:var(--mono)">FY${PREV_FY} — FY${PREV_FY} vs FY${PREV2_FY} end</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              ${prev2Bal !== null ? stat('Start (FY'+PREV2_FY+')', n2(prev2Bal)) : stat('Start (FY'+PREV2_FY+')', '—')}
              ${stat('End (FY'+PREV_FY+')',      n2(prevBal))}
              ${stat('After-tax CC',            roi_prev ? n2(roi_prev.afterTaxCC)      : '$0.00')}
              ${stat('Inv. Gain',               roi_prev ? fmtGain(roi_prev)                : '—')}
              ${stat('Avg Balance',             prev2Bal !== null ? n2((prev2Bal+prevBal)/2) : '—')}
              ${stat('ROI %',                   roi_prev ? fmtROI(roi_prev)                 : '—')}
            </div>
          </div>
        </div>
        <div style="margin-top:10px;font-size:10px;color:var(--text3);font-family:var(--mono)">
          Investment gain = Ending − Starting − after-tax concessional contributions. Average balance used as denominator (Modified Dietz).
        </div>`;

    const roiPanel = collapsible('INVESTMENT RETURN (MODIFIED DIETZ)', roiBody);

    return `<div class="fs" style="margin-bottom:10px">
      <!-- Clickable header bar -->
      <div onclick="toggleSuperAccount(this)" data-id="${a.id}" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:12px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;cursor:pointer;user-select:none;transition:border-color 0.15s">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:12px;height:12px;border-radius:50%;background:${color};flex-shrink:0"></div>
          <div style="font-family:var(--mono);font-size:14px;font-weight:600">${escHtml(a.name)}</div>
          <div style="font-family:var(--mono);font-size:12px;color:var(--text3)">${n2(curBal)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn" onclick="event.stopPropagation();editSuperAccount(this)" data-id="${a.id}">\u270F EDIT</button>
          <button class="btn btn-r" onclick="event.stopPropagation();deleteSuperAccount(this)" data-id="${a.id}">\u2715 DELETE</button>
          <span id="su-toggle-${a.id}" style="font-size:18px;color:var(--text3);line-height:1;margin-left:4px">›</span>
        </div>
      </div>
      <!-- Collapsible body - starts minimised -->
      <div id="su-body-${a.id}" style="display:none;padding:14px 0 4px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        ${stat('Current Balance', n2(curBal))}
        ${prevBal  !== null ? stat('FY'+PREV_FY+' Balance',  n2(prevBal))  : ''}
        ${prev2Bal !== null ? stat('FY'+PREV2_FY+' Balance', n2(prev2Bal)) : ''}
        ${roi_cur  ? stat('FY'+CUR_FY+' ROI',  fmtROI(roi_cur),  '') : ''}
        ${roi_prev ? stat('FY'+PREV_FY+' ROI', fmtROI(roi_prev), '') : ''}
      </div>
      ${contribPanel}
      ${cfPanel}
      ${ncPanel}
      ${roiPanel}
    </div></div>`;
  }).join('');
}


function renderSuperChart(){
  const canvas = $('su-chart');
  if(!canvas) return;

  const _d      = new Date();
  const CUR_FY  = _d.getMonth() >= 6 ? _d.getFullYear()+1 : _d.getFullYear();
  const WIN_FYS = Array.from({length:5}, (_,i) => CUR_FY-5+i);  // last 5 FYs, always current
  const COLORS   = ['#3b82f6','#10b981','#f59e0b','#ef4444','#a855f7','#ec4899','#14b8a6'];

  // Collect all FY years across all accounts that have data
  const allFYsWithData = new Set();
  superAccounts.forEach(a => {
    if(a.fyData) Object.keys(a.fyData).forEach(yr => {
      if(+a.fyData[yr] > 0) allFYsWithData.add(+yr);
    });
  });
  WIN_FYS.forEach(y => allFYsWithData.add(y));  // always include window
  const allFYsSorted = [...allFYsWithData].filter(y => y <= CUR_FY).sort((a,b)=>a-b);

  // Pick which FYs to show based on toggle
  const displayFYs   = suChartShowAll ? allFYsSorted : WIN_FYS;
  const displayLabels = [...displayFYs.map(y => 'FY'+y), 'Current'];

  // Update toggle button label
  const btn = $('su-chart-toggle-btn');
  if(btn) btn.textContent = suChartShowAll ? 'Show all history' : 'Show last 5 years';

  const datasets = [];

  // Per-account lines
  superAccounts.forEach((a, i) => {
    const color  = a.color || COLORS[i % COLORS.length];
    const points = displayFYs.map(yr => (a.fyData && a.fyData[yr]) ? +a.fyData[yr] : null);
    points.push(+a.balance || 0);
    datasets.push({
      label: a.name,
      data:  points,
      borderColor: color,
      backgroundColor: color + '22',
      pointBackgroundColor: color,
      pointRadius: 4,
      pointHoverRadius: 6,
      tension: 0.3,
      fill: false,
      spanGaps: true,
    });
  });

  // Combined total (only if 2+ accounts)
  if(superAccounts.length > 1){
    const combined = displayFYs.map(yr => {
      const vals = superAccounts.map(a => a.fyData && a.fyData[yr] ? +a.fyData[yr] : null);
      if(vals.every(v => v === null)) return null;
      return vals.reduce((s,v) => s + (v||0), 0);
    });
    combined.push(superAccounts.reduce((s,a) => s + (+a.balance||0), 0));
    datasets.unshift({
      label: 'Combined Total',
      data:  combined,
      borderColor: suCombinedColor,
      backgroundColor: suCombinedColor + '22',
      pointBackgroundColor: suCombinedColor,
      pointRadius: 5,
      pointHoverRadius: 7,
      borderWidth: 2.5,
      tension: 0.3,
      fill: false,
      spanGaps: true,
      order: 0,
    });
  }

  const isDark   = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridClr  = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const textClr  = isDark ? '#9ca3af' : '#6b7280';

  if(suChart) suChart.destroy();
  suChart = new Chart(canvas, {
    type: 'line',
    data: { labels: displayLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { display:true, labels:{ color:textClr, font:{size:11}, boxWidth:12, padding:16 } },
        tooltip: { callbacks: { label: ctx => ' '+ctx.dataset.label+': '+n2(ctx.parsed.y) } }
      },
      scales: {
        x: { grid:{ color:gridClr }, ticks:{ color:textClr, font:{size:11} } },
        y: {
          grid:{ color:gridClr },
          ticks:{
            color:textClr, font:{size:11},
            callback: v => '$'+(v>=1e6?(v/1e6).toFixed(1)+'M':v>=1000?(v/1000).toFixed(0)+'k':v)
          }
        }
      }
    }
  });
}

function toggleSuperChartRange(){
  suChartShowAll = !suChartShowAll;
  renderSuperChart();
}

function setSuperCombinedColor(val){
  suCombinedColor = val;
  localStorage.setItem('su_combined_color', val);
  renderSuperChart();
}

function syncSuperColorPickers(){
  const cp = $('su-combined-color');
  if(cp) cp.value = suCombinedColor;
}

// ── SYNC (GitHub Gist) ───────────────────────────────────────────
// syncKey  = GitHub Personal Access Token (gist scope only)
// syncDevice = friendly name for this device
// pt_sync_gist_id = stored after first push (the Gist ID)
const GIST_FILENAME = 'portfolio_tracker_data.json';

async function syncAutoLoad(){
  const gistId = localStorage.getItem('pt_sync_gist_id');
  if(!syncKey || !gistId) return;
  setSyncStatus('Syncing…','var(--blue)');
  try {
    const gist = await gistRequest('GET', '/gists/'+gistId);
    const file = gist.files[GIST_FILENAME];
    if(!file) return;
    let raw = file.content;
    if(file.truncated){
      const r = await fetch(file.raw_url, {mode:'cors'});
      raw = await r.text();
    }
    const remote = JSON.parse(raw);
    const remoteSavedAt = remote.savedAt;
    const localSavedAt  = localStorage.getItem('pt_last_sync');
    const cloudIsNewer  = !localSavedAt || new Date(remoteSavedAt) > new Date(localSavedAt);
    if(cloudIsNewer){
      applyRemoteData(remote);
      localStorage.setItem('pt_last_sync', remoteSavedAt);
      localStorage.setItem('pt_sync_gist_id', gistId);
      const ts = new Date(remoteSavedAt).toLocaleString();
      setSyncStatus('✓ Auto-synced '+ts,'var(--green)');
      setTimeout(()=>setSyncStatus('Last sync: '+ts,'var(--text3)'),4000);
    } else {
      const ts = new Date(localSavedAt).toLocaleString();
      setSyncStatus('✓ Up to date','var(--green)');
      setTimeout(()=>setSyncStatus('Last sync: '+ts,'var(--text3)'),3000);
    }
  } catch(e){
    setSyncStatus('','var(--text3)');
    console.warn('Auto-sync failed:', e.message);
  }
}



function saveSyncKey(v){
  syncKey = v.trim();
  localStorage.setItem('pt_sync_key', syncKey);
}
function saveSyncDevice(v){
  syncDevice = v.trim() || syncDevice;
  localStorage.setItem('pt_sync_device', syncDevice);
}
function setSyncStatus(msg, color){
  const el = $('sync-status');
  if(el){ el.textContent = msg; el.style.color = color||'var(--text3)'; }
  const hdr = $('hdr-sync-status');
  if(hdr){ hdr.textContent = msg; hdr.style.color = color||'var(--text3)'; }
}

function buildSyncPayload(){
  if(!spendingData.length) loadSpending();
  return {
    version:  BACKUP_VERSION,
    savedAt:  new Date().toISOString(),
    device:   syncDevice,
    data: {
      pt_trades:         trades,
      pt_divs:           dividends,
      pt_props:          properties,
      pt_spending:       spendingData,
      pt_prices:         prices,
      cf_worker_url:     localStorage.getItem('cf_worker_url')||'',
      pt_drp_carry:      (()=>{try{return JSON.parse(localStorage.getItem('pt_drp_carry')||'{}');}catch(e){return {};}})() ,
      pt_drp_skipped:    getDRPSkipped(),
      pt_expdiv_skipped: getExpDivSkipped(),
      pt_drp_settings:   getDRPSettings(),
      pt_brokers:        getCustomBrokers(),
      pt_super:          superAccounts,
      su_combined_color: localStorage.getItem('su_combined_color')||'#ffffff',
      pt_tax: taxData, pt_stock_owners: stockOwners, pt_extra_persons: extraPersons,
      pt_amit: (()=>{try{return JSON.parse(localStorage.getItem('pt_amit')||'[]');}catch(e){return [];}})(),
      pt_cgt_loss_carry_in: (()=>{try{return JSON.parse(localStorage.getItem('pt_cgt_loss_carry_in')||'{}');}catch(e){return {};}})(),
    }
  };
}

async function gistRequest(method, path, body){
  if(!syncKey) throw new Error('No GitHub token set');
  const headers = {
    'Authorization': 'token ' + syncKey,
    'Accept':        'application/vnd.github+json',
  };
  // Only set Content-Type when sending a body (POST/PATCH)
  // Sending Content-Type on GET triggers CORS preflight which Safari can block
  if(body) headers['Content-Type'] = 'application/json';

  const opts = { method, headers, mode: 'cors' };
  if(body) opts.body = JSON.stringify(body);

  const res  = await fetch('https://api.github.com' + path, opts);
  const data = await res.json();
  if(!res.ok) throw new Error(data.message || ('GitHub API error ' + res.status));
  return data;
}


async function syncPush(){
  if(!syncKey){ notify('Enter your GitHub token in Settings → Cloud Sync first.','err'); return; }
  setSyncStatus('Pushing…','var(--blue)');
  try {
    const payload     = buildSyncPayload();
    const fileContent = JSON.stringify(payload, null, 2);
    const gistId      = localStorage.getItem('pt_sync_gist_id');
    let result;

    if(gistId){
      // Update existing gist
      result = await gistRequest('PATCH', '/gists/'+gistId, {
        description: 'Portfolio Tracker Sync — '+new Date().toLocaleDateString(),
        files: { [GIST_FILENAME]: { content: fileContent } },
      });
    } else {
      // Create new private gist
      result = await gistRequest('POST', '/gists', {
        description: 'Portfolio Tracker Sync',
        public: false,
        files: { [GIST_FILENAME]: { content: fileContent } },
      });
      localStorage.setItem('pt_sync_gist_id', result.id);
      // Save gist ID to sync-gist-id input if shown
      const gEl = $('sync-gist-id');
      if(gEl) gEl.value = result.id;
    }

    const ts = new Date().toLocaleString();
    localStorage.setItem('pt_last_sync', payload.savedAt);
    setSyncStatus('✓ Pushed '+ts,'var(--green)');
    notify('☁ Pushed to GitHub Gist ✓');
  } catch(e){
    setSyncStatus('✗ Push failed: '+e.message,'var(--red)');
    notify('Push failed: '+e.message,'err');
  }
}

let _remotePending = null;
let taxFY = 0; // 0 = current FY, or specific year e.g. 2025
let taxData = (() => { try { return JSON.parse(localStorage.getItem('pt_tax')||'{}'); } catch(e){ return {}; } })();
// Stock ownership map: {SYMBOL: 'lumia'|'chilli'|'joint'|customName}
let stockOwners = (()=>{try{return JSON.parse(localStorage.getItem('pt_stock_owners')||'{}');}catch(e){return {};}})();
// Known persons list (lumia + chilli are built-in, others user-defined)
let extraPersons = (()=>{try{return JSON.parse(localStorage.getItem('pt_extra_persons')||'[]');}catch(e){return [];}})(); // {FY: {lumia:{salary,withheld,payg,...}, chilli:{...}, props:{propId:{expenses,depr_bldg,depr_pe}}}}

async function syncPull(){
  // Always read token fresh from the input field first
  const keyEl = $('sync-key');
  if(keyEl && keyEl.value.trim()) saveSyncKey(keyEl.value.trim());

  if(!syncKey){
    notify('Enter your GitHub token in Settings → Cloud Sync first.','err');
    return;
  }

  setSyncStatus('Pulling…','var(--blue)');
  try {
    // Read gist ID — prefer input field value over stored
    let gistId = localStorage.getItem('pt_sync_gist_id')||'';
    const gistEl = $('sync-gist-id');
    if(gistEl && gistEl.value.trim()) gistId = gistEl.value.trim();
    // Sanitize gistId: only allow alphanumeric and hyphens, no path traversal
    gistId = gistId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

    if(!gistId){
      setSyncStatus('No Gist ID — push first or paste Gist ID in Settings','var(--text3)');
      notify('No Gist ID. Push from your main device first, then copy the Gist ID to this device.','err');
      return;
    }

    setSyncStatus('Fetching from GitHub…','var(--blue)');
    const gist   = await gistRequest('GET', '/gists/'+gistId);
    const file   = gist.files[GIST_FILENAME];
    if(!file) throw new Error('Portfolio file not found in Gist — check Gist ID is correct');

    // Fetch raw content if truncated
    let rawContent = file.content;
    if(file.truncated){
      setSyncStatus('Fetching full data…','var(--blue)');
      // Fetch raw content without auth header to avoid CORS preflight on Safari
      // raw_url is already a pre-signed URL that doesn't need auth
      const rawRes = await fetch(file.raw_url, { mode: 'cors' });
      if(!rawRes.ok) throw new Error('Could not fetch full content: '+rawRes.status);
      rawContent = await rawRes.text();
    }

    let remote;
    try { remote = JSON.parse(rawContent); }
    catch(e){ throw new Error('Could not parse Gist data — file may be corrupted'); }

    const remoteSavedAt  = remote.savedAt;
    const localSavedAt   = localStorage.getItem('pt_last_sync');
    const localHasData   = trades.length > 0 || dividends.length > 0;
    const remoteIsNewer  = !localSavedAt || new Date(remoteSavedAt) > new Date(localSavedAt);
    const differentDevice= remote.device && remote.device !== syncDevice;

    // Only show conflict if: local has data, different device, AND local is strictly newer
    // If remote is newer or same age — just apply it (user clearly wants the cloud version)
    if(localHasData && differentDevice && !remoteIsNewer){
      _remotePending = remote;
      const remoteTs = remoteSavedAt ? new Date(remoteSavedAt).toLocaleString() : 'unknown';
      const localTs  = localSavedAt  ? new Date(localSavedAt).toLocaleString()  : 'never synced';
      const infoEl   = $('sync-conflict-info');
      if(infoEl) infoEl.innerHTML =
        '<b>This device ('+syncDevice+'):</b> '+trades.length+' trades, last sync: '+localTs+'<br>'+
        '<b>Cloud ('+remote.device+'):</b> '+(remote.data?.pt_trades?.length||0)+' trades, saved: '+remoteTs;
      const cfEl = $('sync-conflict');
      if(cfEl) cfEl.style.display = '';
      setSyncStatus('⚠ Local is newer — choose version','var(--gold)');
      return;
    }

    // Apply remote data
    applyRemoteData(remote);
    localStorage.setItem('pt_sync_gist_id', gistId);
    localStorage.setItem('pt_last_sync', remoteSavedAt||new Date().toISOString());
    const ts = remoteSavedAt ? new Date(remoteSavedAt).toLocaleString() : 'now';
    setSyncStatus('✓ Pulled '+ts,'var(--green)');
    notify('☁ Pulled from GitHub Gist ✓');
  } catch(e){
    console.error('syncPull error:', e);
    setSyncStatus('✗ Pull failed: '+e.message,'var(--red)');
    notify('Pull failed: '+e.message+'\n\nCheck: token has gist scope, Gist ID is correct, network is online.','err');
  }
}


function applyRemoteData(remote){
  const d = remote.data;
  trades       = d.pt_trades     || [];
  dividends    = d.pt_divs       || [];
  properties   = d.pt_props      || [];
  spendingData = d.pt_spending   || [];
  prices       = d.pt_prices     || {};
  localStorage.setItem('pt_trades',   JSON.stringify(trades));
  localStorage.setItem('pt_divs',     JSON.stringify(dividends));
  localStorage.setItem('pt_props',    JSON.stringify(properties));
  localStorage.setItem('pt_spending', JSON.stringify(spendingData));
  localStorage.setItem('pt_prices',   JSON.stringify(prices));
  if(d.cf_worker_url)    localStorage.setItem('cf_worker_url',    d.cf_worker_url);
  if(d.pt_drp_carry)     localStorage.setItem('pt_drp_carry',     JSON.stringify(d.pt_drp_carry));
  if(d.pt_drp_skipped)   localStorage.setItem('pt_drp_skipped',   JSON.stringify(d.pt_drp_skipped));
  if(d.pt_expdiv_skipped) localStorage.setItem('pt_expdiv_skipped', JSON.stringify(d.pt_expdiv_skipped));
  if(d.pt_brokers && d.pt_brokers.length) saveCustomBrokers(d.pt_brokers);
  if(d.pt_super)         { superAccounts = d.pt_super; saveSuperAccounts(); }
  if(d.pt_stock_owners){ stockOwners=d.pt_stock_owners; saveStockOwners(); }
  if(d.pt_extra_persons){ extraPersons=d.pt_extra_persons; saveExtraPersons(); }
  if(d.pt_tax){ taxData = d.pt_tax; saveTaxData(); }
  if(d.pt_drp_settings) localStorage.setItem('pt_drp_settings', JSON.stringify(d.pt_drp_settings));
  if(d.pt_amit){ amitAdjustments = d.pt_amit; saveAmitAdjustments(); }
  if(d.pt_cgt_loss_carry_in) localStorage.setItem('pt_cgt_loss_carry_in', JSON.stringify(d.pt_cgt_loss_carry_in));
  if(d.su_combined_color){ suCombinedColor = d.su_combined_color;
                           localStorage.setItem('su_combined_color', d.su_combined_color); }
  refreshAllBrokerSelects();
  renderH(); renderT(); renderR(); renderHD();
  renderFYBar(); renderDividends(); renderDivCharts(); renderDivCards();
  renderProperties(); renderAnalytics();
  try { renderSuperAccounts(); renderSuperCards(); renderSuperChart(); } catch(e){}
  try { renderSpending(); } catch(e){}
  try { renderTax(); } catch(e){}
  try { renderCGT(); } catch(e){}
  try { renderOwnershipGrid(); } catch(e){}
  // Clear revert buttons after sync pull (user confirmed remote data is source of truth)
  if(typeof mathInpClearAllReverts==='function') mathInpClearAllReverts();
}

function syncResolve(choice){
  const cfEl = $('sync-conflict');
  if(cfEl) cfEl.style.display = 'none';
  if(choice === 'remote' && _remotePending){
    applyRemoteData(_remotePending);
    const ts = new Date(_remotePending.savedAt||Date.now()).toLocaleString();
    if(_remotePending.savedAt) localStorage.setItem('pt_last_sync', _remotePending.savedAt);
    setSyncStatus('✓ Cloud version applied '+ts,'var(--green)');
    notify('☁ Cloud version applied ✓');
  } else {
    setSyncStatus('Local version kept — push to overwrite cloud','var(--text3)');
    notify('Local version kept. Push when ready to overwrite cloud.');
  }
  _remotePending = null;
}

function syncCancelConflict(){
  const cfEl = $('sync-conflict');
  if(cfEl) cfEl.style.display = 'none';
  _remotePending = null;
  setSyncStatus('Sync cancelled','var(--text3)');
}

function syncInitUI(){
  const keyEl   = $('sync-key');
  const devEl   = $('sync-device');
  const gistEl  = $('sync-gist-id');
  if(keyEl)  keyEl.value  = syncKey;
  if(devEl)  devEl.value  = syncDevice;
  if(gistEl) gistEl.value = localStorage.getItem('pt_sync_gist_id')||'';
  const lastSync = localStorage.getItem('pt_last_sync');
  if(lastSync) setSyncStatus('Last sync: '+new Date(lastSync).toLocaleString(),'var(--text3)');
}


function normaliseSplits(p){
  if(Array.isArray(p.splits)&&p.splits.length) return p.splits;
  // Legacy single-loan migration
  if(p.loanCurrent||p.loanInitial||p.interestRate){
    return [{
      id:'sp_legacy',
      label:'Split 1',
      initial:+p.loanInitial||0,
      balance:+p.loanCurrent||0,
      rate:   +p.interestRate||0,
      ltype:  p.loanType||'pi',
      term:   +p.loanTerm||0,
      repay:  +p.monthlyRepayment||0,
      offset: +p.offsetBalance||0,
    }];
  }
  return [];
}

function renderSplitRows(splits){
  const wrap = $('pf-splits-wrap');
  if(!splits||!splits.length){
    splits=[{id:'sp_'+uid(),label:'Split 1',initial:0,balance:0,rate:0,ltype:'pi',term:0,repay:0,offset:0}];
  }
  wrap.innerHTML = splits.map((sp,i)=>`
    <div class="split-row" data-split-id="${sp.id}" style="background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:10px 12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <input class="fi sp-label" type="text" value="${sp.label||('Split '+(i+1))}" placeholder="Label" style="width:140px;padding:3px 7px;font-size:12px;font-weight:600">
        <button type="button" class="btn btn-r" style="padding:2px 8px;font-size:11px" onclick="removeLoanSplit(this)">✕ Remove</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px">
        <div><label class="fl" style="font-size:10px">Initial Amount</label>
          <input class="fi sp-initial" type="number" value="${sp.initial||''}" placeholder="0" step="any" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px">Current Balance</label>
          <input class="fi sp-balance" type="number" value="${sp.balance||''}" placeholder="0" step="any" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px">Rate (% p.a.)</label>
          <input class="fi sp-rate" type="number" value="${sp.rate||''}" placeholder="e.g. 5.89" step="0.01" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px">Loan Type</label>
          <select class="fi sp-ltype" style="padding:3px 7px" oninput="calcPropPreview()">
            <option value="pi" ${(sp.ltype||'pi')==='pi'?'selected':''}>P&I</option>
            <option value="io" ${sp.ltype==='io'?'selected':''}>IO</option>
          </select></div>
        <div><label class="fl" style="font-size:10px">Term (years)</label>
          <input class="fi sp-term" type="number" value="${sp.term||''}" placeholder="e.g. 25" step="1" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px">Repayment Override</label>
          <input class="fi sp-repay" type="number" value="${sp.repay||''}" placeholder="Auto" step="any" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px">Offset Balance</label>
          <input class="fi sp-offset" type="number" value="${sp.offset||''}" placeholder="0" step="any" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px">Loan Purpose <span style="font-size:9px;color:var(--text3)">(tax)</span></label>
          <select class="fi sp-purpose" style="padding:3px 7px" oninput="calcPropPreview()">
            <option value="rental"     ${(!sp.purpose||sp.purpose==='rental')    ?'selected':''}>🏠 Rental</option>
            <option value="investment" ${sp.purpose==='investment'?'selected':''}>📈 Investment</option>
            <option value="personal"   ${sp.purpose==='personal'  ?'selected':''}>👤 Personal</option>
          </select></div>
      </div>
    </div>`).join('');
}

function addLoanSplit(){
  const wrap = $('pf-splits-wrap');
  const count = wrap.querySelectorAll('.split-row').length;
  const spId = 'sp_'+uid();
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="split-row" data-split-id="${spId}" style="background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:10px 12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <input class="fi sp-label" type="text" value="Split ${count+1}" placeholder="Label" style="width:140px;padding:3px 7px;font-size:12px;font-weight:600">
        <button type="button" class="btn btn-r" style="padding:2px 8px;font-size:11px" onclick="removeLoanSplit(this)">✕ Remove</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px">
        <div><label class="fl" style="font-size:10px">Initial Amount</label>
          <input class="fi sp-initial" type="number" placeholder="0" step="any" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px">Current Balance</label>
          <input class="fi sp-balance" type="number" placeholder="0" step="any" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px">Rate (% p.a.)</label>
          <input class="fi sp-rate" type="number" placeholder="e.g. 5.89" step="0.01" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px">Loan Type</label>
          <select class="fi sp-ltype" style="padding:3px 7px" oninput="calcPropPreview()">
            <option value="pi">P&I</option>
            <option value="io">IO</option>
          </select></div>
        <div><label class="fl" style="font-size:10px">Term (years)</label>
          <input class="fi sp-term" type="number" placeholder="e.g. 25" step="1" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px">Repayment Override</label>
          <input class="fi sp-repay" type="number" placeholder="Auto" step="any" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px">Offset Balance</label>
          <input class="fi sp-offset" type="number" placeholder="0" step="any" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px">Loan Purpose <span style="font-size:9px;color:var(--text3)">(tax)</span></label>
          <select class="fi sp-purpose" style="padding:3px 7px" oninput="calcPropPreview()">
            <option value="rental">🏠 Rental</option>
            <option value="investment">📈 Investment</option>
            <option value="personal">👤 Personal</option>
          </select></div>
      </div>
    </div>`;
  wrap.appendChild(div.firstElementChild);
  calcPropPreview();
}

function removeLoanSplit(btn){
  const wrap = $('pf-splits-wrap');
  if(wrap.querySelectorAll('.split-row').length<=1){
    notify('At least one loan split is required.','err'); return;
  }
  btn.closest('.split-row').remove();
  calcPropPreview();
}

function propMetrics(p){
  const cval    = +p.currentValue||0;
  const pprice  = +p.purchasePrice||0;
  const pcosts  = +p.purchaseCosts||0;
  const rent    = +p.weeklyRent||0;
  const expenses= +p.annualExpenses||0;

  const splits = normaliseSplits(p);
  const loanCur  = splits.reduce((s,sp)=>s+(+sp.balance||0),0);
  const loanInit = splits.reduce((s,sp)=>s+(+sp.initial||0),0);

  let monthlyInterest=0, interestSaved=0, annualInterest=0, repay=0;
  let investmentAnnualInterest = 0, personalAnnualInterest = 0;
  splits.forEach(sp=>{
    const bal  = +sp.balance||0;
    const off  = +sp.offset||0;
    const rate = +sp.rate||0;
    const term = +sp.term||0;
    const ltype= sp.ltype||'pi';
    const purpose = sp.purpose||'rental';
    const eff  = Math.max(0, bal - off);
    const moInt= +(eff*(rate/100)/12).toFixed(2);
    const saved= +(off*(rate/100)/12).toFixed(2);
    const autoR= ltype==='io' ? moInt : calcMonthlyPI(eff, rate, term);
    monthlyInterest += moInt;
    interestSaved   += saved;
    annualInterest  += moInt*12;
    repay           += +(+sp.repay || autoR);
    if(purpose==='investment') investmentAnnualInterest += moInt*12;
    if(purpose==='personal')   personalAnnualInterest   += moInt*12;
  });
  monthlyInterest = +monthlyInterest.toFixed(2);
  interestSaved   = +interestSaved.toFixed(2);
  annualInterest  = +annualInterest.toFixed(2);
  repay           = +repay.toFixed(2);

  const wtRate = loanCur>0
    ? splits.reduce((s,sp)=>s+((+sp.balance||0)/loanCur)*(+sp.rate||0),0)
    : 0;
  const totalOffset   = splits.reduce((s,sp)=>s+(+sp.offset||0),0);
  const effectiveLoan = Math.max(0, loanCur - totalOffset);
  const equity        = cval - loanCur;
  const gainRaw       = cval - pprice - pcosts;
  const gainPct       = (pprice+pcosts)>0?(gainRaw/(pprice+pcosts))*100:0;
  const lvr           = cval>0?(loanCur/cval)*100:0;
  const annualRent    = rent*52;
  const annualNetRent = annualRent - expenses - annualInterest;
  const grossYield    = pprice>0?(annualRent/pprice)*100:0;
  const netYield      = cval>0?(annualNetRent/cval)*100:0;
  const principalRepaid = loanInit - loanCur;

  return { cval,pprice,pcosts,loanCur,loanInit,effectiveLoan,investmentAnnualInterest,personalAnnualInterest,
    monthlyInterest,interestSaved,annualInterest,
    equity,gainRaw,gainPct,lvr,annualRent,annualNetRent,
    grossYield,netYield,repay,principalRepaid,wtRate,splits };
}

// ── LIVE PREVIEW ──────────────────────────────────────────────────────
function calcPropPreview(){
  const p = readPropForm();
  const m = propMetrics(p);
  if(!p.purchasePrice && !p.currentValue){ $('prop-preview').style.display='none'; return; }
  $('prop-preview').style.display='';
  const items = [
    {l:'Equity',              v:n2(m.equity),              c:clr(m.equity)},
    {l:'Unrealised Gain',     v:n2(m.gainRaw),             c:clr(m.gainRaw)},
    {l:'Gain %',              v:m.gainPct.toFixed(2)+'%',  c:clr(m.gainPct)},
    {l:'LVR',                 v:m.lvr.toFixed(1)+'%',      c:m.lvr>80?'neg':m.lvr>60?'':'pos'},
    {l:'Total Loan Balance',  v:n2(m.loanCur),             c:'neu'},
    {l:'Effective Loan',      v:n2(m.effectiveLoan),        c:'neu'},
    {l:'Wtd Avg Rate',        v:m.wtRate.toFixed(2)+'%',   c:'neu'},
    {l:'Monthly Interest',    v:n2(m.monthlyInterest),     c:'neg'},
    {l:'Offset Savings/mo',   v:n2(m.interestSaved),       c:'pos'},
    {l:'Est. Total Repayment',v:n2(m.repay),               c:'neu'},
    {l:'Gross Yield',         v:m.grossYield.toFixed(2)+'%',c:m.grossYield>0?'pos':'neu'},
    {l:'Net Yield',           v:m.netYield.toFixed(2)+'%', c:clr(m.netYield)},
  ];
  $('prop-preview-grid').innerHTML = items.map(i=>
    `<div><div style="color:var(--text3);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px">${i.l}</div>
     <div class="${i.c}" style="font-size:14px;font-weight:600">${i.v}</div></div>`
  ).join('');
}

function readPropForm(){
  const splits = [];
  document.querySelectorAll('#pf-splits-wrap .split-row').forEach(row=>{
    splits.push({
      id:      row.dataset.splitId || ('sp_'+uid()),
      label:   row.querySelector('.sp-label').value.trim()||'Split',
      initial: parseFloat(row.querySelector('.sp-initial').value)||0,
      balance: parseFloat(row.querySelector('.sp-balance').value)||0,
      rate:    parseFloat(row.querySelector('.sp-rate').value)||0,
      ltype:   row.querySelector('.sp-ltype').value,
      term:    parseFloat(row.querySelector('.sp-term').value)||0,
      repay:   parseFloat(row.querySelector('.sp-repay').value)||0,
      offset:  parseFloat(row.querySelector('.sp-offset').value)||0,
      purpose: (row.querySelector('.sp-purpose')||{value:'rental'}).value || 'rental',
    });
  });
  return {
    id:          $('pf-edit-id').dataset.id||null,
    name:        $('pf-name').value.trim(),
    propType:    $('pf-type').value,
    purchaseDate:$('pf-pdate').value,
    purchasePrice: parseFloat($('pf-pprice').value)||0,
    purchaseCosts: parseFloat($('pf-pcosts').value)||0,
    capitalImprovements: parseFloat($('pf-improvements').value)||0,
    currentValue:  parseFloat($('pf-cval').value)||0,
    splits,
    weeklyRent:    parseFloat($('pf-rent').value)||0,
    annualExpenses:parseFloat($('pf-expenses').value)||0,
    hasManager:    $('pf-mgr').value,
    owner:         $('pf-owner')?.value || 'lumia',
    notes:         $('pf-notes').value.trim(),
    sold:          $('pf-sold')?.checked || false,
    soldDate:      $('pf-sdate')?.value || '',
    salePrice:     parseFloat($('pf-sprice')?.value)||0,
    sellingCosts:  parseFloat($('pf-scosts')?.value)||0,
    mainResExempt: $('pf-mainres')?.checked || false,
  };
}

function saveProperty(){
  const p = readPropForm();
  if(!p.name){ notify('Enter a property name/address.','err'); return; }
  if(!p.purchasePrice){ notify('Enter purchase price.','err'); return; }

  if(p.id){
    const idx = properties.findIndex(x=>x.id===p.id);
    if(idx>=0){ p.id=properties[idx].id; properties[idx]=p; }
  } else {
    p.id = 'prop_'+uid();
    properties.push(p);
  }
  saveProps();
  clearPropForm();
  renderProperties();
  renderPropCards();
  if(typeof renderTax==='function') renderTax();
  notify('Property saved ✓');
}



// ── DRP ───────────────────────────────────────────────────────────────

// Carry-forward stored per symbol: { 'VAS': 8.00, 'AFI': 3.42 }
function getDRPCarry(){
  try { return JSON.parse(localStorage.getItem('pt_drp_carry')||'{}'); } catch(e){ return {}; }
}
function saveDRPCarry(obj){
  localStorage.setItem('pt_drp_carry', JSON.stringify(obj));
}

// ── DRP SKIPPED ──────────────────────────────────────────────────────────────
// Dividend IDs excluded from DRP Processing re-scans, keyed by dividend id →
// { symbol, date, skippedAt, reason }. reason is 'cash' (company paid this
// particular dividend out instead of reinvesting it — a genuine data point,
// not just "ignore for now") or 'manual' (plain Skip button).
function getDRPSkipped(){
  try { return JSON.parse(localStorage.getItem('pt_drp_skipped')||'{}'); } catch(e){ return {}; }
}
function saveDRPSkipped(obj){
  localStorage.setItem('pt_drp_skipped', JSON.stringify(obj));
}
function markDRPSkipped(divId, sym, date, reason){
  const skipped = getDRPSkipped();
  skipped[divId] = { symbol:sym, date, skippedAt:new Date().toISOString().slice(0,10), reason: reason||'manual' };
  saveDRPSkipped(skipped);
}
function unskipDRPItem(divId){
  const skipped = getDRPSkipped();
  delete skipped[divId];
  saveDRPSkipped(skipped);
  notify('Restored to DRP Processing — click "Check & Process Dividends" again to see it.','ok');
}

// ── EXPECTED DIVIDEND CHECKER — dismissed entries ─────────────────────────────
// The "Expected Dividends" checker synthesizes rows from Yahoo's dividend
// history rather than reading real dividend records, so there's no id to key
// off — use symbol+date+per-unit amount as a stable fingerprint instead.
// Recorded rows are hidden by dvChkKey() lookup; separately, entries the user
// has explicitly dismissed (false positives, N/A for them, etc.) are stored
// here so they stay hidden across future checks too.
function dvChkKey(r){ return r.symbol+'|'+r.date+'|'+(+r.perUnit).toFixed(6); }
function getExpDivSkipped(){
  try { return JSON.parse(localStorage.getItem('pt_expdiv_skipped')||'{}'); } catch(e){ return {}; }
}
function saveExpDivSkipped(obj){
  localStorage.setItem('pt_expdiv_skipped', JSON.stringify(obj));
}
function markExpDivSkipped(r){
  const skipped = getExpDivSkipped();
  skipped[dvChkKey(r)] = { symbol:r.symbol, date:r.date, perUnit:r.perUnit, skippedAt:new Date().toISOString().slice(0,10) };
  saveExpDivSkipped(skipped);
}
function unskipExpDivItem(key){
  const skipped = getExpDivSkipped();
  delete skipped[key];
  saveExpDivSkipped(skipped);
  notify('Restored — re-run "Check & Process Dividends" to see it.','ok');
}

// ── DRP SETTINGS ─────────────────────────────────────────────────────────────
// Structure: { "DHHF:AU": { enabled: true, fractional: false }, ... }
function getDRPSettings(){
  try { return JSON.parse(localStorage.getItem('pt_drp_settings')||'{}'); } catch(e){ return {}; }
}
function saveDRPSettings(obj){
  localStorage.setItem('pt_drp_settings', JSON.stringify(obj));
}
function setDRPFlag(sym, field, val){
  const s = getDRPSettings();
  if(!s[sym]) s[sym] = { enabled:false, fractional:false };
  s[sym][field] = val;
  saveDRPSettings(s);
}

function drpLoadCarry(){
  const sym = ($('dv-sym')?.value||'').toUpperCase();
  if(!sym) return;
  const carry = getDRPCarry();
  const el = $('dv-drp-carry-in');
  if(el) el.value = carry[sym] ? carry[sym].toFixed(2) : '';
  drpCalc();
}

function drpCalc(){
  const units    = parseFloat($('dv-drp-units')?.value)    || 0;
  const price    = parseFloat($('dv-drp-price')?.value)    || 0;
  const amount   = parseFloat($('dv-amt')?.value)          || 0;
  const carryIn  = parseFloat($('dv-drp-carry-in')?.value) || 0;
  const sym      = ($('dv-sym')?.value || '').toUpperCase();
  const date     = $('dv-date')?.value || '';

  const available  = amount + carryIn;
  const reinvested = units > 0 && price > 0 ? +(units * price).toFixed(2) : 0;
  const carryOut   = available > 0 && reinvested > 0 ? +(available - reinvested).toFixed(2) : 0;

  if(units > 0 && available > 0 && price === 0){
    const calcPrice = +(available / units).toFixed(6);
    const prEl = $('dv-drp-price');
    if(prEl && !prEl.matches(':focus')) prEl.value = calcPrice;
  }

  const prevT = $('dv-drp-prev-trade');
  const prevD = $('dv-drp-prev-div');
  const prevC = $('dv-drp-prev-carry');
  if(!prevT || !prevD || !prevC) return;

  if(!sym || !date || !amount){
    prevT.innerHTML = '<span style="color:var(--text3)">Fill symbol, date and amount to see preview</span>';
    prevD.innerHTML = ''; prevC.innerHTML = '';
    return;
  }

  prevD.innerHTML = `<span style="color:var(--text3)">Dividend →</span> <b>${sym}</b> `
    + `declared <b style="color:var(--green)">${n2(amount)}</b>`
    + (carryIn > 0 ? ` + <span style="color:var(--gold)">${n2(carryIn)} carry-in</span> = <b style="color:var(--green)">${n2(available)}</b> available` : '');

  if(units > 0 && price > 0){
    prevT.innerHTML = `<span style="color:var(--text3)">Trade →</span> `
      + `<span style="background:#3b1f6e;color:#c4b5fd;border:1px solid #7c3aed;border-radius:4px;padding:1px 6px;font-size:10px">DRP</span> `
      + `<b>${sym}</b> ${nN(units,4)} units @ ${n2(price)} = <b style="color:var(--green)">${n2(reinvested)}</b>`;
    if(carryOut > 0.005){
      prevC.innerHTML = `<span style="color:var(--text3)">Carry-forward →</span> `
        + `<span style="color:var(--gold);font-weight:600">${n2(carryOut)}</span> saved for next ${sym} DRP`;
    } else if(carryOut < -0.005){
      prevC.innerHTML = `<span style="color:var(--red)">⚠ Units×price (${n2(reinvested)}) exceeds available (${n2(available)}) by ${n2(Math.abs(carryOut))}</span>`;
    } else {
      prevC.innerHTML = `<span style="color:var(--text3)">No remainder — fully reinvested ✓</span>`;
    }
  } else {
    prevT.innerHTML = `<span style="color:var(--text3)">Enter units and price to see trade preview</span>`;
    prevC.innerHTML = '';
  }
}



// ── COLLAPSIBLE SECTIONS ──────────────────────────────────────────────
function toggleSection(key){
  const body   = $('sec-body-'+key);
  const toggle = $('sec-toggle-'+key);
  if(!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display   = isOpen ? 'none' : '';
  toggle.textContent   = isOpen ? '+' : '−';
  toggle.style.color   = isOpen ? 'var(--text3)' : 'var(--blue)';
}

function togglePropForm(forceOpen){
  const body   = $('prop-form-body');
  const toggle = $('prop-form-toggle');
  const isOpen = body.style.display !== 'none';
  const open   = forceOpen !== undefined ? forceOpen : !isOpen;
  body.style.display   = open ? '' : 'none';
  toggle.textContent   = open ? '−' : '+';
  toggle.style.color   = open ? 'var(--blue)' : 'var(--text3)';
}

function togglePropSoldFields(){
  const box = $('pf-sold');
  const wrap = $('pf-sold-fields');
  if(!box || !wrap) return;
  wrap.style.display = box.checked ? 'grid' : 'none';
}

function clearPropForm(){
  ['pf-name','pf-pprice','pf-pcosts','pf-improvements','pf-cval','pf-rent','pf-expenses','pf-notes','pf-sdate','pf-sprice','pf-scosts']
    .forEach(id=>{ const el=$(id); if(el) el.value=''; });
  $('pf-pdate').value='';
  if($('pf-sold')) $('pf-sold').checked=false;
  if($('pf-mainres')) $('pf-mainres').checked=false;
  togglePropSoldFields();
  $('pf-edit-id').textContent=''; $('pf-edit-id').dataset.id='';
  $('prop-form-title-text').textContent='Add Property';
  renderSplitRows([]);
  togglePropForm(false);
  $('prop-preview').style.display='none';
}

function editProperty(btn){
  const id = btn.dataset.id;
  const p = properties.find(x=>x.id===id);
  if(!p) return;
  $('pf-name').value         = p.name||'';
  $('pf-type').value         = p.propType||'ppor';
  $('pf-pdate').value        = p.purchaseDate||'';
  $('pf-pprice').value       = p.purchasePrice||'';
  $('pf-pcosts').value       = p.purchaseCosts||'';
  if($('pf-improvements')) $('pf-improvements').value = p.capitalImprovements||'';
  $('pf-cval').value         = p.currentValue||'';
  $('pf-rent').value         = p.weeklyRent||'';
  // Prefill Annual Expenses from Tax tab (rates+insurance+repairs+agent+other)
  const _taxFY = getTaxFY();
  const _taxRec = (taxData[taxKey(_taxFY)]||{}).props||{};
  const _tpr = _taxRec[p.id]||{};
  const _taxExpenses = (+_tpr.rates||0)+(+_tpr.insurance||0)+(+_tpr.repairs||0)+(+_tpr.agent||0)+(+_tpr.other||0);
  // Use tax expenses if they exist, otherwise fall back to stored annualExpenses
  $('pf-expenses').value = _taxExpenses > 0 ? _taxExpenses : (p.annualExpenses||'');
  if($('pf-owner')) $('pf-owner').value = p.owner||'lumia';
  $('pf-mgr').value          = p.hasManager||'no';
  $('pf-notes').value        = p.notes||'';
  if($('pf-sold')){
    $('pf-sold').checked   = !!p.sold;
    $('pf-sdate').value    = p.soldDate||'';
    $('pf-sprice').value   = p.salePrice||'';
    $('pf-scosts').value   = p.sellingCosts||'';
    $('pf-mainres').checked= !!p.mainResExempt;
    togglePropSoldFields();
  }
  $('pf-edit-id').dataset.id = p.id;
  renderSplitRows(normaliseSplits(p));
  $('prop-form-title-text').textContent = 'Edit Property — '+p.name;
  togglePropForm(true);
  calcPropPreview();
  $('prop-form-wrap').scrollIntoView({behavior:'smooth'});
}

function deleteProperty(btn){
  const id = btn.dataset.id;
  const p = properties.find(x=>x.id===id);
  if(!confirm('Delete '+p?.name+'?')) return;
  properties = properties.filter(x=>x.id!==id);
  saveProps();
  renderProperties();
  renderPropCards();
  if(typeof renderTax==='function') renderTax();
  notify('Property deleted.','ok');
}

const PROP_TYPE_LABEL = {ppor:'PPOR',investment:'Investment',commercial:'Commercial',land:'Land'};

function renderProperties(){
  const wrap = $('prop-cards-wrap');
  if(!properties.length){
    wrap.innerHTML='<div class="empty"><div class="empty-icon">🏠</div>No properties added yet. Fill in the form above.</div>';
    return;
  }
  wrap.innerHTML = properties.map(p=>{
    const m = propMetrics(p);
    const typeLabel = PROP_TYPE_LABEL[p.propType]||p.propType;
    const lvrClass = m.lvr>80?'neg':m.lvr>60?'':'pos';

    const stat = (label,val,cls='neu') =>
      `<div><div style="font-size:10px;color:var(--text3);letter-spacing:.07em;text-transform:uppercase;margin-bottom:2px">${label}</div>
       <div class="${cls}" style="font-family:var(--mono);font-size:13px;font-weight:600">${val}</div></div>`;

    // Splits table
    const splitsHtml = m.splits.length ? `
      <div style="margin-bottom:16px">
        <div style="font-family:var(--mono);font-size:10px;color:var(--text2);letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">LOAN SPLITS</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px">
            <thead>
              <tr style="color:var(--text3);border-bottom:1px solid var(--border)">
                <th style="text-align:left;padding:4px 8px 4px 0;font-weight:500">SPLIT</th>
                <th style="text-align:right;padding:4px 8px;font-weight:500">TYPE</th>
                <th style="text-align:right;padding:4px 8px;font-weight:500">BALANCE</th>
                <th style="text-align:right;padding:4px 8px;font-weight:500">RATE</th>
                <th style="text-align:right;padding:4px 8px;font-weight:500">OFFSET</th>
                <th style="text-align:right;padding:4px 8px;font-weight:500">EFF. LOAN</th>
                <th style="text-align:right;padding:4px 8px;font-weight:500">MO. INTEREST</th>
                <th style="text-align:right;padding:4px 8px;font-weight:500">REPAYMENT</th>
              </tr>
            </thead>
            <tbody>
              ${m.splits.map(sp=>{
                const bal  = +sp.balance||0;
                const off  = +sp.offset||0;
                const rate = +sp.rate||0;
                const eff  = Math.max(0, bal-off);
                const moInt= +(eff*(rate/100)/12).toFixed(2);
                const autoR= sp.ltype==='io' ? moInt : calcMonthlyPI(eff,rate,+sp.term||0);
                const rep  = +(+sp.repay||autoR).toFixed(2);
                return `<tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:5px 8px 5px 0;font-weight:600">${sp.label||'Split'}</td>
                  <td style="text-align:right;padding:5px 8px"><span class="badge b-reit">${sp.ltype==='io'?'IO':'P&I'}</span></td>
                  <td style="text-align:right;padding:5px 8px">${n2(bal)}</td>
                  <td style="text-align:right;padding:5px 8px">${rate.toFixed(2)}%</td>
                  <td style="text-align:right;padding:5px 8px;color:var(--green)">${off?n2(off):'—'}</td>
                  <td style="text-align:right;padding:5px 8px">${n2(eff)}</td>
                  <td style="text-align:right;padding:5px 8px;color:var(--red)">${n2(moInt)}</td>
                  <td style="text-align:right;padding:5px 8px">${n2(rep)}</td>
                </tr>`;
              }).join('')}
              ${m.splits.length>1?`<tr style="border-top:2px solid var(--border);font-weight:700;color:var(--text2)">
                <td style="padding:5px 8px 5px 0">TOTAL</td>
                <td style="text-align:right;padding:5px 8px;font-size:10px">${m.wtRate.toFixed(2)}% wtd</td>
                <td style="text-align:right;padding:5px 8px">${n2(m.loanCur)}</td>
                <td colspan="2"></td>
                <td style="text-align:right;padding:5px 8px">${n2(m.effectiveLoan)}</td>
                <td style="text-align:right;padding:5px 8px;color:var(--red)">${n2(m.monthlyInterest)}</td>
                <td style="text-align:right;padding:5px 8px">${n2(m.repay)}</td>
              </tr>`:''}
            </tbody>
          </table>
        </div>
      </div>` : '';

    return `<div class="fs" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div style="font-family:var(--mono);font-size:15px;font-weight:600">${escHtml(p.name)}</div>
            <span style="font-size:10px;padding:2px 8px;border-radius:12px;font-family:var(--mono);background:${({lumia:"#1e3a5f",chilli:"#4a1942",joint:"#1a3a2a"})[p.owner||"lumia"]||"#1e3a5f"};color:${({lumia:"#60a5fa",chilli:"#f472b6",joint:"#34d399"})[p.owner||"lumia"]||"#60a5fa"}">${({lumia:"Lumia",chilli:"Chilli",joint:"Joint 50/50"})[p.owner||"lumia"]||"Lumia"}</span>
            ${p.sold?'<span class="badge b-lic">SOLD '+(p.soldDate||'')+'</span>':''}
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px;font-family:var(--mono)">
            <span class="badge b-reit">${typeLabel}</span>
            ${p.purchaseDate?' · Purchased '+p.purchaseDate:''}
            ${p.notes?' · '+p.notes:''}
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn" onclick="editProperty(this)" data-id="${p.id}">✏ EDIT</button>
          <button class="btn btn-r" onclick="deleteProperty(this)" data-id="${p.id}">✕ DELETE</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:16px">
        ${stat('Current Value',   n2(m.cval))}
        ${stat('Purchase Price',  n2(m.pprice))}
        ${stat('Equity',          n2(m.equity),    clr(m.equity))}
        ${stat('Unrealised Gain', n2(m.gainRaw),   clr(m.gainRaw))}
        ${stat('Gain %',          m.gainPct.toFixed(2)+'%', clr(m.gainPct))}
        ${stat('LVR',             m.lvr.toFixed(1)+'%', lvrClass)}
      </div>

      ${splitsHtml}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:14px">
          <div style="font-family:var(--mono);font-size:10px;color:var(--text2);letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px">LOAN SUMMARY</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${stat('Total Balance',    n2(m.loanCur))}
            ${stat('Initial Total',    n2(m.loanInit))}
            ${stat('Total Offset',     n2(m.splits.reduce((s,sp)=>s+(+sp.offset||0),0)), 'pos')}
            ${stat('Effective Loan',   n2(m.effectiveLoan))}
            ${stat('Wtd Avg Rate',     m.wtRate.toFixed(2)+'% p.a.')}
            ${stat('Monthly Interest', n2(m.monthlyInterest), 'neg')}
            ${stat('Offset Savings/mo',n2(m.interestSaved),   'pos')}
            ${stat('Est. Repayment',   n2(m.repay))}
            ${stat('Principal Repaid', n2(m.principalRepaid),  'pos')}
          </div>
        </div>
        ${p.propType!=='ppor'?`<div style="background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:14px">
          <div style="font-family:var(--mono);font-size:10px;color:var(--text2);letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px">RENTAL INCOME</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${stat('Weekly Rent',      n2(+p.weeklyRent||0))}
            ${stat('Annual Rent',      n2(m.annualRent), 'pos')}
            ${stat('Annual Expenses',  n2(+p.annualExpenses||0), 'neg')}
            ${stat('Annual Interest',  n2(m.annualInterest), 'neg')}
            ${m.investmentAnnualInterest>0 ? stat('\u2514 Investment (📈 deductible)', n2(m.investmentAnnualInterest), 'neg') : ''}
            ${m.personalAnnualInterest>0   ? stat('\u2514 Personal (👤 not deductible)', n2(m.personalAnnualInterest), 'neu') : ''}
            ${stat('Net Annual Income',n2(m.annualNetRent), clr(m.annualNetRent))}
            ${stat('Gross Yield',      m.grossYield.toFixed(2)+'%', m.grossYield>0?'pos':'neu')}
            ${stat('Net Yield',        m.netYield.toFixed(2)+'%',   clr(m.netYield))}
            ${stat('Manager',          p.hasManager==='yes'?'Yes':'Self')}
          </div>
        </div>`:`<div style="background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:14px;display:flex;align-items:center;justify-content:center">
          <div style="text-align:center;color:var(--text3);font-family:var(--mono);font-size:12px">🏠<br>Primary Residence<br>No rental income</div>
        </div>`}
      </div>
    </div>`;
  }).join('');
}

function renderPropCards(){
  const heldProperties = properties.filter(p=>!p.sold);
  const totalVal    = heldProperties.reduce((s,p)=>s+(+p.currentValue||0),0);
  const totalEquity = heldProperties.reduce((s,p)=>s+propMetrics(p).equity,0);
  const totalDebt   = heldProperties.reduce((s,p)=>s+normaliseSplits(p).reduce((t,sp)=>t+(+sp.balance||0),0),0);
  const totalOffset = heldProperties.reduce((s,p)=>s+normaliseSplits(p).reduce((t,sp)=>t+(+sp.offset||0),0),0);
  const netDebt     = Math.max(0, totalDebt - totalOffset);
  const totalGain   = heldProperties.reduce((s,p)=>s+propMetrics(p).gainRaw,0);
  const annualRent  = heldProperties.filter(p=>p.propType!=='ppor')
                       .reduce((s,p)=>s+(+p.weeklyRent||0)*52,0);
  const monthlyRepay= heldProperties.reduce((s,p)=>s+propMetrics(p).repay,0);

  // Portfolio net worth
  const holdingsVal = calcH().reduce((s,h)=>s+(prices[priceSymbol(h.symbol)]?prices[priceSymbol(h.symbol)]*h.units:0),0);
  const netWorth    = holdingsVal + totalEquity;

  // Debt toggle
  const debtVal   = propDebtNet ? netDebt   : totalDebt;
  const debtLabel = propDebtNet ? 'Net Debt' : 'Total Debt';
  const debtSub   = propDebtNet
    ? 'Debt − offsets ('+n2(totalOffset)+') ↻'
    : 'Outstanding loans ↻';

  // Rent toggle — whole card clickable
  const rentVal   = propRentAnnual ? annualRent   : annualRent/12;
  const rentLabel = propRentAnnual ? 'Annual Rent' : 'Monthly Rent';
  const rentSub   = propRentAnnual ? 'Gross rental income ↻' : 'Gross rental income ↻';

  // Repayment toggle — whole card clickable
  const repayVal   = propRepayAnnual ? monthlyRepay*12 : monthlyRepay;
  const repayLabel = propRepayAnnual ? 'Annual Repayments' : 'Total Repayments';
  const repaySub   = propRepayAnnual ? 'Per year ↻' : 'Per month ↻';

  const cards = [
    {l:'Property Value',  v:n2(totalVal),    s:'neu',            sub:heldProperties.length+' propert'+(heldProperties.length===1?'y':'ies'), fn:''},
    {l:'Total Equity',    v:n2(totalEquity), s:clr(totalEquity), sub:'Value − loan balance',   fn:''},
    {l:debtLabel,         v:n2(debtVal),     s:'neg',            sub:debtSub,                  fn:'togglePropDebt()'},
    {l:'Unrealised Gain', v:n2(totalGain),   s:clr(totalGain),   sub:'vs purchase price',      fn:''},
    {l:rentLabel,         v:n2(rentVal),     s:'pos',            sub:rentSub,                  fn:'togglePropRent()'},
    {l:repayLabel,        v:n2(repayVal),    s:'neg',            sub:repaySub,                 fn:'togglePropRepay()'},
    {l:'Net Worth',       v:n2(netWorth),    s:clr(netWorth),    sub:'Equity + portfolio',     fn:''},
  ];
  $('pw-cards').innerHTML = cards.map(c=>
    `<div class="card"${c.fn?` onclick="${c.fn}" style="cursor:pointer" title="Click to toggle"`:''}>
      <div class="card-label">${c.l}</div>
      <div class="card-value ${c.s}">${c.v}</div>
      <div class="card-sub">${c.sub}</div>
    </div>`
  ).join('');
}
function togglePropDebt(){
  propDebtNet = !propDebtNet;
  renderPropCards();
}

function togglePropRent(){
  propRentAnnual = !propRentAnnual;
  renderPropCards();
}
function togglePropRepay(){
  propRepayAnnual = !propRepayAnnual;
  renderPropCards();
}


// ── SETTINGS ─────────────────────────────────────────────────────────