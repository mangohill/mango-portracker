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
  const ncc_cur = getC('ncc_cur'), sgc_cur = getC('sgc_cur'), ncc_prev = getC('ncc_prev'), sgc_prev = getC('sgc_prev');

  function calcROI(startBal, endBal, empCC, perCC, ncc, sgc){
    if(!startBal || !endBal) return null;
    // Concessional (employer, salary-sacrifice/personal-deductible, SGC) contributions arrive after 15% contributions tax;
    // non-concessional ones arrive untaxed. Either way they are money in, not investment gain.
    const afterTaxCC = ((empCC||0) + (perCC||0) + (sgc||0)) * 0.85 + (ncc||0);
    const gain       = endBal - startBal - afterTaxCC;
    const avgBal     = (startBal + endBal) / 2;
    const roi        = avgBal > 0 ? (gain / avgBal) * 100 : null;
    return { gain, roi, afterTaxCC };
  }

  const roi_cur  = prevBal  ? calcROI(prevBal,  curBal,  empCC_cur,  perCC_cur,  ncc_cur,  sgc_cur)  : null;
  const roi_prev = prev2Bal ? calcROI(prev2Bal, prevBal, empCC_prev, perCC_prev, ncc_prev, sgc_prev) : null;

  const clr = v => v === null ? 'neu' : v >= 0 ? 'pos' : 'neg';
  const fmt = (v, prefix='$') => v === null ? '—' : (v>=0?'+':'')+prefix+n2(v);
  const fmtPct = v => v === null ? '—' : (v>=0?'+':'')+v.toFixed(2)+'%';

  const items = [
    {l:'Current Balance',          v:n2(curBal),           c:'su-current'},
    prevBal  ? {l:'FY'+PREV_FY+' Balance', v:n2(prevBal), c:'su-prev'} : null,
    roi_cur  ? {l:'FY'+CUR_FY+' Inv. Gain',  v:fmt(roi_cur.gain),       c:clr(roi_cur.gain)}  : null,
    roi_cur  ? {l:'FY'+CUR_FY+' ROI',        v:fmtPct(roi_cur.roi),     c:clr(roi_cur.roi)}   : null,
    prev2Bal ? {l:'FY'+PREV2_FY+' Balance',  v:n2(prev2Bal),        c:'su-older'}               : null,
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

// Pick the badge tint for an individual super account. If the account is
// named after a person (e.g. "Lumia", "Chilli's Super"), use that person's
// colour; otherwise keep the account's own chart colour.
function superAccountTint(a){
  const name = String((a && a.name) || '').trim().toLowerCase();
  if(name && typeof getAllPersons === 'function' && typeof getPersonColour === 'function'){
    const key = getAllPersons().find(k => {
      const keyLc = String(k).toLowerCase();
      const label = String(typeof getPersonLabel === 'function' ? getPersonLabel(k) : k).toLowerCase();
      return name === keyLc || name === label
          || name.startsWith(label + ' ')
          || name.startsWith(label + ' -')
          || name.startsWith(label + ' –')
          || name.startsWith(label + ' —')
          || name.startsWith(label + "'s")
          || name.startsWith(label + '’s');
    });
    if(key) return getPersonColour(key);
  }
  return (a && a.color) || 'var(--cat-super)';
}

function renderSuperCards(clickPulse = false){
  const el = $('su-cards');
  if(!el) return;

  // Clamp view index in case accounts were deleted
  if(suCardView > superAccounts.length) suCardView = 0;

  const _now    = new Date();
  const CUR_FY  = _now.getMonth() >= 6 ? _now.getFullYear()+1 : _now.getFullYear();
  const PREV_FY = CUR_FY - 1;  // most recently completed FY

  // Helper: get balance for an account at end of a given FY (or null)
  const fyBal = (a, fy) => (a.fyData && a.fyData[fy]) ? +a.fyData[fy] : null;

  let balLabel, balVal, balSub, prevLabel, prevVal, growthVal, growthPct, growthNum = null;
  let balNum = null, prevNum = null;

  // Remember what the cards currently show so a click can count from the old
  // figure to the new one (same tween + flash pulse as the Portfolio cards).
  const prevShown = [...el.querySelectorAll('.card-value')].map(v => {
    const raw = parseFloat(v.textContent.replace(/[^0-9.\-]/g, ''));
    return isFinite(raw) ? raw : null;
  });

  if(suCardView === 0){
    // ── Combined view ──
    const totalBal  = superAccounts.reduce((s,a) => s + (+a.balance||0), 0);
    const totalPrev = superAccounts.reduce((s,a) => s + (fyBal(a, PREV_FY)||0), 0);
    const growth    = totalPrev > 0 ? totalBal - totalPrev : null;
    const gPct      = growth !== null && totalPrev > 0 ? (growth/totalPrev)*100 : null;
    growthNum       = growth;
    const n         = superAccounts.length;
    balLabel  = 'Total Balance';
    balVal    = n2(totalBal,0);
    balNum    = totalBal;
    balSub    = n + ' account' + (n===1?'':'s') + (n>0?' · click to cycle ↻':'');
    prevLabel = 'FY' + PREV_FY + ' Balance';
    prevVal   = totalPrev > 0 ? n2(totalPrev,0) : '—';
    prevNum   = totalPrev > 0 ? totalPrev : null;
    growthVal = growth !== null ? (growth>=0?'+':'') + n2(growth,0) : '—';
    growthPct = gPct   !== null ? (gPct>=0?'+':'')   + gPct.toFixed(1)+'%' : '';
  } else {
    // ── Single account view ──
    const a    = superAccounts[suCardView - 1];
    const bal  = +a.balance||0;
    const prev = fyBal(a, PREV_FY);
    const growth = prev !== null ? bal - prev : null;
    const gPct   = growth !== null && prev > 0 ? (growth/prev)*100 : null;
    growthNum    = growth;
    balLabel  = a.name;
    balVal    = n2(bal,0);
    balNum    = bal;
    balSub    = 'click to cycle ↻';
    prevLabel = 'FY' + PREV_FY + ' Balance';
    prevVal   = prev !== null ? n2(prev,0) : '—';
    prevNum   = prev;
    growthVal = growth !== null ? (growth>=0?'+':'') + n2(growth,0) : '—';
    growthPct = gPct   !== null ? (gPct>=0?'+':'')   + gPct.toFixed(1)+'%' : '';
  }

  const growthClass = growthNum == null ? 'neu' : growthNum > 0 ? 'pos' : growthNum < 0 ? 'neg' : 'neu';
  // Super balances use the category colours (purple total, blue prior FY);
  // growth flips red when the balance has fallen.
  const growthTint = growthClass === 'neg' ? 'var(--debt-red)'
                    : growthClass === 'pos' ? 'var(--asset-lime)'
                    : 'var(--neutral-slate)';
  // Combined stays purple. An individual account takes its owner's colour when
  // the account name matches a known person (Lumia, Chilli, custom), otherwise
  // it falls back to the account's own chart colour.
  const firstTint = suCardView === 0
    ? 'var(--cat-super)'
    : superAccountTint(superAccounts[suCardView - 1]);
  const tints = [firstTint, 'var(--cat-portfolio)', growthTint];

  el.innerHTML = [
    { l: balLabel,              v: balVal,   s: 'neu',        sub: balSub,
      onclick: 'cycleSuperCardView()' },
    { l: prevLabel,             v: prevVal,  s: 'neu',        sub: 'End of FY' + PREV_FY,
      onclick: 'cycleSuperCardView()' },
    { l: 'Growth since FY' + PREV_FY, v: growthVal, s: growthClass, sub: growthPct,
      onclick: 'cycleSuperCardView()' },
  ].map((c, i) =>
    `<div class="card" onclick="${c.onclick}" style="cursor:pointer;${cardTint(tints[i])}">
      <div class="card-label">${c.l}</div>
      <div class="card-value ${c.s}">${c.v}</div>
      <div class="card-sub">${c.sub}</div>
    </div>`
  ).join('');

  // Match the Portfolio cards: count from the previous figure to the new one
  // and run the same flash pulse, so cycling a Super badge feels identical.
  if(typeof animateValue === 'function'){
    const targets = [
      { v: balNum,    f: v => n2(v,0) },
      { v: prevNum,   f: v => n2(v,0) },
      { v: growthNum, f: v => (v>=0?'+':'') + n2(v,0) },
    ];
    el.querySelectorAll('.card-value').forEach((node, i) => {
      const old = prevShown[i];
      const card = node.closest('.card');
      if(old != null) node.dataset.rawVal = String(old);
      animateValue(node, targets[i].v, { format: targets[i].f });
      // Every click should react, even when the figure itself is unchanged
      // (e.g. cycling between a single account and the combined view).
      if(clickPulse && card && !card.classList.contains('flash-pos') && !card.classList.contains('flash-neg')){
        card.classList.remove('flash-click');
        void card.offsetWidth;
        card.classList.add('flash-click');
        clearTimeout(card._clickT);
        card._clickT = setTimeout(() => card.classList.remove('flash-click'), 650);
      }
    });
  }
}

function cycleSuperCardView(){
  if(!superAccounts.length) return;
  suCardView = (suCardView + 1) % (superAccounts.length + 1);
  renderSuperCards(true);
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
        const hadCur = c.empCC_cur != null || c.perCC_cur != null || c.ncc_cur != null || c.sgc_cur != null;
        if(hadCur){
          c.empCC_prev = c.empCC_cur || 0;
          c.perCC_prev = c.perCC_cur || 0;
          c.ncc_prev   = c.ncc_cur   || 0;
          c.sgc_prev   = c.sgc_cur   || 0;
          delete c.empCC_cur; delete c.perCC_cur; delete c.ncc_cur; delete c.sgc_cur;
          changed = true;
        } else if(c.empCC_prev != null || c.perCC_prev != null || c.ncc_prev != null || c.sgc_prev != null){
          // Nothing was entered for the year that just ended, so whatever sits in "previous year" is now
          // two years old — clear it rather than leave it mislabelled as last year's contributions.
          delete c.empCC_prev; delete c.perCC_prev; delete c.ncc_prev; delete c.sgc_prev;
          changed = true;
        }
      });
      if(changed){
        saveSuperAccounts();
        if(typeof notify === 'function') notify('Super balances & contributions rolled over to FY'+CUR_FY+' ✓ — check the FY'+PREV_FY+' 30 June balance is right (it was captured when you first opened the app after 1 July)','ok');
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

  function calcROI(startBal, endBal, empCC, perCC, ncc, sgc){
    if(!startBal || !endBal) return null;
    // Concessional (employer, salary-sacrifice/personal-deductible, SGC) contributions arrive after 15% contributions tax;
    // non-concessional ones arrive untaxed. Either way they are money in, not investment gain.
    const afterTaxCC = ((empCC||0) + (perCC||0) + (sgc||0)) * 0.85 + (ncc||0);
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
  const collapsible = (title, body, startCollapsed=false) => `
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:14px;margin-top:12px">
        <div onclick="toggleSuperSection(this)" style="font-family:var(--mono);font-size:10px;color:var(--text2);letter-spacing:.1em;text-transform:uppercase;margin-bottom:0;display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none">
          ${title}<span style="font-size:16px;color:${startCollapsed?'var(--text3)':'var(--blue)'};line-height:1;font-weight:300">${startCollapsed?'+':'−'}</span>
        </div>
        <div class="su-section-body" style="margin-top:${startCollapsed?'0':'12px'};display:${startCollapsed?'none':''}">
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
    const sgc_cur    = +contrib.sgc_cur    || 0;
    const empCC_prev = +contrib.empCC_prev || 0;
    const perCC_prev = +contrib.perCC_prev || 0;
    const ncc_prev   = +contrib.ncc_prev   || 0;
    const sgc_prev   = +contrib.sgc_prev   || 0;

    const roi_cur  = prevBal  !== null ? calcROI(prevBal,  curBal,  empCC_cur,  perCC_cur,  ncc_cur,  sgc_cur)  : null;
    const roi_prev = prev2Bal !== null ? calcROI(prev2Bal, prevBal, empCC_prev, perCC_prev, ncc_prev, sgc_prev) : null;

    const fmtROI  = r => r === null ? '—'
      : `<span class="${r.roi>=0?'pos':'neg'}">${r.roi>=0?'+':''}${r.roi.toFixed(2)}%</span>`;
    const fmtGain = r => r === null ? '—'
      : `<span class="${r.gain>=0?'pos':'neg'}">${r.gain>=0?'+':''}${n2(r.gain)}</span>`;

    // SGC (super guarantee charge paid via the ATO after a late/missed employer
    // payment) is NOT a concessional contribution for cap purposes — it's shown
    // for reference only and deliberately excluded from contribCur/contribPrev
    // and therefore from calcCarryForward()'s cap-usage calc.
    const contribCur  = empCC_cur  + perCC_cur;
    const contribPrev = empCC_prev + perCC_prev;
    const hasContrib  = contribCur || contribPrev || ncc_cur || ncc_prev || sgc_cur || sgc_prev;

    // ── CONTRIBUTIONS panel ─────────────────────────────────────
    const contribBody = hasContrib ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div>
              <div style="font-size:10px;color:var(--text3);margin-bottom:8px;font-family:var(--mono)">FY${CUR_FY} — in progress</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                ${stat('Employer CC',     empCC_cur  ? n2(empCC_cur)          : '—')}
                ${stat('Personal CC',     perCC_cur  ? n2(perCC_cur)          : '—', perCC_cur  ? 'su-personal': 'neu')}
                ${stat('Total CC',        contribCur ? n2(contribCur)         : '—', contribCur ? 'su-total'   : 'neu')}
                ${stat('After-tax (85%)', contribCur ? n2(contribCur*0.85)    : '—', contribCur ? 'su-aftertax': 'neu')}
                ${ncc_cur  ? stat('Non-Concessional', n2(ncc_cur), 'su-noncc')            : ''}
                ${sgc_cur  ? stat('SGC (excl. from cap)', n2(sgc_cur), 'neu', 'Not a concessional contribution') : ''}
              </div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text3);margin-bottom:8px;font-family:var(--mono)">FY${PREV_FY} — completed</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                ${stat('Employer CC',     empCC_prev  ? n2(empCC_prev)         : '—')}
                ${stat('Personal CC',     perCC_prev  ? n2(perCC_prev)         : '—', perCC_prev  ? 'su-personal': 'neu')}
                ${stat('Total CC',        contribPrev ? n2(contribPrev)        : '—', contribPrev ? 'su-total'   : 'neu')}
                ${stat('After-tax (85%)', contribPrev ? n2(contribPrev*0.85)   : '—', contribPrev ? 'su-aftertax': 'neu')}
                ${ncc_prev ? stat('Non-Concessional', n2(ncc_prev), 'su-noncc')           : ''}
                ${sgc_prev ? stat('SGC (excl. from cap)', n2(sgc_prev), 'neu', 'Not a concessional contribution') : ''}
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
    const cfPanel = collapsible('CARRY-FORWARD CC', cfBody, true);

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
    const ncPanel = collapsible('NON-CONCESSIONAL CONTRIBUTIONS', ncBody, true);

    // ── INVESTMENT RETURN panel ──────────────────────────────────
    const needsFYData = prevBal === null;
    const roiBody = needsFYData
      ? `<div style="color:var(--text3);font-size:11px">Enter FY${PREV_FY} balance in the form above to calculate investment return.</div>`
      : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div>
            <div style="font-size:10px;color:var(--text3);margin-bottom:8px;font-family:var(--mono)">FY${CUR_FY} — Current vs FY${PREV_FY} end</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              ${stat('Start (FY'+PREV_FY+')',  n2(prevBal))}
              ${stat('End (Current)',           n2(curBal), 'su-current')}
              ${stat('After-tax CC',            roi_cur ? n2(roi_cur.afterTaxCC)       : '$0.00')}
              ${stat('Inv. Gain',               roi_cur ? fmtGain(roi_cur)                  : n2(curBal-prevBal))}
              ${stat('Avg Balance',             n2((prevBal+curBal)/2), 'su-muted')}
              ${stat('ROI %',                   roi_cur ? fmtROI(roi_cur)                   : '—')}
            </div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text3);margin-bottom:8px;font-family:var(--mono)">FY${PREV_FY} — FY${PREV_FY} vs FY${PREV2_FY} end</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              ${prev2Bal !== null ? stat('Start (FY'+PREV2_FY+')', n2(prev2Bal)) : stat('Start (FY'+PREV2_FY+')', '—')}
              ${stat('End (FY'+PREV_FY+')',      n2(prevBal), 'su-prev')}
              ${stat('After-tax CC',            roi_prev ? n2(roi_prev.afterTaxCC)      : '$0.00')}
              ${stat('Inv. Gain',               roi_prev ? fmtGain(roi_prev)                : '—')}
              ${stat('Avg Balance',             prev2Bal !== null ? n2((prev2Bal+prevBal)/2) : '—', 'su-muted')}
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
        ${stat('Current Balance', n2(curBal), 'su-current')}
        ${prevBal  !== null ? stat('FY'+PREV_FY+' Balance',  n2(prevBal),  'su-prev')  : ''}
        ${prev2Bal !== null ? stat('FY'+PREV2_FY+' Balance', n2(prev2Bal), 'su-older') : ''}
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
    // A backup restored AFTER the cloud copy was saved must not be overwritten by that older copy on the
    // next page open (restoring an older backup is exactly when this matters). A cloud save made after
    // the restore still pulls as normal.
    const restoredAt = localStorage.getItem('pt_last_restore');
    const cloudOlderThanRestore = !!(restoredAt && remoteSavedAt && new Date(remoteSavedAt) <= new Date(restoredAt));
    const cloudNewerThanLocal   = !localSavedAt || new Date(remoteSavedAt) > new Date(localSavedAt);
    const cloudIsNewer  = cloudNewerThanLocal && !cloudOlderThanRestore;
    if(cloudIsNewer){
      applyRemoteData(remote);
      localStorage.setItem('pt_last_sync', remoteSavedAt);
      localStorage.setItem('pt_sync_gist_id', gistId);
      const ts = new Date(remoteSavedAt).toLocaleString();
      setSyncStatus('✓ Auto-synced '+ts,'var(--green)');
      setTimeout(()=>setSyncStatus('Last sync: '+ts,'var(--text3)'),4000);
    } else if(cloudNewerThanLocal && cloudOlderThanRestore){
      setSyncStatus('ℹ Cloud copy is older than your restored backup — not pulled. Push to make the restored data the cloud copy.','var(--gold)');
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
      pt_pf_snapshots:   pfSnapshots,
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
      // Manual CoinGecko symbol→id overrides (Settings → Set CoinGecko ID)
      pt_cg_overrides: (typeof CG_OVERRIDES !== 'undefined') ? CG_OVERRIDES : {},
      // CGT simulator's saved/auto-snapshotted price at the CGT_CUTOFF_DATE cutoff (cgt.js)
      pt_price_cgt_cutoff: (()=>{try{return JSON.parse(localStorage.getItem('pt_price_cgt_cutoff')||'{}');}catch(e){return {};}})(),
      pt_price_cgt_cutoff_auto_saved: localStorage.getItem('pt_price_cgt_cutoff_auto_saved') || '',
      // Minor cache/config flags — small, no reason to drop them
      pt_pf_backfill_date: localStorage.getItem('pt_pf_backfill_date') || '',
      pt_pf_pruned_date:   localStorage.getItem('pt_pf_pruned_date') || '',
      pt_super_last_fy:    localStorage.getItem('pt_super_last_fy') || '',
      pt_price_feed_url:   localStorage.getItem('pt_price_feed_url') || '',
      // Small local-only stores that previously never left the device. pt_holdings_fy_snapshots
      // is the important one: past-year Net Worth holdings can't be reconstructed (see
      // networth.js), so a new device / restore used to lose them permanently.
      // (pt_benchmarks is deliberately left out — the Worker backfill rebuilds it.)
      pt_ls_extras: Object.fromEntries(SYNC_LS_EXTRAS.map(k=>[k, localStorage.getItem(k)]).filter(([,v])=>v!=null)),
    }
  };
}
const SYNC_LS_EXTRAS = ['pt_holdings_fy_snapshots','pt_price_alerts','pt_concentration_alerts','pt_ath',
  'pt_fire_current_age','pt_fire_re_age','pt_fire_fi_age','pt_fire_monthly_contrib','pt_fire_growth_pct','pt_fire_annual_spend'];

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
  mergePfSnapshots(d.pt_pf_snapshots);
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
  if(d.pt_cg_overrides){ CG_OVERRIDES = d.pt_cg_overrides; saveCGOverrides(); }
  // pt_price_20270630 fallback: payloads synced before the CGT cutoff-key rename used that property name
  { const cutoffPrices = d.pt_price_cgt_cutoff || d.pt_price_20270630;
    if(cutoffPrices) localStorage.setItem('pt_price_cgt_cutoff', JSON.stringify(cutoffPrices)); }
  { const cutoffAutoSaved = d.pt_price_cgt_cutoff_auto_saved || d.pt_price_20270630_auto_saved;
    if(cutoffAutoSaved) localStorage.setItem('pt_price_cgt_cutoff_auto_saved', cutoffAutoSaved); }
  if(d.pt_pf_backfill_date) localStorage.setItem('pt_pf_backfill_date', d.pt_pf_backfill_date);
  if(d.pt_pf_pruned_date)   localStorage.setItem('pt_pf_pruned_date',   d.pt_pf_pruned_date);
  if(d.pt_super_last_fy)    localStorage.setItem('pt_super_last_fy',    d.pt_super_last_fy);
  if(d.pt_price_feed_url)   localStorage.setItem('pt_price_feed_url',   d.pt_price_feed_url);
  if(d.pt_ls_extras && typeof d.pt_ls_extras === 'object'){
    SYNC_LS_EXTRAS.forEach(k => { if(typeof d.pt_ls_extras[k] === 'string') localStorage.setItem(k, d.pt_ls_extras[k]); });
  }
  if(d.su_combined_color){ suCombinedColor = d.su_combined_color;
                           localStorage.setItem('su_combined_color', d.su_combined_color); }
  try { resetMtmCache(); } catch(e){} // pfSnapshots just changed — drop the stale mark-to-market date cache
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
    <div class="split-row" data-split-id="${sp.id}" data-balances='${JSON.stringify(sp.balances||{})}' style="background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:10px 12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <input class="fi sp-label" type="text" value="${sp.label||('Split '+(i+1))}" placeholder="Label" style="width:140px;padding:3px 7px;font-size:12px;font-weight:600">
        <button type="button" class="btn btn-r" style="padding:2px 8px;font-size:11px" onclick="removeLoanSplit(this)">✕ Remove</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px">
        <div><label class="fl" style="font-size:10px">Original Amount</label>
          <input class="fi sp-initial" type="number" value="${sp.initial||''}" placeholder="0" step="any" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px">Current Balance</label>
          <input class="fi sp-balance" type="number" value="${sp.balance||''}" placeholder="0" step="any" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px" title="When this split began. On an investment split use the date debt recycling actually started — it sets the first FY shown and pro-rates that year's interest.">Start Date</label>
          <input class="fi sp-start" type="date" value="${sp.startDate?String(sp.startDate).slice(0,10):''}" style="padding:3px 7px" onchange="calcPropPreview();renderDRHistoryRows()"></div>
        <div><label class="fl" style="font-size:10px" title="Balance on the Start Date. Blank = use current balance.">Opening Balance</label>
          <input class="fi sp-open" type="number" value="${sp.openBalance!=null?sp.openBalance:''}" placeholder="Auto" step="any" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px" title="Optional. Splits paid off or refinanced stop accruing interest after this date.">Closed <span style="font-size:9px;color:var(--text3)">(optional)</span></label>
          <input class="fi sp-end" type="date" value="${sp.endDate?String(sp.endDate).slice(0,10):''}" style="padding:3px 7px" onchange="calcPropPreview();renderDRHistoryRows()"></div>
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
          <select class="fi sp-purpose" style="padding:3px 7px" onchange="calcPropPreview();renderDRHistoryRows()">
            <option value="rental"     ${(!sp.purpose||sp.purpose==='rental')    ?'selected':''}>Rental</option>
            <option value="investment" ${sp.purpose==='investment'?'selected':''}>Investment</option>
            <option value="personal"   ${sp.purpose==='personal'  ?'selected':''}>Personal</option>
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
    <div class="split-row" data-split-id="${spId}" data-balances="{}" style="background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:10px 12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <input class="fi sp-label" type="text" value="Split ${count+1}" placeholder="Label" style="width:140px;padding:3px 7px;font-size:12px;font-weight:600">
        <button type="button" class="btn btn-r" style="padding:2px 8px;font-size:11px" onclick="removeLoanSplit(this)">✕ Remove</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px">
        <div><label class="fl" style="font-size:10px">Original Amount</label>
          <input class="fi sp-initial" type="number" placeholder="0" step="any" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px">Current Balance</label>
          <input class="fi sp-balance" type="number" placeholder="0" step="any" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px" title="When this split began. On an investment split use the date debt recycling actually started — it sets the first FY shown and pro-rates that year's interest.">Start Date</label>
          <input class="fi sp-start" type="date" value="${localDateStr()}" style="padding:3px 7px" onchange="calcPropPreview();renderDRHistoryRows()"></div>
        <div><label class="fl" style="font-size:10px" title="Balance on the Start Date. Blank = use current balance.">Opening Balance</label>
          <input class="fi sp-open" type="number" placeholder="Auto" step="any" min="0" style="padding:3px 7px" oninput="calcPropPreview()"></div>
        <div><label class="fl" style="font-size:10px" title="Optional. Splits paid off or refinanced stop accruing interest after this date.">Closed <span style="font-size:9px;color:var(--text3)">(optional)</span></label>
          <input class="fi sp-end" type="date" style="padding:3px 7px" onchange="calcPropPreview();renderDRHistoryRows()"></div>
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
          <select class="fi sp-purpose" style="padding:3px 7px" onchange="calcPropPreview();renderDRHistoryRows()">
            <option value="rental">Rental</option>
            <option value="investment">Investment</option>
            <option value="personal">Personal</option>
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
  let drBalance = 0, drOffset = 0;
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
    // Minimum repayment is set on the FULL loan balance; an offset only reduces the interest charged.
    const autoR= ltype==='io' ? moInt : calcMonthlyPI(bal, rate, term);
    monthlyInterest += moInt;
    interestSaved   += saved;
    annualInterest  += moInt*12;
    repay           += +(+sp.repay || autoR);
    if(purpose==='investment'){
      investmentAnnualInterest += moInt*12;
      drBalance += bal;
      drOffset  += off;
    }
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
  const pImprove      = +p.capitalImprovements || 0; // part of the CGT cost base, so part of the gain calc
  const gainRaw       = cval - pprice - pcosts - pImprove;
  const gainPct       = (pprice+pcosts+pImprove)>0?(gainRaw/(pprice+pcosts+pImprove))*100:0;
  const lvr           = cval>0?(loanCur/cval)*100:0;
  const annualRent    = rent*52;
  const annualNetRent = annualRent - expenses - annualInterest;
  const grossYield    = pprice>0?(annualRent/pprice)*100:0;
  const netYield      = cval>0?(annualNetRent/cval)*100:0;
  const principalRepaid = loanInit - loanCur;

  const drEffectiveBalance = Math.max(0, drBalance - drOffset);

  return { cval,pprice,pcosts,loanCur,loanInit,effectiveLoan,investmentAnnualInterest,personalAnnualInterest,
    monthlyInterest,interestSaved,annualInterest,
    equity,gainRaw,gainPct,lvr,annualRent,annualNetRent,
    grossYield,netYield,repay,principalRepaid,wtRate,splits,
    drBalance,drOffset,drEffectiveBalance,drAnnualInterest:investmentAnnualInterest };
}

// ── DEBT RECYCLING — linked-stock dividend income ─────────────────────
// Sums dividends for a property's linked symbols, split into current FY
// (AU, Jul–Jun) vs the prior FY, for side-by-side comparison in the panel.
function calcDRDividendStats(p){
  const syms = new Set((p.drSymbols||[]).map(s=>s.toUpperCase()));
  const now = new Date();
  const curFY  = now.getMonth() >= 6 ? now.getFullYear()+1 : now.getFullYear();
  const prevFY = curFY - 1;
  let cur = 0, prev = 0, lifetime = 0;
  if(syms.size){
    dividends.forEach(d=>{
      if(!syms.has((d.symbol||'').toUpperCase())) return;
      lifetime += +d.amount||0;
      const fy = dateToFY(d.date);
      if(fy===curFY)       cur  += +d.amount||0;
      else if(fy===prevFY) prev += +d.amount||0;
    });
  }
  return { curFY, prevFY, curFYIncome:+cur.toFixed(2), prevFYIncome:+prev.toFixed(2), lifetimeIncome:+lifetime.toFixed(2) };
}

// Capital gain on a property's linked DR stocks. Reuses the CGT engine
// (FIFO parcels + realised disposals) so figures match the CGT tab exactly.
// Unrealised is "as of today" only — the app doesn't store historical
// prices, so a per-FY unrealised split isn't possible; only realised gain
// (from actual sells) can be split by FY.
function calcDRCapitalGains(p){
  const syms = new Set((p.drSymbols||[]).map(s=>s.toUpperCase()));
  const now = new Date();
  const curFY  = now.getMonth() >= 6 ? now.getFullYear()+1 : now.getFullYear();
  const prevFY = curFY - 1;
  const empty = { lifetimeUnrealised:0, currentValue:0, costBasis:0, investedBuyOnly:0, lifetimeRealised:0, curFYRealised:0, prevFYRealised:0, curFY, prevFY };
  if(!syms.size || typeof buildDisposals!=='function') return empty;

  const { disposals, openParcels } = buildDisposals();

  let lifetimeRealised=0, curFYRealised=0, prevFYRealised=0;
  disposals.forEach(d=>{
    if(!syms.has((d.symbol||'').toUpperCase())) return;
    lifetimeRealised += d.gain;
    const fy = dateToFY(d.saleDate);
    if(fy===curFY)       curFYRealised  += d.gain;
    else if(fy===prevFY) prevFYRealised += d.gain;
  });

  let lifetimeUnrealised = 0, currentValue = 0, costBasis = 0, investedBuyOnly = 0;
  syms.forEach(sym=>{
    const list  = (openParcels[sym]||[]).filter(pc=>pc.units>0.000001);
    const units = list.reduce((s,pc)=>s+pc.units,0);
    const cost  = list.reduce((s,pc)=>s+pc.cost,0);
    // "Buy orders only" — excludes units acquired via DRP reinvestment, so
    // Invested Amount reflects actual cash put in, not reinvested dividends.
    const buyCost = list.filter(pc=>pc.source!=='drp').reduce((s,pc)=>s+pc.cost,0);
    const price = prices[priceSymbol(sym)]||0;
    const value = units*price;
    currentValue       += value;
    costBasis           += cost;
    investedBuyOnly     += buyCost;
    lifetimeUnrealised  += value - cost;
  });

  return {
    lifetimeUnrealised: +lifetimeUnrealised.toFixed(2),
    currentValue:        +currentValue.toFixed(2),
    costBasis:            +costBasis.toFixed(2),
    investedBuyOnly:      +investedBuyOnly.toFixed(2),
    lifetimeRealised:   +lifetimeRealised.toFixed(2),
    curFYRealised:       +curFYRealised.toFixed(2),
    prevFYRealised:      +prevFYRealised.toFixed(2),
    curFY, prevFY,
  };
}

// ── DEBT RECYCLING — per-FY performance ────────────────────────────────
// The original DR panel is a lifetime snapshot: current investment-split
// balance, current rate × 12, and lifetime dividends/gains. That can't answer
// "which FY actually worked?" because it has no per-FY cost or capital-growth
// series. These helpers build one row per FY from:
//   • dividends + franking (exact, from `dividends`)
//   • realised gains (exact, from buildDisposals)
//   • capital growth (mark-to-market, when price history exists)
//   • DR debt + interest (manual override, auto snapshot, or estimate)
//   • the marginal rate (Tax tab, manual override, or a conservative fallback)
function drSymbolsSet(p){
  return new Set((p && p.drSymbols ? p.drSymbols : []).map(s=>String(s).toUpperCase()));
}

// Value of the linked holdings on a date. For "today" use the live holdings
// and live prices; for a past 30 June use the same mark-to-market path as the
// EOFY pack (nearest priced snapshot on/before the date).
function drValueAt(dateStr, syms){
  if(!syms || !syms.size) return { value:0, complete:true, count:0, priced:0 };
  if(dateStr === 'today' || dateStr === localDateStr()){
    const hs = (typeof calcH==='function' ? calcH() : [])
      .filter(h=>syms.has(String(h.symbol||'').toUpperCase()) && Math.abs(+h.units)>1e-9);
    if(!hs.length) return { value:0, complete:true, count:0, priced:0 };
    let value=0, priced=0;
    hs.forEach(h=>{
      let key = h.symbol;
      try{ if(typeof priceSymbol==='function') key = priceSymbol(h.symbol); }catch(e){}
      const px = (typeof prices!=='undefined' && prices) ? (prices[key] ?? prices[h.symbol]) : null;
      if(px!=null && isFinite(px)){ value += (+h.units||0)*(+px); priced++; }
    });
    // No quote at all for a held symbol: don't report a valuation of $0,
    // that would turn a year of gains into a fake 100% loss.
    if(priced===0) return { value:null, complete:false, count:hs.length, priced:0 };
    return { value, complete: priced===hs.length, count:hs.length, priced };
  }
  if(typeof findPricedSnapshotOnOrBefore!=='function' || typeof markToMarketAt!=='function'){
    return { value:null, complete:false, count:0, priced:0 };
  }
  const pricedDate = findPricedSnapshotOnOrBefore(dateStr);
  if(!pricedDate) return { value:null, complete:false, count:0, priced:0 };
  const mtm = markToMarketAt(pricedDate, h=>syms.has(String(h.symbol||'').toUpperCase()));
  const value = (mtm.value==null && mtm.count===0) ? 0 : mtm.value;
  return { value, complete: !!(mtm.complete || mtm.count===0), count:mtm.count, priced:mtm.priced, date:pricedDate };
}

// Tax cost base of the linked units on a date, from the same FIFO/AMIT parcel
// engine the CGT tab and the Debt Recycling panel use. The FY figures need it
// because "capital gain" as a broker reports it is the movement in unrealised
// gain (value less cost base), and AMIT adjustments move the cost base without
// moving the value — so value-change-less-cash would disagree with the panel.
function drCostBaseAt(dateStr, syms){
  if(!syms || !syms.size || typeof buildDisposals!=='function') return null;
  let res;
  try{ res = buildDisposals(dateStr); }catch(e){ return null; }
  const parcels = (res && res.openParcels) || {};
  let cost = 0;
  Object.keys(parcels).forEach(sym=>{
    if(!syms.has(String(sym).toUpperCase())) return;
    (parcels[sym]||[]).forEach(pc=>{
      if((+pc.units||0) > 1e-6) cost += +pc.cost||0;
    });
  });
  return cost;
}

// Today's unrealised gain on a symbol set, computed exactly the way the Debt
// Recycling panel computes it (open parcels × live price, less their cost
// base), so the current FY lands on the panel's figure rather than a
// near-identical re-derivation.
function drUnrealisedNow(syms){
  if(!syms || !syms.size || typeof buildDisposals!=='function') return null;
  let res;
  try{ res = buildDisposals(); }catch(e){ return null; }
  const parcels = (res && res.openParcels) || {};
  let total = 0, any = false;
  Object.keys(parcels).forEach(sym=>{
    if(!syms.has(String(sym).toUpperCase())) return;
    const list = (parcels[sym]||[]).filter(pc=>(+pc.units||0) > 1e-6);
    if(!list.length) return;
    const units = list.reduce((s,pc)=>s+(+pc.units||0),0);
    const cost  = list.reduce((s,pc)=>s+(+pc.cost||0),0);
    let key = sym;
    try{ if(typeof priceSymbol==='function') key = priceSymbol(sym); }catch(e){}
    const px = (typeof prices!=='undefined' && prices) ? (prices[key] ?? prices[sym]) : null;
    if(px==null || !isFinite(px)) return;
    any = true;
    total += units*(+px) - cost;
  });
  return any ? total : null;
}

// Net cash put into the linked holdings during the period. Buys and DRP adds
// count as new money; sells return money, so they reduce the contribution.
// Excluding DRP would double-count the reinvested dividend (it is already in
// income), hence DRP is included here just like a cash buy.
function drNetContributions(syms, fromDate, toDate){
  let total = 0;
  (typeof trades!=='undefined' ? trades : []).forEach(t=>{
    const sym = String(t.symbol||'').toUpperCase();
    if(!syms.has(sym)) return;
    const d = String(t.date||'').slice(0,10);
    if(!d || d < fromDate || d > toDate) return;
    const units=+t.units||0, price=+t.price||0, fees=+t.fees||0;
    if(t.type==='buy' || t.type==='drp') total += units*price + fees;
    else if(t.type==='sell') total -= units*price - fees;
  });
  return total;
}

function drDividendMap(p, fromDate, toDate){
  const syms = drSymbolsSet(p);
  const out = {};
  (typeof dividends!=='undefined' ? dividends : []).forEach(d=>{
    if(!syms.has(String(d.symbol||'').toUpperCase()) || !d.date) return;
    const dstr = String(d.date).slice(0,10);
    if(fromDate && dstr < fromDate) return;
    if(toDate && dstr > toDate) return;
    const fy = dateToFY(dstr);
    if(!out[fy]) out[fy] = { cash:0, frank:0 };
    const amt = +d.amount||0;
    out[fy].cash += amt;
    out[fy].frank += (typeof frankingCredit==='function' ? frankingCredit(amt, d.frankingPct||0) : 0);
  });
  return out;
}

function drRealisedMap(p, disposalsArg, fromDate, toDate){
  const syms = drSymbolsSet(p);
  const out = {};
  let disposals = disposalsArg;
  if(!disposals){
    try{ disposals = (typeof buildDisposals==='function' ? (buildDisposals().disposals||[]) : []); }
    catch(e){ disposals = []; }
  }
  (disposals||[]).forEach(d=>{
    if(!syms.has(String(d.symbol||'').toUpperCase()) || !d.saleDate) return;
    const dstr = String(d.saleDate).slice(0,10);
    if(fromDate && dstr < fromDate) return;
    if(toDate && dstr > toDate) return;
    const fy = dateToFY(dstr);
    out[fy] = (out[fy]||0) + (+d.gain||0);
  });
  return out;
}

// Marginal rate on an extra dollar of deduction. Uses salary minus sacrifice
// plus attributed dividends/franking for that FY; falls back to 32% only when
// there is no income recorded at all. Joint ownership blends both rates.
function drMarginalRate(fy, owner){
  let persons = owner==='joint'
    ? (typeof JOINT_PERSONS!=='undefined' ? JOINT_PERSONS : ['lumia','chilli'])
    : [owner||'lumia'];
  const rec = (typeof taxData!=='undefined' && taxData && taxData['FY'+fy]) ? taxData['FY'+fy] : {};
  const bases = [], rates = [];
  persons.forEach(person=>{
    const pRec = rec[person] || {};
    let base = Math.max(0, (+pRec.salary||0) - (+pRec.sacrifice||0));
    (typeof dividends!=='undefined' ? dividends : []).forEach(d=>{
      if(!d.date || dateToFY(String(d.date).slice(0,10))!==fy) return;
      let own = 'lumia';
      try{ if(typeof getSymbolOwner==='function') own = getSymbolOwner(d.symbol); }catch(e){}
      const share = own===person ? 1 : (own==='joint' && persons.includes(person) ? 0.5 : 0);
      if(!share) return;
      const amt = (+d.amount||0)*share;
      base += amt;
      if(typeof frankingCredit==='function') base += frankingCredit(amt, d.frankingPct||0);
    });
    bases.push(base);
    if(base <= 0 || typeof calcTax!=='function'){ rates.push(0); return; }
    const before = calcTax(base, fy);
    const after  = calcTax(Math.max(0, base - 1000), fy);
    rates.push((before - after)/1000);
  });
  if(bases.every(b=>b<=0)) return 0.32;
  return rates.reduce((s,r)=>s+r,0) / Math.max(1, rates.length);
}

function drFyProgress(fy){
  const start = new Date((fy-1)+'-07-01T00:00:00');
  const end   = new Date(fy+'-06-30T23:59:59');
  const now   = new Date();
  if(isNaN(start) || isNaN(end)) return 1;
  if(now <= start) return 0;
  if(now >= end) return 1;
  return (now - start)/(end - start);
}

function drInvSplits(p){
  return normaliseSplits(p||{}).filter(sp=>(sp.purpose||'rental')==='investment');
}

function drSplitStart(sp){
  return sp && sp.startDate ? String(sp.startDate).slice(0,10) : '';
}

// Financial years covered by the strategy. The investment split's Start Date
// is the only source of truth: without it there is no honest way to claim a
// prior FY, so the report starts at the current FY (or the earliest manually
// entered DR History year) instead of inventing history from loan balances.
function drFyRange(p, curFY){
  let startFY = null;
  drInvSplits(p).forEach(sp=>{
    const ss = drSplitStart(sp);
    if(!ss) return;
    const fy = dateToFY(ss);
    if(isFinite(fy)) startFY = startFY==null ? fy : Math.min(startFY, fy);
  });
  if(startFY==null && p.drHistory){
    const ks = Object.keys(p.drHistory).map(Number).filter(Number.isFinite);
    if(ks.length) startFY = Math.min(...ks);
  }
  if(startFY==null) startFY = curFY;
  startFY = Math.min(startFY, curFY);
  const from = Math.max(startFY, curFY - 29);
  const out = [];
  for(let y=from; y<=curFY; y++) out.push(y);
  return out;
}

function drDayCount(a, b){
  if(!a || !b) return 0;
  const ms = new Date(b+'T00:00:00') - new Date(a+'T00:00:00');
  return isFinite(ms) ? Math.round(ms/86400000) + 1 : 0;
}

// Active part of a split within one FY: later of (FY start, split start,
// purchase) → earlier of (FY end, split close, today). A split opened in
// March 2026 therefore only ever accrues interest from March 2026.
function drSplitWindow(sp, fy, p, curFY, todayStr){
  const fyStart = (fy-1)+'-07-01', fyEnd = fy+'-06-30';
  let from = fyStart, to = fyEnd;
  const ss = drSplitStart(sp);
  if(ss && ss > from) from = ss;
  const pd = p && p.purchaseDate ? String(p.purchaseDate).slice(0,10) : '';
  if(pd && pd > from) from = pd;
  const se = sp && sp.endDate ? String(sp.endDate).slice(0,10) : '';
  if(se && se < to) to = se;
  if(fy === curFY && todayStr < to) to = todayStr;
  if(to < from) return null;
  const days = drDayCount(from, to);
  const fyDays = drDayCount(fyStart, fyEnd);
  return { from, to, days, frac: fyDays>0 ? Math.min(1, days/fyDays) : 1,
           startedThisFy: !!(ss && ss >= fyStart) };
}

// Opening / closing net balances for a split in a FY. Opening comes from the
// split's Opening Balance (first year) or the previous 30 June snapshot;
// closing comes from this 30 June snapshot, today's balance in the current FY,
// or the opening balance for a past year with no snapshot (never today's
// already-paid-down balance, which would understate old interest).
function drSplitBalances(sp, fy, win, curFY){
  const snaps = sp.balances || {};
  const snap = snaps[fy] || {}, prev = snaps[fy-1] || {};
  const curBal = +sp.balance||0;
  const openFallback = (sp.openBalance!=null && isFinite(+sp.openBalance)) ? +sp.openBalance : curBal;
  const openBal = win.startedThisFy ? openFallback : (prev.balance!=null ? +prev.balance : openFallback);
  const openOff = win.startedThisFy ? (+sp.offset||0) : (prev.offset!=null ? +prev.offset : (+sp.offset||0));
  const closeBal = snap.balance!=null ? +snap.balance : (fy===curFY ? curBal : openBal);
  const closeOff = snap.offset!=null ? +snap.offset : (fy===curFY ? (+sp.offset||0) : openOff);
  return {
    open:  Math.max(0, openBal),
    close: Math.max(0, closeBal),
    openNet:  Math.max(0, openBal  - openOff),
    closeNet: Math.max(0, closeBal - closeOff)
  };
}

function buildDRFYData(p, opts){
  opts = opts || {};
  const m = propMetrics(p);
  const curFY = dateToFY(localDateStr());
  const today = localDateStr();
  const syms = drSymbolsSet(p);
  const invSplits = drInvSplits(p);
  let disposals = opts.disposals;
  if(!disposals){
    try{ disposals = (typeof buildDisposals==='function' ? (buildDisposals().disposals||[]) : []); }
    catch(e){ disposals = []; }
  }
  let fys = drFyRange(p, curFY);
  if(opts.onlyFY) fys = [opts.onlyFY];

  const includeUnreal = opts.includeUnrealised != null
    ? !!opts.includeUnrealised
    : (localStorage.getItem('pt_dr_show_unreal') !== '0');
  const owner = p.owner || 'lumia';
  const missingDates = invSplits.filter(sp=>!drSplitStart(sp)).length;

  const rows = [];
  fys.forEach(fy=>{
    const hist = (p.drHistory && (p.drHistory[fy] || p.drHistory[String(fy)])) || {};
    const isCur = fy === curFY;
    const balManual = hist.balance!=null && isFinite(+hist.balance);
    const intManual = hist.interest!=null && isFinite(+hist.interest);

    let sumAvg = 0, sumInterest = 0, weightRate = 0, weightBal = 0;
    let frac = 0, activeSplits = 0, windowFrom = '', windowTo = '';
    invSplits.forEach(sp=>{
      const win = drSplitWindow(sp, fy, p, curFY, today);
      if(!win) return;
      activeSplits++;
      frac = Math.max(frac, win.frac);
      if(!windowFrom || win.from < windowFrom) windowFrom = win.from;
      if(!windowTo   || win.to   > windowTo)   windowTo   = win.to;
      const b = drSplitBalances(sp, fy, win, curFY);
      const avg = (b.openNet + b.closeNet) / 2;
      const rate = +sp.rate || 0;
      sumAvg += avg;
      sumInterest += avg * (rate/100) * (win.days/365);
      weightRate += avg * rate;
      weightBal += avg;
    });
    // A year where the split didn't exist yet (or was already closed) has no
    // performance to report — don't emit a row just to show zeroes.
    if(!activeSplits && !balManual && !intManual) return;
    // A manual-only year (no investment split on record) still counts as a
    // full year — otherwise it would be labelled a 1-month part-year.
    if(!activeSplits) frac = 1;

    const avgDebt = balManual ? Math.max(0, +hist.balance) : sumAvg;
    const interest = intManual ? Math.max(0, +hist.interest) : sumInterest;
    const partial = frac < 0.999;
    const daysActive = (windowFrom && windowTo) ? drDayCount(windowFrom, windowTo) : 0;
    const months = daysActive > 0 ? Math.max(1, Math.round(daysActive/30.44)) : 0;
    const progress = isCur ? drFyProgress(fy) : 1;

    // First FY of recycling (March–June) must only count dividends, sales and
    // growth from the split's start date, not the whole financial year.
    const fyWindowStart = (fy-1)+'-07-01';
    const rowStart = (windowFrom && windowFrom > fyWindowStart && windowFrom <= fy+'-06-30')
      ? windowFrom : fyWindowStart;
    const rowEnd = isCur ? today : fy+'-06-30';
    // A year opens on the previous year's close, not the next day. Asking for
    // 1 July let the snapshot lookup resolve to a different price date, so
    // FY2026's closing value and FY2027's opening value were the same instant
    // measured two ways — and the gap between them was counted in neither
    // year, inflating the total above the panel's figure.
    const valStart = (rowStart === fyWindowStart) ? ((fy-1)+'-06-30') : rowStart;

    const div = drDividendMap(p, rowStart, rowEnd)[fy] || { cash:0, frank:0 };
    const realised = +drRealisedMap(p, disposals, rowStart, rowEnd)[fy] || 0;

    let growth = realised;
    let unrealised = 0;
    let growthComplete = true;
    if(includeUnreal && syms.size){
      const sv = drValueAt(valStart, syms);
      const ev = drValueAt(rowEnd, syms);
      // Cost base has to be read on the same date the valuation used, not the
      // row boundary: the price snapshot can precede a purchase, and pairing a
      // stale valuation with a fresh cost base would invent a loss.
      const cb0 = drCostBaseAt(sv.date || valStart, syms);
      const cb1 = drCostBaseAt(ev.date || rowEnd, syms);
      // Current FY must land exactly on the panel's figure, so reuse the
      // panel's own computation for today's endpoint.
      const u1 = isCur ? drUnrealisedNow(syms)
        : (ev.value==null || cb1==null ? null : ev.value - cb1);
      const u0 = (sv.value==null || cb0==null) ? null : sv.value - cb0;
      // Today's endpoint comes from live prices rather than a snapshot, so its
      // own completeness flag is already accounted for inside drUnrealisedNow.
      const endOk = isCur ? u1!=null : (u1!=null && ev.complete);
      if(u0==null || !endOk || !sv.complete){
        growth = realised;
        unrealised = 0;
        growthComplete = false;
      } else {
        // Broker basis: unrealised gain (value − CGT cost base) at each end of
        // the year; the year's capital gain is the movement between them. That
        // is what the DR panel and the broker show, so the totals agree.
        unrealised = u1 - u0;
        growth = unrealised;
      }
    } else if(!syms.size){
      growth = 0;
      unrealised = 0;
    }

    let taxRate;
    if(hist.taxRate!=null && isFinite(+hist.taxRate)) taxRate = Math.max(0, +hist.taxRate)/100;
    else taxRate = drMarginalRate(fy, owner);

    const benchRate = weightBal > 0 ? (weightRate/weightBal)/100 : (m.wtRate/100);
    // Income is the cash the broker actually credits — the amount the DRP
    // reinvests into new units. Franking credits are a tax offset, not cash,
    // so they stay in the Dividends/Tax tabs rather than inflating this column.
    const incomeCash = div.cash;
    // Dividend tax. The cash dividend and its franking credit are taxed
    // together, then the credit is applied as an offset:
    //   (D + F) × rate − F
    // Above a 30% rate that is a cost; at 30% it is exactly neutral; below 30%
    // it goes negative, i.e. the excess credit comes back as a refund. One
    // expression, no special case for the rate falling. Income (Cash) and
    // Capital Gain stay pre-tax so the row still ties to the DR panel.
    const divTax = (incomeCash + (div.frank||0)) * taxRate - (div.frank||0);
    const netPreTax = incomeCash + growth - interest;
    const taxShield = interest * taxRate;
    const netAfterTax = netPreTax + taxShield - divTax;
    const returnPct = avgDebt > 0 ? (netAfterTax/avgDebt)*100 : null;
    // The hurdle is the after-tax cost of the debt actually booked, not the
    // headline rate pro-rated over the window. Splits with staggered start
    // dates make those two differ: frac tracks the longest window, while
    // interest tracks each split's own days, which overstated the hurdle.
    const benchmarkPct = avgDebt > 0 ? ((interest * (1 - taxRate)) / avgDebt) * 100 : 0;

    let source;
    if(!balManual && !intManual) source = 'estimated';
    else if(balManual && intManual) source = hist.source || 'manual';
    else source = 'mixed';

    rows.push({
      fy, avgDebt, interest,
      divCash: div.cash, frank: div.frank, incomeCash,
      realised, unrealised, growth,
      netPreTax, taxRate, taxShield, divTax, netAfterTax,
      returnPct, benchmarkPct, ratePct: benchRate * 100,
      source, growthComplete, isCur, progress,
      partial, frac, months, daysActive, activeSplits,
      windowFrom, windowTo,
      balManual, intManual
    });
  });

  const first = rows.length ? rows[0].fy : curFY;
  return {
    rows,
    meta: {
      propId: p.id, propName: p.name, owner,
      drRate: rows.length ? (rows[rows.length-1].ratePct/100) : 0,
      syms: [...syms],
      curFY, startFY: first,
      missingSplitDates: missingDates
    }
  };
}

function buildDRCombinedRows(drProps){
  let disposals = null;
  try{ disposals = (typeof buildDisposals==='function' ? (buildDisposals().disposals||[]) : []); }
  catch(e){ disposals = []; }
  const byFY = {};
  (drProps||[]).forEach(p=>{
    let data;
    try{ data = buildDRFYData(p, { disposals }); }
    catch(e){ console.warn('DR performance build failed:', p && p.id, e); return; }
    data.rows.forEach(r=>{
      if(!byFY[r.fy]) byFY[r.fy] = {
        fy:r.fy, avgDebt:0, interest:0, divCash:0, frank:0,
        realised:0, unrealised:0, growth:0, netPreTax:0,
        taxShield:0, netAfterTax:0,
        incomeCash:0, taxRateWeighted:0, taxRateDebt:0,
        growthComplete:true, isCur:false, progress:1, sources:{},
        partial:false, months:0, daysActive:0, winFrom:'', winTo:''
      };
      const o = byFY[r.fy];
      o.avgDebt += +r.avgDebt||0;
      o.interest += +r.interest||0;
      o.divCash += +r.divCash||0;
      o.frank += +r.frank||0;
      o.realised += +r.realised||0;
      o.unrealised += +r.unrealised||0;
      o.growth += +r.growth||0;
      o.netPreTax += +r.netPreTax||0;
      o.taxShield += +r.taxShield||0;
      o.netAfterTax += +r.netAfterTax||0;
      o.taxRateWeighted += (+r.taxRate||0)*(+r.avgDebt||0);
      o.taxRateDebt += +r.avgDebt||0;
      if(!r.growthComplete) o.growthComplete = false;
      o.isCur = o.isCur || !!r.isCur;
      if(r.isCur) o.progress = r.progress;
      if(r.partial) o.partial = true;
      o.months = Math.max(+o.months||0, +r.months||0);
      // Union of the active windows, so a combined part-year is labelled with
      // the whole span (not whichever property happens to be longest).
      if(r.windowFrom && (!o.winFrom || r.windowFrom < o.winFrom)) o.winFrom = r.windowFrom;
      if(r.windowTo   && (!o.winTo   || r.windowTo   > o.winTo))   o.winTo   = r.windowTo;
      o.sources[r.source] = (o.sources[r.source]||0)+1;
    });
  });
  // Income and capital growth are asset-level, not debt-level: if two DR
  // properties link the same symbol, summing their per-property rows would
  // count that stock's dividends and growth twice. Recompute those two lines
  // once from the union of every linked symbol, then keep the summed debt,
  // interest and tax shields.
  const unionSyms = [...new Set((drProps||[]).flatMap(p=>(p.drSymbols||[]).map(s=>String(s).toUpperCase())))];
  const unionStart = (drProps||[])
    .flatMap(p=>drInvSplits(p).map(sp=>drSplitStart(sp)))
    .filter(Boolean).sort()[0] || '';
  const unionProp = {
    id:'__dr_union', name:'Combined', owner:'joint',
    drSymbols: unionSyms,
    splits: unionStart ? [{ id:'sp_union', purpose:'investment', startDate: unionStart, rate:0 }] : [],
    purchaseDate: (drProps||[]).map(p=>p.purchaseDate).filter(Boolean).sort()[0] || ''
  };
  const unionByFY = {};
  if(unionSyms.length){
    Object.values(byFY).forEach(o=>{
      try{
        const u = buildDRFYData(unionProp, { disposals, onlyFY:o.fy });
        const ur = u.rows[0];
        if(ur) unionByFY[o.fy] = ur;
      }catch(e){}
    });
  }

  const rows = Object.values(byFY).sort((a,b)=>a.fy-b.fy).map(o=>{
    const keys = Object.keys(o.sources);
    let source = 'estimated';
    if(keys.length === 1) source = keys[0];
    else if(keys.some(k=>k==='manual' || k==='auto')) source = 'mixed';
    const ur = unionByFY[o.fy];
    if(ur){
      o.divCash = ur.divCash;
      o.frank = ur.frank;
      o.realised = ur.realised;
      o.unrealised = ur.unrealised;
      o.growth = ur.growth;
      o.growthComplete = ur.growthComplete;
    }
    // Cash income needs no tax adjustment, so it is simply the union's
    // dividends — the same figure the Debt Recycling card's Total Gain uses.
    o.incomeCash = o.divCash;
    o.netPreTax = o.incomeCash + o.growth - o.interest;
    // Still needed for the breakeven: the union row blends the owners' rates,
    // and without one the debt-weighted rate is the fallback.
    if(o.taxRate == null){
      o.taxRate = (ur && ur.taxRate != null) ? ur.taxRate
        : (o.taxRateDebt > 0 ? o.taxRateWeighted/o.taxRateDebt : 0);
    }
    // Dividend tax needs the rate settled first. This row carries one blended
    // rate, so if the owners are on different rates it is an estimate; the
    // per-property view applies each owner's own rate exactly.
    o.divTax = (o.incomeCash + (o.frank||0)) * o.taxRate - (o.frank||0);
    o.netAfterTax = o.netPreTax + o.taxShield - o.divTax;
    const daysActive = (o.winFrom && o.winTo) ? drDayCount(o.winFrom, o.winTo) : 0;
    return {
      ...o,
      daysActive,
      months: daysActive > 0 ? Math.max(1, Math.round(daysActive/30.44)) : 0,
      returnPct: o.avgDebt>0 ? (o.netAfterTax/o.avgDebt)*100 : null,
      // Same rule as the per-property rows: the after-tax cost of the debt
      // actually booked, so the two views can't diverge.
      benchmarkPct: o.avgDebt>0 ? ((o.interest * (1 - o.taxRate)) / o.avgDebt) * 100 : 0,
      source
    };
  });
  return {
    rows,
    meta: { combined:true, propCount:(drProps||[]).length, curFY: dateToFY(localDateStr()) }
  };
}

let __drPerfCache = { sig:'', scopes:{} };
function invalidateDRPerfCache(){ __drPerfCache = { sig:'', scopes:{} }; }

function drSigHash(str){
  let h = 0;
  str = String(str||'');
  for(let i=0;i<str.length;i++){ h = (h*31 + str.charCodeAt(i)) | 0; }
  return h;
}

function drPerfSignature(){
  try{
    const propsSig = (typeof properties!=='undefined' ? properties : []).map(p=>[
      p.id, p.debtRecycling, p.drHistory, p.drSymbols, p.owner,
      p.currentValue, p.purchaseDate, p.sold, p.soldDate, p.fyDebtData, p.splits
    ]);
    const syms = new Set();
    (typeof properties!=='undefined' ? properties : []).forEach(p=>(p.drSymbols||[]).forEach(s=>syms.add(String(s).toUpperCase())));
    const px = [...syms].map(s=>{
      let key = s;
      try{ if(typeof priceSymbol==='function') key = priceSymbol(s); }catch(e){}
      const v = (typeof prices!=='undefined' && prices) ? (prices[key] ?? prices[s] ?? '') : '';
      return s+':'+v;
    }).join(',');
    const tradeSig = (typeof trades!=='undefined' ? trades : [])
      .map(t=>[t.id,t.date,t.symbol,t.type,t.units,t.price,t.fees].join('|')).join(';');
    const divSig = (typeof dividends!=='undefined' ? dividends : [])
      .map(d=>[d.id,d.date,d.symbol,d.amount,d.frankingPct,d.type].join('|')).join(';');
    return JSON.stringify(propsSig)
      + '|' + drSigHash(tradeSig)
      + '|' + drSigHash(divSig)
      + '|' + Object.keys((typeof pfSnapshots!=='undefined' && pfSnapshots) || {}).length
      + '|' + px;
  }catch(e){ return 'err'+Date.now(); }
}

function getDRDataForScope(scope){
  const sig = drPerfSignature();
  if(__drPerfCache.sig !== sig) __drPerfCache = { sig, scopes:{} };
  const key = scope || '__combined';
  if(!__drPerfCache.scopes[key]){
    if(scope){
      const p = (typeof properties!=='undefined' ? properties : []).find(x=>x.id===scope);
      __drPerfCache.scopes[key] = p ? buildDRFYData(p) : { rows:[], meta:{} };
    } else {
      const drProps = (typeof properties!=='undefined' ? properties : []).filter(p=>p.propType==='ppor' && p.debtRecycling);
      __drPerfCache.scopes[key] = buildDRCombinedRows(drProps);
    }
  }
  return __drPerfCache.scopes[key];
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
    {l:'Total Loan Balance',  v:n2(m.loanCur),             c:'debt-red'},
    {l:'Effective Loan',      v:n2(m.effectiveLoan),        c:'debt-brick'},
    {l:'Wtd Avg Rate',        v:m.wtRate.toFixed(2)+'%',   c:'neu'},
    {l:'Monthly Interest',    v:n2(m.monthlyInterest),     c:'neg'},
    {l:'Offset Savings/mo',   v:n2(m.interestSaved),       c:'pos'},
    {l:'Est. Total Repayment',v:n2(m.repay),               c:'debt-coral'},
    {l:'Gross Yield',         v:m.grossYield.toFixed(2)+'%',c:m.grossYield>0?'pos':'neu'},
    {l:'Net Yield',           v:m.netYield.toFixed(2)+'%', c:clr(m.netYield)},
  ];
  $('prop-preview-grid').innerHTML = items.map(i=>
    `<div><div style="color:var(--text3);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px">${i.l}</div>
     <div class="${i.c}" style="font-size:14px;font-weight:600">${i.v}</div></div>`
  ).join('');
}

// Regenerates the "Historical Value, Loan Remaining & Offset Balance at 30
// June" input rows in the property form based on the entered purchase date —
// only years since purchase make sense to ask about, so this is
// per-property, unlike Super's fixed 2016+ range (which isn't tied to any
// one instrument's start date). Called on pf-pdate change and when opening
// the edit form. Loan Remaining and Offset Balance are both optional per
// year — manual fallbacks for whatever checkPropertyFYRollover() hasn't
// auto-captured yet (or years before that feature existed), letting Net
// Worth's annual snapshot show Property (gross), Loan Remaining, and Cash
// (from offset balances) as separate figures for that year.
function updatePropFormFYFields(){
  const wrap = $('pf-fy-fields');
  if(!wrap) return;
  const dateVal = $('pf-pdate') ? $('pf-pdate').value : '';
  const _n = new Date();
  const CUR_FY  = _n.getMonth() >= 6 ? _n.getFullYear()+1 : _n.getFullYear();
  const PREV_FY = CUR_FY - 1;
  if(!dateVal){
    wrap.innerHTML = '<div style="font-size:11px;color:var(--text3)">Enter a purchase date above to add historical 30-June values.</div>';
    return;
  }
  const startYear = (typeof dateToFY === 'function') ? dateToFY(dateVal) : +dateVal.slice(0,4);
  if(startYear > PREV_FY){
    wrap.innerHTML = '<div style="font-size:11px;color:var(--text3)">No 30 June has passed since this purchase date yet.</div>';
    return;
  }
  let html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'+
    '<span style="width:54px;flex-shrink:0"></span>'+
    '<span style="flex:1;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Value</span>'+
    '<span style="flex:1;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Loan Remaining</span>'+
    '<span style="flex:1;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Offset Balance</span></div>';
  for(let y = startYear; y <= PREV_FY; y++){
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'+
      '<label style="font-family:var(--mono);font-size:11px;color:var(--text3);width:54px;flex-shrink:0">FY'+y+'</label>'+
      '<input class="fi pf-fy-input" data-fy="'+y+'" type="number" placeholder="0" step="any" min="0" style="flex:1;padding:4px 8px">'+
      '<input class="fi pf-fy-debt-input" data-fy="'+y+'" type="number" placeholder="0" step="any" min="0" style="flex:1;padding:4px 8px">'+
      '<input class="fi pf-fy-offset-input" data-fy="'+y+'" type="number" placeholder="0" step="any" min="0" style="flex:1;padding:4px 8px"></div>';
  }
  wrap.innerHTML = html;
}

// Reads the currently-visible pf-fy-debt-input rows and merges them onto
// existingFyDebtData — same "blank clears that year" semantics as
// readPropFormFYData, and same "years outside the visible range are left
// untouched" behaviour so an auto-captured checkPropertyFYRollover() entry
// for a year not currently shown never gets wiped by an unrelated save.
// Unlike the value field, an explicit 0 IS kept (a fully paid-off loan is
// a real, meaningful balance) — only a genuinely blank box clears the year.
function readPropFormFYDebtData(existingFyDebtData){
  const result = Object.assign({}, existingFyDebtData||{});
  document.querySelectorAll('#pf-fy-fields .pf-fy-debt-input').forEach(inp=>{
    const yr = +inp.dataset.fy;
    const v = parseFloat(inp.value);
    if(!isNaN(v) && v>=0) result[yr] = v; else delete result[yr];
  });
  return result;
}

// Same merge/clear semantics as readPropFormFYDebtData (explicit 0 is a
// real, kept value — an offset account can genuinely sit at $0). This is
// the manual fallback for whatever checkPropertyFYRollover() hasn't
// auto-captured from the splits' current offset balances yet.
function readPropFormFYOffsetData(existingFyOffsetData){
  const result = Object.assign({}, existingFyOffsetData||{});
  document.querySelectorAll('#pf-fy-fields .pf-fy-offset-input').forEach(inp=>{
    const yr = +inp.dataset.fy;
    const v = parseFloat(inp.value);
    if(!isNaN(v) && v>=0) result[yr] = v; else delete result[yr];
  });
  return result;
}

// Reads the currently-visible pf-fy-input rows and merges them onto
// existingFyData — a blank field clears that year (deliberate, since the
// form is always pre-filled from existing data when editing, so an empty
// box means "remove this"), while any year NOT currently shown (outside
// the purchase-date-to-PREV_FY range, e.g. one written by
// checkPropertyFYRollover) is left untouched rather than wiped out.
function readPropFormFYData(existingFyData){
  const result = Object.assign({}, existingFyData||{});
  document.querySelectorAll('#pf-fy-fields .pf-fy-input').forEach(inp=>{
    const yr = +inp.dataset.fy;
    const v = parseFloat(inp.value);
    if(!isNaN(v) && v>0) result[yr] = v; else delete result[yr];
  });
  return result;
}

function readPropForm(){
  const splits = [];
  document.querySelectorAll('#pf-splits-wrap .split-row').forEach(row=>{
    let balances = {};
    try{ balances = JSON.parse(row.dataset.balances||'{}') || {}; }catch(e){ balances = {}; }
    splits.push({
      id:      row.dataset.splitId || ('sp_'+uid()),
      label:   row.querySelector('.sp-label').value.trim()||'Split',
      initial: parseFloat(row.querySelector('.sp-initial').value)||0,
      balance: parseFloat(row.querySelector('.sp-balance').value)||0,
      startDate: row.querySelector('.sp-start')?.value || '',
      openBalance: (()=>{ const v=row.querySelector('.sp-open')?.value; return v!==''&&v!=null&&isFinite(parseFloat(v))?parseFloat(v):null; })(),
      endDate:  row.querySelector('.sp-end')?.value || '',
      balances,
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
    estSellCostPct: parseFloat($('pf-estsell')?.value)||0,
    mainResExempt: $('pf-mainres')?.checked || false,
    debtRecycling: ($('pf-type').value==='ppor' && $('pf-dr')?.checked) || false,
    drSymbols:     (()=>{ try{ return JSON.parse($('pf-dr-symbols')?.dataset.selected||'[]'); }catch(e){ return []; } })(),
  };
}

function saveProperty(){
  const p = readPropForm();
  if(!p.name){ notify('Enter a property name/address.','err'); return; }
  if(!p.purchasePrice){ notify('Enter purchase price.','err'); return; }

  if(p.id){
    const idx = properties.findIndex(x=>x.id===p.id);
    if(idx>=0){
      p.fyData = readPropFormFYData(properties[idx].fyData); // merge, don't clobber years outside the visible range
      p.fyDebtData = readPropFormFYDebtData(properties[idx].fyDebtData);
      p.fyOffsetData = readPropFormFYOffsetData(properties[idx].fyOffsetData);
      p.drHistory = readPropFormDRHistory(properties[idx].drHistory);
      p.id=properties[idx].id; properties[idx]=p;
    }
  } else {
    p.fyData = readPropFormFYData(null);
    p.fyDebtData = readPropFormFYDebtData(null);
    p.fyOffsetData = readPropFormFYOffsetData(null);
    p.drHistory = readPropFormDRHistory(null);
    p.id = 'prop_'+uid();
    properties.push(p);
  }
  saveProps();
  invalidateDRPerfCache();
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
  skipped[divId] = { symbol:sym, date, skippedAt:localDateStr(), reason: reason||'manual' };
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
  skipped[dvChkKey(r)] = { symbol:r.symbol, date:r.date, perUnit:r.perUnit, skippedAt:localDateStr() };
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

// Calculation notes in the Debt Recycling FY Performance popup. Local rather
// than via toggleSection so the block always starts collapsed, however long
// the popup has been open before.
function toggleDRPerfNotes(){
  const body = $('dr-notes-body');
  const tog  = $('dr-notes-toggle');
  if(!body) return;
  const open = body.style.display === 'none';
  body.style.display = open ? '' : 'none';
  if(tog){
    tog.textContent = open ? '−' : '+';
    tog.style.color = open ? 'var(--blue)' : 'var(--text3)';
  }
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

// ── DEBT RECYCLING — form UI ────────────────────────────────────────────
function togglePropDRVisibility(){
  const wrap = $('pf-dr-wrap');
  if(!wrap) return;
  const isPpor = $('pf-type').value === 'ppor';
  wrap.style.display = isPpor ? '' : 'none';
  if(!isPpor && $('pf-dr')){
    // Debt recycling only applies to the PPOR — clear it for other types
    $('pf-dr').checked = false;
    togglePropDRFields();
  }
}
function togglePropDRFields(){
  const box = $('pf-dr'), fields = $('pf-dr-fields');
  if(!box || !fields) return;
  fields.style.display = box.checked ? '' : 'none';
  if(box.checked){ renderDRSymbolChips(); renderDRHistoryRows(); }
}
function renderDRSymbolChips(selectedSyms){
  const wrap = $('pf-dr-symbols');
  if(!wrap) return;
  const selected = selectedSyms
    ? [...new Set(selectedSyms.map(s=>s.toUpperCase()))]
    : JSON.parse(wrap.dataset.selected||'[]');
  wrap.dataset.selected = JSON.stringify(selected);
  // Keep broker-suffixed symbols (DHHF:AU vs DHHF:CMC) distinct — they're
  // separate parcels, often with different owners, not the same holding.
  const heldSyms = [...new Set(calcH().filter(h=>h.units>0.00000001).map(h=>h.symbol.toUpperCase()))].sort();
  if(!heldSyms.length){
    wrap.innerHTML = '<div style="font-size:11px;color:var(--text3)">No current holdings found — add trades first.</div>';
    return;
  }
  wrap.innerHTML = heldSyms.map(sym=>{
    const owner = getSymbolOwner(sym);
    const oc = getPersonColour(owner);
    const active = selected.includes(sym);
    return `<span class="ca-pill${active?' active':''}" style="font-family:var(--mono);display:inline-flex;align-items:center;gap:5px" onclick="toggleDRSymbol('${sym}')">
      ${plainSymbol(sym)}
      <span style="width:7px;height:7px;border-radius:50%;background:${oc};box-shadow:0 0 4px ${oc}" title="${getPersonLabel(owner)}"></span>
    </span>`;
  }).join('');
}
function toggleDRSymbol(sym){
  const wrap = $('pf-dr-symbols');
  if(!wrap) return;
  let selected = JSON.parse(wrap.dataset.selected||'[]');
  selected = selected.includes(sym) ? selected.filter(s=>s!==sym) : [...selected, sym];
  renderDRSymbolChips(selected);
  calcPropPreview();
}

// ── DEBT RECYCLING — per-FY history form ───────────────────────────────
// The FY performance view needs two figures the app never stored historically:
// the average DR loan balance and the interest actually paid. Both are
// optional — blank cells fall back to an estimate built from the property's
// total loan history and the current investment-loan rate.
function drFormInvStartDates(){
  const out = [];
  document.querySelectorAll('#pf-splits-wrap .split-row').forEach(row=>{
    const purpose = (row.querySelector('.sp-purpose')||{value:'rental'}).value;
    if(purpose!=='investment') return;
    const v = row.querySelector('.sp-start')?.value || '';
    if(v) out.push(String(v).slice(0,10));
  });
  return out.filter(Boolean).sort();
}

function renderDRHistoryRows(){
  const wrap = $('pf-dr-history-wrap');
  if(!wrap) return;
  const _n = new Date();
  const CUR_FY = _n.getMonth() >= 6 ? _n.getFullYear()+1 : _n.getFullYear();
  const PREV_FY = CUR_FY - 1;
  // The investment split's Start Date is the only anchor. Without it there is
  // no honest FY to show, so ask for the date rather than guessing from the
  // purchase date.
  const starts = drFormInvStartDates();
  if(!starts.length){
    wrap.innerHTML = '<div style="font-size:11px;color:var(--text3)">Set a <b>Start Date</b> on an investment-purpose loan split above to enter per-FY history.</div>';
    return;
  }
  const startVal = starts[0];
  const startFY = (typeof dateToFY==='function') ? dateToFY(startVal) : +String(startVal).slice(0,4);
  if(startFY > PREV_FY){
    wrap.innerHTML = '<div style="font-size:11px;color:var(--text3)">No completed financial year yet.</div>';
    return;
  }
  let existing = {};
  try{ existing = JSON.parse(wrap.dataset.history||'{}') || {}; }catch(e){ existing = {}; }
  let html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'+
    '<span style="width:50px;flex-shrink:0"></span>'+
    '<span style="flex:1;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Avg DR debt</span>'+
    '<span style="flex:1;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Interest paid</span>'+
    '<span style="flex:1;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Tax rate %</span></div>';
  const maxRows = 15;
  const from = Math.max(startFY, PREV_FY - maxRows + 1);
  for(let y = from; y <= PREV_FY; y++){
    const h = existing[y] || existing[String(y)] || {};
    // Mark the split's first FY when it began part-way through the year, so
    // the statement figures are understood as a part-year amount.
    let partTag = '';
    if(y === startFY && startVal > (y-1)+'-07-01'){
      const days = drDayCount((y-1)+'-07-01', y+'-06-30');
      const active = drDayCount(startVal, y+'-06-30');
      if(days>0 && active>0 && active<days) partTag = ' <span style="font-size:9px;color:var(--text3)">'+(active<45 ? active+'d' : Math.max(1, Math.round(active/30.44))+'mo')+'</span>';
    }
    html += '<div class="dr-hist-row" data-fy="'+y+'" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'+
      '<label style="font-family:var(--mono);font-size:11px;color:var(--text3);width:50px;flex-shrink:0">FY'+y+partTag+'</label>'+
      '<input class="fi dr-hist-balance" type="number" placeholder="auto" step="any" min="0" style="flex:1;min-width:0;padding:4px 8px" value="'+(h.balance!=null?h.balance:'')+'">'+
      '<input class="fi dr-hist-interest" type="number" placeholder="auto" step="any" min="0" style="flex:1;min-width:0;padding:4px 8px" value="'+(h.interest!=null?h.interest:'')+'">'+
      '<input class="fi dr-hist-rate" type="number" placeholder="auto" step="any" min="0" max="60" style="flex:1;min-width:0;padding:4px 8px" value="'+(h.taxRate!=null?h.taxRate:'')+'"></div>';
  }
  wrap.innerHTML = html;
}

// Merge the visible history rows over the stored map. A completely blank row
// removes that FY's override (so it falls back to the estimate), while years
// outside the visible range are kept untouched.
function readPropFormDRHistory(existing){
  const base = (existing && typeof existing==='object') ? {...existing} : {};
  const wrap = $('pf-dr-history-wrap');
  if(!wrap || !$('pf-dr')?.checked) return base;
  wrap.querySelectorAll('.dr-hist-row').forEach(row=>{
    const fy = String(row.dataset.fy);
    const balEl = row.querySelector('.dr-hist-balance');
    const intEl = row.querySelector('.dr-hist-interest');
    const rateEl= row.querySelector('.dr-hist-rate');
    const bal = balEl && balEl.value.trim()!=='' ? parseFloat(balEl.value) : null;
    const int = intEl && intEl.value.trim()!=='' ? parseFloat(intEl.value) : null;
    const rate= rateEl && rateEl.value.trim()!=='' ? parseFloat(rateEl.value) : null;
    if(bal==null && int==null && rate==null){ delete base[fy]; return; }
    const nbal = bal!=null && isFinite(bal) ? bal : null;
    const nint = int!=null && isFinite(int) ? int : null;
    const nrate= rate!=null && isFinite(rate) ? rate : null;
    // Opening the edit form prefills auto-captured values. Saving without
    // touching them must not relabel that year EXACT — only a real change
    // makes it a manual override.
    const prev = (existing && existing[fy]) || {};
    const same = (prev.balance ?? null) === nbal && (prev.interest ?? null) === nint && (prev.taxRate ?? null) === nrate
      && (prev.balance != null || prev.interest != null || prev.taxRate != null);
    base[fy] = {
      balance: nbal,
      interest: nint,
      taxRate: nrate,
      source: same ? (prev.source || 'manual') : 'manual'
    };
  });
  return base;
}

// ── DEBT RECYCLING — Total Investment breakdown popup ─────────────────
function showDRTotalBreakdown(propId){
  const t = (window.__drBreakdown||{})[propId];
  if(!t){ notify('Breakdown not available — re-open Property tab.','err'); return; }
  if(document.getElementById('dr-total-popup')){ closeHudPopup('dr-total-popup'); return; }

  const html = `
    <div data-hud-header style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:14px;font-weight:700;color:var(--text)">Total Investment — ${escHtml(t.propName)}</div>
      <button onclick="closeHudPopup('dr-total-popup')"
        style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px;line-height:1">✕</button>
    </div>
    <div style="display:flex;flex-direction:column">
      <details style="border-bottom:1px solid var(--border);padding:5px 0">
        <summary style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;color:var(--text2);font-weight:600">
          <span>Invested Amount</span>
          <span style="color:var(--text);font-weight:600">${n2(t.invested)}</span>
        </summary>
        <div style="padding:6px 0 2px 14px;display:flex;flex-direction:column;gap:3px">
          <div style="display:flex;justify-content:space-between;color:var(--text2)">
            <span>Buy Orders</span><span style="color:var(--text)">${n2(t.buyOnly)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;color:var(--text2)">
            <span>DRP Orders</span><span style="color:var(--text)">${n2(t.drpAmount)}</span>
          </div>
        </div>
      </details>
      <div style="display:flex;justify-content:space-between;border-bottom:2px solid var(--border2);padding:5px 0">
        <span style="color:var(--text2)">Capital Gain <span style="color:var(--text3)">(unrealised, lifetime, buy+DRP units)</span></span>
        <span style="color:${t.capitalGain>=0?'var(--green)':'var(--red)'}">${n2(t.capitalGain)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-weight:700">
        <span style="color:var(--text)">Total Investment</span>
        <span style="color:var(--text)">${n2(t.total)}</span>
      </div>
      <div style="padding:10px 0 5px;color:var(--text3);font-size:10px;letter-spacing:.06em;text-transform:uppercase">Not included in total</div>
      <div style="display:flex;justify-content:space-between;background:var(--gold-dim);padding:5px 8px;border-radius:4px">
        <span style="color:var(--gold)">Dividend Income <span style="color:var(--text3)">(lifetime, incl. DRP)</span></span>
        <span style="color:var(--gold)">${n2(t.dividends)}</span>
      </div>
    </div>
    <div style="margin-top:12px;font-size:10px;color:var(--text3)">
      Total Investment = Invested Amount (Buy + DRP orders) + Capital Gain.<br>
      Dividend Income is shown for reference only — DRP-reinvested amounts are already
      counted in Invested Amount, so adding it in would double-count.
    </div>`;

  openHudPopup('dr-total-popup', html, { minWidth: '320px' });
}

// ── DEBT RECYCLING — Total Gain breakdown popup ────────────────────────
function showDRGainBreakdown(propId){
  const t = (window.__drGainBreakdown||{})[propId];
  if(!t){ notify('Breakdown not available — re-open Property tab.','err'); return; }
  if(document.getElementById('dr-gain-popup')){ closeHudPopup('dr-gain-popup'); return; }

  const html = `
    <div data-hud-header style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:14px;font-weight:700;color:var(--text)">Total Gain — ${escHtml(t.propName)}</div>
      <button onclick="closeHudPopup('dr-gain-popup')"
        style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px;line-height:1">✕</button>
    </div>
    <div style="display:flex;flex-direction:column">
      <div style="display:flex;justify-content:space-between;padding:5px 0;color:var(--text3);font-size:10px;letter-spacing:.06em;text-transform:uppercase">
        <span>Capital Gain calc</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:3px 0 3px 10px;color:var(--text2)">
        <span>Current Value <span style="color:var(--text3)">(linked holdings, today)</span></span>
        <span style="color:var(--text)">${n2(t.currentValue)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:3px 0 5px 10px;color:var(--text2);border-bottom:1px solid var(--border)">
        <span>− Invested Amount <span style="color:var(--text3)">(cost basis)</span></span>
        <span style="color:var(--text)">${n2(t.invested)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:2px solid var(--border2)">
        <span style="color:var(--text2);font-weight:600">= Capital Gain <span style="color:var(--text3);font-weight:400">(unrealised, lifetime)</span></span>
        <span style="color:${t.capitalGain>=0?'var(--green)':'var(--red)'};font-weight:600">${n2(t.capitalGain)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:2px solid var(--border2)">
        <span style="color:var(--text2)">+ Dividend Income <span style="color:var(--text3)">(lifetime, incl. DRP)</span></span>
        <span style="color:var(--gold)">${n2(t.dividends)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-weight:700">
        <span style="color:var(--text)">= Total Gain</span>
        <span style="color:${t.total>=0?'var(--green)':'var(--red)'}">${n2(t.total)}</span>
      </div>
    </div>
    <div style="margin-top:12px;font-size:10px;color:var(--text3)">
      Total Gain = (Current Value − Invested Amount) + Dividend Income.<br>
      This isn't double-counting: DRP dividends raise Invested Amount (via the reinvested
      units' cost base), which lowers Capital Gain by that same amount — adding Dividend
      Income back nets it out, leaving the true return versus actual cash you put in
      (buy orders) plus every dollar of dividends the strategy has paid, reinvested or not.
    </div>`;

  openHudPopup('dr-gain-popup', html, { minWidth: '320px' });
}

// ── DEBT RECYCLING — FY performance UI ─────────────────────────────────
function drCompact(n){
  const v = +n || 0;
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if(a >= 1e6) return '$'+sign+(a/1e6).toFixed(2)+'m';
  if(a >= 1e3) return '$'+sign+(a/1e3).toFixed(1)+'k';
  return '$'+sign+a.toFixed(0);
}

// Human span for a part-year row: days for a short first year (a split opened
// on 17 June is a 14-day year, not "1 mo"), months otherwise.
function drSpanLabel(r){
  const d = +((r && r.daysActive)||0);
  if(!d) return (r && r.months) ? r.months+' mo' : '';
  if(d < 45) return d+' d';
  return Math.max(1, Math.round(d/30.44))+' mo';
}

function drPerfChartSvg(rows){
  if(!rows || !rows.length) return '';
  const W=860, H=170, padL=14, padR=14, padT=22, padB=30;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const vals = rows.map(r=>+r.netAfterTax||0);
  let max = Math.max(0,...vals), min = Math.min(0,...vals);
  if(max===min){ max = 1; min = -1; }
  const span = max-min;
  max += span*0.12; min -= span*0.12;
  const y = v => padT + (max-v)/(max-min)*plotH;
  const zeroY = y(0);
  const step = plotW/rows.length;
  const bw = Math.max(10, Math.min(48, step*0.52));
  const bars = rows.map((r,i)=>{
    const cx = padL + step*(i+0.5);
    const v = +r.netAfterTax||0;
    const yv = y(v);
    const top = Math.min(yv, zeroY);
    const h = Math.max(1, Math.abs(yv-zeroY));
    const fill = v>=0 ? 'var(--green)' : 'var(--red)';
    const ret = r.returnPct==null ? '—' : r.returnPct.toFixed(1)+'%';
    const above = v>=0;
    const labelY = above ? Math.max(padT+9, top-6) : Math.min(H-padB-4, top+h+12);
    return `<g>
      <rect x="${(cx-bw/2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" style="fill:${fill};opacity:.82">
        <title>FY${r.fy}: ${n2(v)} net after tax · ${ret} return · ${n2(r.interest)} interest</title>
      </rect>
      <text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="9.5" style="font-family:var(--mono);fill:${v>=0?'var(--green)':'var(--red)'}">${drCompact(v)}</text>
      <text x="${cx.toFixed(1)}" y="${(H-padB+16).toFixed(1)}" text-anchor="middle" font-size="10" style="font-family:var(--mono);fill:var(--text3)">FY${r.fy}${(r.partial||r.isCur)?'*':''}</text>
      <text x="${cx.toFixed(1)}" y="${(H-padB+29).toFixed(1)}" text-anchor="middle" font-size="9" style="font-family:var(--mono);fill:var(--gold)">${ret}</text>
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:540px;height:auto;display:block" role="img" aria-label="Debt recycling net after tax by financial year">
    <line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W-padR}" y2="${zeroY.toFixed(1)}" stroke-dasharray="3 3" style="stroke:var(--border2)"/>
    ${bars}
  </svg>
  <div style="font-size:9px;color:var(--text3);margin-top:4px;text-align:center">Bars = net after tax · gold = return on DR debt · * part-year</div>`;
}

function drPerfBodyHtml(data){
  const rows = (data && data.rows) || [];
  if(!rows.length){
    return `<div style="padding:24px 10px;text-align:center;color:var(--text3);font-size:12px;line-height:1.6">
      No debt recycling history yet.<br>Link stocks/ETFs and set a <b>Start Date</b> on the investment-purpose loan split to begin.
    </div>`;
  }
  const showUnreal = localStorage.getItem('pt_dr_show_unreal') !== '0';
  const cur = rows[rows.length-1];
  const totalNet = rows.reduce((s,r)=>s+(+r.netAfterTax||0),0);
  // The TOTAL row is an aggregate of averages, not a sum of them. Both of its
  // average-based cells are weighted by days open, so a 4-month year can't
  // count the same as a 12-month one and the debt cell stays a real average
  // rather than growing by a year's worth of debt every time one is added.
  const rowDays = r=>{
    const d = +r.daysActive||0;
    if(d > 0) return d;
    const f = +r.frac||0;
    return Math.round(365 * (f > 0 && f <= 1 ? f : 1));  // manual-only year = full year
  };
  const totalDays = rows.reduce((s,r)=>s+rowDays(r),0);
  const avgDebtTotal = totalDays>0
    ? rows.reduce((s,r)=>s+(+r.avgDebt||0)*rowDays(r),0)/totalDays : null;
  // Return is a rate, so its total is the day-weighted average of the yearly
  // rates — the same weighting the debt cell uses, which is what keeps the two
  // consistent however the mix of part-years and full years changes.
  const rateRows = rows.filter(r=>r.returnPct!=null && isFinite(+r.returnPct) && rowDays(r)>0);
  const rateDays = rateRows.reduce((s,r)=>s+rowDays(r),0);
  const avgRet = rateDays>0
    ? rateRows.reduce((s,r)=>s+(+r.returnPct)*rowDays(r),0)/rateDays : null;
  const totalInterest = rows.reduce((s,r)=>s+(+r.interest||0),0);
  const totalIncome = rows.reduce((s,r)=>s+(+r.incomeCash||0),0);
  const totalGrowth = rows.reduce((s,r)=>s+(+r.growth||0),0);
  const totalPre = rows.reduce((s,r)=>s+(+r.netPreTax||0),0);
  const totalShield = rows.reduce((s,r)=>s+(+r.taxShield||0),0);
  const totalDivTax = rows.reduce((s,r)=>s+(+r.divTax||0),0);
  const totalFrank  = rows.reduce((s,r)=>s+(+r.frank||0),0);
  const totalTaxEffect = totalShield - totalDivTax;
  const totalDivOp = totalDivTax >= 0 ? '−' : '+';
  const totalDivAbs = Math.abs(totalDivTax);
  const best = rows.reduce((a,b)=>(+b.netAfterTax||0)>(+a.netAfterTax||0)?b:a, rows[0]);
  const worst = rows.reduce((a,b)=>(+b.netAfterTax||0)<(+a.netAfterTax||0)?b:a, rows[0]);

  // A value's own colour is a hint, but a badge needs a background to read as
  // one. The tint follows the same tokens the rest of the app uses — soft
  // green for a gain, soft red for a loss, neutral otherwise — so the three
  // cards sit in the same family as every other chip on the dashboard.
  const kpi = (label,value,cls,sub,raw,id,onclick)=>{
    const c = cls==='pos' ? 'var(--green)'
      : cls==='neg' ? 'var(--red)'
      : 'var(--cat-portfolio)';
    const clickAttr = onclick ? ` onclick="${onclick}" style="--c:${c};padding:12px 14px;cursor:pointer"` : ` style="--c:${c};padding:12px 14px"`;
    const roleAttr = onclick ? ' role="button" tabindex="0"' : '';
    return `<div class="card"${clickAttr}${roleAttr}>
    <div class="card-label">${label}</div>
    <div class="card-value ${cls}" id="${id}">${value}</div>
    <div class="card-sub">${sub}</div>
  </div>`;
  };

  const th = (t,al='right',title='')=>`<th${title?` title="${title}"`:''} style="text-align:${al};padding:5px 7px;font-weight:500;white-space:nowrap;color:var(--text3)">${t}</th>`;
  const td = (v,al='right',cls='',sub='',style='')=>`<td class="${cls}" style="text-align:${al};padding:5px 7px;white-space:nowrap;${style}">${v}${sub?`<div style="font-size:9px;color:var(--text3);margin-top:1px">${sub}</div>`:''}</td>`;
  // Signed currency for the tax breakdown: n2 puts the minus inside the dollar
  // sign ("$-1,167.08"), which reads badly on a 9px sub-line.


  const body = rows.map((r,i)=>{
    const bg = r.isCur ? 'background:rgba(96,165,250,.07)'
      : (i%2 ? 'background:rgba(255,255,255,.015)' : '');
    const ret = r.returnPct==null ? '—' : r.returnPct.toFixed(2)+'%';
    const partMark = (r.partial || r.isCur) ? '<span style="color:var(--gold)">*</span>' : '';
    const fySub = r.partial
      ? (drSpanLabel(r)+(r.isCur?' YTD':''))
      : (r.isCur ? Math.round((r.progress||0)*100)+'% YTD' : '');
    // One tax line: the interest deduction less the tax on the dividends — the
    // "Tax benefit". The breakdown underneath stays hidden until the cell is
    // hovered or tapped (see .dr-tax-sub in app.css), so the table reads
    // cleanly on a phone and the figures are still there when you ask.
    const taxEffect = (+r.taxShield||0) - (+r.divTax||0);
    const divTaxVal = +r.divTax||0;
    const divAbs = Math.abs(divTaxVal);
    const divOp = divTaxVal >= 0 ? '−' : '+';
    const taxSub = 'Loan Interest ' + n2(r.taxShield||0)
      + (divAbs > 0.005 ? ' ' + divOp + ' Dividends ' + n2(divAbs) : '');
    const taxCell = `<td class="dr-tax-cell" tabindex="0" onclick="this.focus()" title="${taxSub}" style="text-align:right;padding:5px 7px;white-space:nowrap;${taxEffect<0?'color:var(--red)':'color:var(--gold)'}">${n2(taxEffect)}<div class="dr-tax-sub" style="font-size:9px;color:var(--text3);margin-top:1px">${taxSub}</div></td>`;
    return `<tr style="${bg}">
      ${td('FY'+r.fy+partMark,'left','',fySub,'white-space:nowrap')}
      ${td(n2(r.avgDebt,0))}
      ${td(n2(r.interest),'right','neg')}
      ${td(n2(r.incomeCash),'right','pos')}
      ${td(n2(r.growth)+(r.growthComplete?'':'<span style="color:var(--gold)">*</span>'),'right',clr(r.growth))}
      ${td(n2(r.netPreTax),'right',clr(r.netPreTax))}
      ${taxCell}
      ${td(n2(r.netAfterTax),'right',clr(r.netAfterTax),'','font-weight:700')}
      ${td(ret,'right',clr(r.returnPct))}
    </tr>`;
  }).join('');

  const table = `<table style="width:100%;min-width:760px;border-collapse:collapse;font-family:var(--mono);font-size:11px">
    <thead><tr style="border-bottom:1px solid var(--border)">
      ${th('FY','left')}${th('Avg DR debt','right','Average debt for the year = (opening + closing balance) ÷ 2. The TOTAL row shows the day-weighted average across the years, not a sum.')}${th('Interest')}${th('Income (Cash)','right','Dividends actually paid into the broker cash account — the amount the DRP reinvests. Franking credits are a tax offset, not cash, so they are not included.')}${th('Capital Gain')}
      ${th('Net pre-tax')}${th('Tax benefit','right','Interest × your marginal rate, less the tax on the dividends — what the structure saves you in tax. The dividend tax is (cash dividend + franking credit) × marginal rate − franking credit: it costs money above a 30% rate, is zero at 30%, and comes back as a refund below it. Turns negative only if dividend tax exceeds the interest deduction. The breakdown shows Loan Interest $… −/+ Dividends $…, with − when the dividend tax is a cost and + when it is a refund. Hover or tap the figure to see the two halves.')}${th('Net after tax','right','Net pre-tax + tax benefit. CGT is not deducted: the capital gain shown is unrealised, so no tax falls due until you sell.')}${th('Return %','right','Net after tax as a percentage of average DR debt. Interest is already deducted, so this is the margin earned above the after-tax interest cost — anything above zero means recycling beat leaving the cash in the offset. Measured before CGT.')}
    </tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr style="border-top:2px solid var(--border2);font-weight:700">
      <td style="padding:6px 7px">TOTAL</td>
      <td style="text-align:right;padding:6px 7px" title="Day-weighted average across every year shown — a real average, not a sum of the yearly averages">${avgDebtTotal==null?'—':n2(avgDebtTotal,0)}</td>
      <td style="text-align:right;padding:6px 7px" class="neg">${n2(totalInterest)}</td>
      <td style="text-align:right;padding:6px 7px" class="pos">${n2(totalIncome)}</td>
      <td style="text-align:right;padding:6px 7px" class="${clr(totalGrowth)}">${n2(totalGrowth)}</td>
      <td style="text-align:right;padding:6px 7px" class="${clr(totalPre)}">${n2(totalPre)}</td>
      <td class="dr-tax-cell" tabindex="0" onclick="this.focus()" title="Loan Interest ${n2(totalShield)} ${totalDivOp} Dividends ${n2(totalDivAbs)}" style="text-align:right;padding:6px 7px;${totalTaxEffect<0?'color:var(--red)':'color:var(--gold)'}">${n2(totalTaxEffect)}<div class="dr-tax-sub" style="font-size:9px;color:var(--text3);margin-top:1px">Loan Interest ${n2(totalShield)} ${totalDivOp} Dividends ${n2(totalDivAbs)}</div></td>
      <td style="text-align:right;padding:6px 7px" class="${clr(totalNet)}">${n2(totalNet)}</td>
      <td style="text-align:right;padding:6px 7px" class="${clr(avgRet)}">${avgRet==null?'—':avgRet.toFixed(2)+'%'}</td>
    </tr></tfoot>
  </table>`;

  const chartRows = rows.slice(-8);
  const curSub = 'FY'+cur.fy+' · '+(cur.partial
      ? (drSpanLabel(cur)+(cur.isCur?' YTD':''))
      : (Math.round((cur.progress||0)*100)+'% through'))+' · after tax';
  // Return % is already measured above the interest charge, so it *is* the
  // margin over the breakeven — no separate comparison needed now that the
  // hurdle comes from actual interest. Dividend tax is inside it; CGT is not,
  // because the gain is unrealised.
  const retSub = cur.returnPct==null ? 'No DR debt in the current FY'
    : (cur.returnPct>=0 ? cur.returnPct.toFixed(2)+'% ahead of the '
      : Math.abs(cur.returnPct).toFixed(2)+'% behind the ')
      +(+cur.benchmarkPct||0).toFixed(2)+'% after-tax interest cost, yield = '
      +(cur.returnPct+(+cur.benchmarkPct||0)).toFixed(2)+'%';
  const retSubPrev = rows.length>1 ? (()=>{ const p = rows[rows.length-2]; return p.returnPct==null ? 'No DR debt in previous FY' : (p.returnPct>=0 ? p.returnPct.toFixed(2)+'% ahead of the ' : Math.abs(p.returnPct).toFixed(2)+'% behind the ') + (+p.benchmarkPct||0).toFixed(2)+'% after-tax interest cost, yield = ' + (p.returnPct+(+p.benchmarkPct||0)).toFixed(2)+'%'; })() : retSub;
  const missingDates = +(data.meta && data.meta.missingSplitDates) || 0;

  return `
    ${missingDates ? `<div style="display:flex;gap:8px;align-items:flex-start;background:rgba(224,178,92,.08);border:1px solid var(--gold);border-radius:6px;padding:8px 10px;margin-bottom:12px;font-size:11px;color:var(--text2);line-height:1.5">
      <span style="color:var(--gold);font-weight:700">!</span>
      <span>${missingDates} investment split${missingDates>1?'s':''} ${missingDates>1?'have':'has'} no Start Date, so interest can't be pro-rated. Set it in the loan split editor to fix the affected years.</span>
    </div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:4px;margin-bottom:6px">
      ${(() => { const showPrev = window.__drShowPrev && rows.length>1; const r = showPrev ? rows[rows.length-2] : cur; const lbl = showPrev ? 'Previous FY Net' : 'This FY Net'; const sub = showPrev ? 'FY'+r.fy : curSub; return kpi(lbl, n2(r.netAfterTax), clr(r.netAfterTax), sub, r.netAfterTax, 'dr-kpi-net', "window.__drShowPrev=!window.__drShowPrev;renderDRPerfContent(window.__drPerfScope||null);"); })()}
      ${(() => { const showPrev = window.__drShowPrev && rows.length>1; const r = showPrev ? rows[rows.length-2] : cur; return kpi('Return on DR Debt', r.returnPct==null?'—':r.returnPct.toFixed(2)+'%', clr(r.returnPct), showPrev ? retSubPrev : retSub, r.returnPct, 'dr-kpi-ret'); })()}
      ${kpi('Lifetime Net', n2(totalNet), clr(totalNet), 'since FY'+rows[0].fy+' · '+(avgRet==null?'—':avgRet.toFixed(2)+'% avg on debt'), totalNet, 'dr-kpi-life')}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <label style="display:inline-flex;align-items:center;gap:7px;font-size:11px;color:var(--text2);cursor:pointer">
        <input type="checkbox" ${showUnreal?'checked':''} onchange="toggleDRPerfUnreal(this.checked)">
        Include unrealised growth
      </label>
      <div style="font-size:10px;color:var(--text3)">
        Best <b class="pos">FY${best.fy}</b> ${n2(best.netAfterTax)} &nbsp;·&nbsp;
        Worst <b class="neg">FY${worst.fy}</b> ${n2(worst.netAfterTax)}
        ${rows.some(r=>!r.growthComplete)?' &nbsp;·&nbsp; <span title="Price history incomplete — those years show realised gains only">* growth is realised only</span>':''}
      </div>
    </div>
    <div style="background:var(--bg);border:1px solid var(--green-dim);border-radius:6px;padding:6px 6px;margin-bottom:4px;overflow-x:auto">${drPerfChartSvg(chartRows)}</div>
    <div style="overflow-x:auto">${table}</div>
    <div style="margin-top:12px;font-size:10px;color:var(--text3);line-height:1.6">
      <div onclick="toggleDRPerfNotes()" style="display:flex;align-items:center;gap:7px;cursor:pointer;user-select:none"
           title="Show or hide how these figures are calculated">
        <span id="dr-notes-toggle" style="font-family:var(--mono);font-weight:700;font-size:12px;line-height:1;width:9px;text-align:center;color:var(--text3)">+</span>
        <b style="color:var(--text2)">How this is calculated</b>
      </div>
      <div id="dr-notes-body" style="display:none;margin-top:7px;padding-left:16px">
      Income (Cash) = dividends actually credited to the broker cash account, including amounts the DRP
      reinvested. Franking credits are a tax offset, not cash, so they stay out of this column and appear
      in their own column instead. Capital Gain = the movement in unrealised gain over the year — the linked
      holdings' value less their CGT cost base, which is the same basis your broker reports. (Selling takes
      the realised gain out of that pool; it appears in the Tax tab instead.) Net pre-tax = income + capital gain
      − interest. Net after tax = net pre-tax + tax benefit, where the tax benefit is the interest deduction
      (interest × marginal rate) less the tax on the dividends.<br>
      Dividend tax = (cash dividend + franking credit) × marginal rate − franking credit. The dividend and its
      credit are taxed together and the credit then offsets the tax, so at a 30% rate a fully franked dividend
      is exactly tax-neutral, above 30% it costs money and below 30% the excess credit comes back as a refund.
      That is also why franking credits are not added to Income (Cash): they reduce the tax on the dividend
      rather than arriving as cash. Hover (or tap, on a touch device) the Tax benefit figure to see the two
      halves, so you can tell whether the interest deduction or the dividend tax is the larger.<br>
      The breakdown line shows: Loan Interest $… [−/+] Dividends $… where the operator is − (minus)
      when the dividend tax is a cost (above a 30% marginal rate) and + (plus) when the dividend tax is a
      refund (below 30%). Capital gains are shown before CGT — the gain here is unrealised, so no tax falls
      due until you sell, and the sale's CGT belongs to the Tax tab.<br>
      Return % = net after tax ÷ average DR debt. Because interest is already deducted, that figure is the
      margin earned above the after-tax interest cost — above zero means recycling beat the offset.<br>
      Income + Capital Gain therefore equals the <i>Total Gain (Capital + Dividends)</i> figure in the
      Debt Recycling panel, which is a pre-personal-tax figure: the panel and your broker show the cash and
      the gain, while this table also charges the tax on the dividends.<br>
      Estimates pro-rate the investment split's interest over the days it was actually open, using
      its Opening Balance and each 30 June balance. Enter actual FY figures in the property's
      <i>DR History</i> to make a year exact.<br>
      The after-tax interest cost is the interest actually booked on the debt, after tax (interest × (1 − marginal rate) ÷ average
      DR debt), so a split that was only open for part of the period can't inflate it. In the combined view
      each linked stock is counted once, even if more than one property links it.<br>
      The TOTAL row is an aggregate, not another year: its <i>Avg DR debt</i> is the day-weighted average across
      the years shown (a real average, not a sum of the yearly averages) and its <i>Return %</i> is the
      day-weighted average of the yearly returns, so a part-year carries only its share of the weight.<br>
      Each FY only covers the days its investment split was actually open, so interest is pro-rated
      from the split's Start Date (through its Closed date, if set) and no year earlier than the
      first split is shown. Dividends are counted on the same window, so a stock you held before the
      loan can make this column sit slightly below the Dividends tab. A part-year is reported as-is,
      not annualised.
      </div>
    </div>`;
}

function renderDRPerfContent(scope){
  const el = $('dr-perf-content');
  if(!el) return;
  const data = getDRDataForScope(scope || null);
  el.innerHTML = drPerfBodyHtml(data);

  // Animate KPI badges when data changes (e.g. Include unrealised growth toggle)
  const rows = (data && data.rows) || [];
  if(rows.length){
    const showPrev = window.__drShowPrev && rows.length>1;
    const curRow = showPrev ? rows[rows.length-2] : rows[rows.length-1];
    const prevVals = window.__drKpiPrev || (window.__drKpiPrev = {});
    const anim = (id, target, fmt) => {
      const node = $(id); if(!node) return;
      if(prevVals[id] !== undefined && target != null && prevVals[id] != null && Math.abs(+target - +prevVals[id]) > 0.005){
        node.dataset.rawVal = String(prevVals[id]);
        animateValue(node, target, {format: fmt, flash: true});
        prevVals[id] = target;
      } else {
        prevVals[id] = target;
        if(node.dataset.rawVal == null || node.textContent !== fmt(target)){
          node.dataset.rawVal = String(target);
          node.textContent = fmt(target);
        }
      }
    };
    const fmtCur = v => v==null ? '—' : n2(v,0);
    const fmtPct = v => v==null ? '—' : v.toFixed(2)+'%';
    // Lifetime Net is always the TOTAL row's Net After Tax (every FY), regardless of the This/Previous FY toggle.
    const totalNet = rows.reduce((s,r)=>s+(+r.netAfterTax||0),0);
    anim('dr-kpi-net', curRow.netAfterTax, fmtCur);
    anim('dr-kpi-ret', curRow.returnPct, fmtPct);
    anim('dr-kpi-life', totalNet, fmtCur);
  }
}

function toggleDRPerfUnreal(checked){
  localStorage.setItem('pt_dr_show_unreal', checked ? '1' : '0');
  invalidateDRPerfCache();
  renderDRPerfContent(window.__drPerfScope || null);
}

// Subtitle line for the DR popup: names the current scope and, when there is
// more than one DR property, offers the one-click switch to the other scope.
// Kept as a plain link rather than a dashboard block so the combined view is
// still reachable without adding clutter back to the Property tab.
function drScopeProps(){
  return (typeof properties!=='undefined' ? properties : []).filter(p=>p.propType==='ppor' && p.debtRecycling);
}

function drScopeLabel(scope){
  const all = drScopeProps();
  const link = (label, onclick) => `<a href="#" onclick="event.preventDefault();${onclick}" style="color:var(--teal);text-decoration:none">${label} ›</a>`;
  if(scope){
    const p = (typeof properties!=='undefined' ? properties : []).find(x=>x.id===scope);
    const name = p ? p.name : 'Property';
    return escHtml(name) + ' · per property'
      + (all.length > 1 ? ' &nbsp;·&nbsp; ' + link('All ' + all.length + ' DR properties', 'switchDRScope(null)') : '');
  }
  if(all.length <= 1){
    return all[0] ? escHtml(all[0].name) + ' · per property' : 'No debt recycling properties yet';
  }
  return all.length + ' properties · combined &nbsp;·&nbsp; ' + link('Single property', 'switchDRScopeIdx(0)');
}

function switchDRScope(scope){
  window.__drPerfScope = scope || null;
  const sub = $('dr-perf-sub');
  if(sub) sub.innerHTML = drScopeLabel(scope || null);
  renderDRPerfContent(scope || null);
}

function switchDRScopeIdx(i){
  const p = drScopeProps()[+i];
  if(p) switchDRScope(p.id);
}

function showDRPerformance(propId){
  const id = 'dr-perf-popup';
  if(document.getElementById(id)){ closeHudPopup(id); return; }
  const scope = propId || null;
  window.__drPerfScope = scope;
  const html = `
    <div data-hud-header style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px">
      <div>
        <div style="font-size:14px;font-weight:700;color:var(--text)">Debt Recycling — FY Performance</div>
        <div id="dr-perf-sub" style="font-size:10px;color:var(--text3);margin-top:2px">${drScopeLabel(scope)}</div>
      </div>
      <button onclick="closeHudPopup('${id}')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px;line-height:1">✕</button>
    </div>
    <div id="dr-perf-content"></div>`;
  openHudPopup(id, html, { width:'1100px', maxWidth:'96vw', minWidth:'320px' });
  renderDRPerfContent(scope);
}

function togglePropSoldFields(){
  const box = $('pf-sold');
  const wrap = $('pf-sold-fields');
  if(!box || !wrap) return;
  wrap.style.display = box.checked ? 'grid' : 'none';
}

function clearPropForm(){
  ['pf-name','pf-pprice','pf-pcosts','pf-improvements','pf-cval','pf-rent','pf-expenses','pf-notes','pf-sdate','pf-sprice','pf-scosts','pf-estsell']
    .forEach(id=>{ const el=$(id); if(el) el.value=''; });
  $('pf-pdate').value='';
  updatePropFormFYFields();
  if($('pf-sold')) $('pf-sold').checked=false;
  if($('pf-mainres')) $('pf-mainres').checked=false;
  togglePropSoldFields();
  if($('pf-dr')) $('pf-dr').checked=false;
  if($('pf-dr-symbols')) $('pf-dr-symbols').dataset.selected='[]';
  if($('pf-dr-history-wrap')){ $('pf-dr-history-wrap').dataset.history='{}'; $('pf-dr-history-wrap').innerHTML=''; }
  togglePropDRVisibility();
  togglePropDRFields();
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
  if($('pf-estsell')) $('pf-estsell').value = p.estSellCostPct||'';
  if($('pf-sold')){
    $('pf-sold').checked   = !!p.sold;
    $('pf-sdate').value    = p.soldDate||'';
    $('pf-sprice').value   = p.salePrice||'';
    $('pf-scosts').value   = p.sellingCosts||'';
    $('pf-mainres').checked= !!p.mainResExempt;
    togglePropSoldFields();
  }
  togglePropDRVisibility();
  if($('pf-dr')){
    $('pf-dr').checked = !!p.debtRecycling;
    if($('pf-dr-history-wrap')) $('pf-dr-history-wrap').dataset.history = JSON.stringify(p.drHistory||{});
    renderDRSymbolChips(p.drSymbols||[]);
    togglePropDRFields();
  }
  $('pf-edit-id').dataset.id = p.id;
  renderSplitRows(normaliseSplits(p));
  if($('pf-dr')?.checked) renderDRHistoryRows();
  updatePropFormFYFields();
  document.querySelectorAll('#pf-fy-fields .pf-fy-input').forEach(inp=>{
    const yr = +inp.dataset.fy;
    inp.value = (p.fyData && p.fyData[yr]!=null) ? p.fyData[yr] : '';
  });
  document.querySelectorAll('#pf-fy-fields .pf-fy-debt-input').forEach(inp=>{
    const yr = +inp.dataset.fy;
    inp.value = (p.fyDebtData && p.fyDebtData[yr]!=null) ? p.fyDebtData[yr] : '';
  });
  document.querySelectorAll('#pf-fy-fields .pf-fy-offset-input').forEach(inp=>{
    const yr = +inp.dataset.fy;
    inp.value = (p.fyOffsetData && p.fyOffsetData[yr]!=null) ? p.fyOffsetData[yr] : '';
  });
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
  invalidateDRPerfCache();
  renderProperties();
  renderPropCards();
  if(typeof renderTax==='function') renderTax();
  notify('Property deleted.','ok');
}

// Which properties' "ESTIMATED CGT IF SOLD TODAY" sections the user has expanded this session.
// Sections start collapsed; this just stops a re-render from collapsing one you opened.
const propSaleOpen = new Set();
function propSaleToggle(el){
  const id = String(el.dataset.id);
  if(el.open) propSaleOpen.add(id); else propSaleOpen.delete(id);
  if(el.firstElementChild) el.firstElementChild.style.marginBottom = el.open ? '12px' : '0';
}
const PROP_TYPE_LABEL = {ppor:'PPOR',investment:'Investment',commercial:'Commercial',land:'Land'};

// Snapshot each property's currentValue (and outstanding loan balance)
// into fyData / fyDebtData when a new financial year starts — mirrors
// checkSuperFYRollover() exactly. Property has no other history mechanism
// (currentValue, loan balances, and offset balances are overwritten on
// every edit), so this is the only way past-FY figures ever get preserved,
// and it can only start from whichever FY is current the first time this
// runs — there's no way to recover years before that; none of these
// figures were ever stored.
// fyDebtData and fyOffsetData are what let the Net Worth annual snapshot
// show Property (gross value), Loan Remaining, and Cash (offset balances)
// as separate figures for years captured from here on; years before this
// was added still won't have a loan or offset figure, same limitation
// fyData itself already has for value.
function checkPropertyFYRollover(){
  try{
    const _d = new Date();
    const CUR_FY  = _d.getMonth() >= 6 ? _d.getFullYear()+1 : _d.getFullYear();
    const PREV_FY = CUR_FY - 1;
    const lastFY  = +(localStorage.getItem('pt_property_last_fy')||0);

    if(lastFY && lastFY < CUR_FY && Array.isArray(properties)){
      let changed = false;
      properties.forEach(p=>{
        // A property sold on/before 30 June of PREV_FY wasn't owned at that year-end — capturing it
        // here made every later FY's Net Worth snapshot keep counting a sold property at its stale
        // last value/debt. (Sold with no date: can't tell, so it's not captured going forward.)
        if(p.sold && (!p.soldDate || p.soldDate <= PREV_FY + '-06-30')) return;
        if(!p.fyData) p.fyData = {};
        if(p.fyData[PREV_FY] == null && p.currentValue != null){
          p.fyData[PREV_FY] = +p.currentValue;
          changed = true;
        }
        if(!p.fyDebtData) p.fyDebtData = {};
        if(p.fyDebtData[PREV_FY] == null){
          p.fyDebtData[PREV_FY] = normaliseSplits(p).reduce((s,sp)=>s+(+sp.balance||0),0);
          changed = true;
        }
        if(!p.fyOffsetData) p.fyOffsetData = {};
        if(p.fyOffsetData[PREV_FY] == null){
          p.fyOffsetData[PREV_FY] = normaliseSplits(p).reduce((s,sp)=>s+(+sp.offset||0),0);
          changed = true;
        }
        // Debt recycling: snapshot each split's 30 June balance, then capture
        // the part-year (or full-year) DR figures that snapshot implies. A
        // manual entry for that FY always wins, so this only fills a gap the
        // first time the new FY rolls over.
        if(p.debtRecycling){
          if(!p.drHistory) p.drHistory = {};
          if(p.drHistory[PREV_FY] == null){
            let snapChanged = false;
            normaliseSplits(p).forEach(sp=>{
              if(!sp.balances || typeof sp.balances!=='object') sp.balances = {};
              if(sp.balances[PREV_FY] == null){
                sp.balances[PREV_FY] = { balance:+sp.balance||0, offset:+sp.offset||0 };
                snapChanged = true;
              }
            });
            const dr = buildDRFYData(p, { onlyFY: PREV_FY });
            const row = dr.rows[0];
            if(row && (row.avgDebt > 0 || row.interest > 0)){
              p.drHistory[PREV_FY] = {
                balance: +row.avgDebt.toFixed(2),
                interest: +row.interest.toFixed(2),
                source: 'auto'
              };
              changed = true;
            } else if(snapChanged){
              changed = true;
            }
          }
        }
      });
      if(changed){
        saveProps();
        invalidateDRPerfCache();
        if(typeof notify === 'function') notify('Property values captured for FY'+PREV_FY+' ✓','ok');
      }
    }
    localStorage.setItem('pt_property_last_fy', CUR_FY);
  }catch(e){ console.warn('checkPropertyFYRollover error:', e); }
}

function renderProperties(){
  checkPropertyFYRollover();
  const wrap = $('prop-cards-wrap');
  if(!properties.length){
    wrap.innerHTML='<div class="empty"><div class="empty-icon">🏠</div>No properties added yet. Fill in the form above.</div>';
    return;
  }
  window.__drBreakdown = {};
  window.__drGainBreakdown = {};
  // Built once so each card's CGT estimate doesn't re-run the whole parcel engine.
  let __cgtCtx = null;
  try{ if(typeof cgtSaleContext === 'function') __cgtCtx = cgtSaleContext(); }catch(e){ console.error('CGT context failed', e); }
  wrap.innerHTML = properties.map(p=>{
    const m = propMetrics(p);
    const typeLabel = PROP_TYPE_LABEL[p.propType]||p.propType;
    const lvrClass = m.lvr>80?'neg':m.lvr>60?'':'pos';
    const isDR = p.propType==='ppor' && p.debtRecycling;
    const drDivs = isDR ? calcDRDividendStats(p) : null;
    const drCap  = isDR ? calcDRCapitalGains(p)   : null;

    const stat = (label,val,cls='neu') =>
      `<div><div style="font-size:10px;color:var(--text3);letter-spacing:.07em;text-transform:uppercase;margin-bottom:2px">${label}</div>
       <div class="${cls}" style="font-family:var(--mono);font-size:13px;font-weight:600">${val}</div></div>`;

    // Splits table
    const oneSplit = m.splits.length === 1;
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
                const autoR= sp.ltype==='io' ? moInt : calcMonthlyPI(bal,rate,+sp.term||0); // repayment is on the full balance, not net of offset
                const rep  = +(+sp.repay||autoR).toFixed(2);
                return `<tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:5px 8px 5px 0;font-weight:600">${sp.label||'Split'}</td>
                  <td style="text-align:right;padding:5px 8px"><span class="badge b-reit">${sp.ltype==='io'?'IO':'P&I'}</span></td>
                  <td style="text-align:right;padding:5px 8px${oneSplit?';color:var(--debt-red)':''}">${n2(bal)}</td>
                  <td style="text-align:right;padding:5px 8px">${rate.toFixed(2)}%</td>
                  <td style="text-align:right;padding:5px 8px;color:var(--green)">${off?n2(off):'—'}</td>
                  <td style="text-align:right;padding:5px 8px${oneSplit?';color:var(--debt-brick)':''}">${n2(eff)}</td>
                  <td style="text-align:right;padding:5px 8px;color:var(--red)">${n2(moInt)}</td>
                  <td style="text-align:right;padding:5px 8px${oneSplit?';color:var(--debt-coral)':''}">${n2(rep)}</td>
                </tr>`;
              }).join('')}
              ${m.splits.length>1?`<tr style="border-top:2px solid var(--border);font-weight:700;color:var(--text2)">
                <td style="padding:5px 8px 5px 0">TOTAL</td>
                <td></td>
                <td style="text-align:right;padding:5px 8px;color:var(--debt-red)">${n2(m.loanCur)}</td>
                <td style="text-align:right;padding:5px 8px;font-size:10px">${m.wtRate.toFixed(2)}% wtd</td>
                <td></td>
                <td style="text-align:right;padding:5px 8px;color:var(--debt-brick)">${n2(m.effectiveLoan)}</td>
                <td style="text-align:right;padding:5px 8px;color:var(--debt-red)">${n2(m.monthlyInterest)}</td>
                <td style="text-align:right;padding:5px 8px;color:var(--debt-coral)">${n2(m.repay)}</td>
              </tr>`:''}
            </tbody>
          </table>
        </div>
      </div>` : '';

    // ── Estimated CGT if this property were sold today ──
    const saleBox = (()=>{
      if(typeof cgtEstimatePropertySale !== 'function') return '';
      let est;
      try{ est = cgtEstimatePropertySale(p, __cgtCtx || undefined); }
      catch(e){ console.error('Property CGT estimate failed', e); return ''; }
      if(!est || est.status === 'sold') return '';
      const boxStyle = 'background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:14px;margin-top:12px';
      // Collapsed by default. The open state is remembered per property for this session so a
      // re-render (editing a property, switching tabs) doesn't snap a section you opened shut again.
      const saleOpen = propSaleOpen.has(String(p.id));
      const boxAttrs = `data-id="${p.id}" style="${boxStyle}" ${saleOpen ? 'open' : ''} ontoggle="propSaleToggle(this)"`;
      const title = `<summary style="cursor:pointer;font-family:var(--mono);font-size:10px;color:var(--text2);letter-spacing:.1em;text-transform:uppercase;margin-bottom:${saleOpen ? '12px' : '0'}">ESTIMATED CGT IF SOLD TODAY</summary>`;
      const note = (t, mt) => `<div style="font-size:11px;color:var(--text3);font-family:var(--mono);line-height:1.5${mt ? ';margin-top:'+mt : ''}">${t}</div>`;

      // ── Cash in hand after a sale ──
      // Net cash from sale = sale value − selling costs − loan payout − CGT.
      // The loan is repaid in full (offset doesn't reduce the principal owed);
      // the offset balance is the owner's own cash, so it's added back as a
      // separate line rather than being treated as sale proceeds.
      const value = m.cval;
      const sellCostPct = +p.estSellCostPct || 0;
      const sellCosts = typeof cgtPropertySellingCosts === 'function' ? cgtPropertySellingCosts(p, value) : (+p.sellingCosts || 0);
      const loan = m.loanCur;
      const offset = (m.splits || []).reduce((t, sp) => t + (+sp.offset || 0), 0);
      const taxKnown = est.status !== 'missing';
      const tax = est.status === 'ok' ? est.totalTax : 0;
      const netCash = value - sellCosts - loan - tax;
      const totalCash = netCash + offset;
      const row = (lbl, val, o) => { o = o || {}; const f = o.bold ? 'font-weight:700;' : ''; return `<tr style="${o.top ? 'border-top:1px solid var(--border);' : ''}"><td style="padding:5px 0;${f}">${lbl}</td><td style="text-align:right;padding:5px 0;${f}color:${o.color || 'var(--text)'}">${val}</td></tr>`; };
      const taxCell = !taxKnown ? 'unknown'
        : tax > 0 ? '−' + n2(tax)
        : tax < 0 ? '+' + n2(-tax) + ' (saving from the loss)'
        : est.status === 'exempt' ? 'None (main residence)' : '—';
      const cashHtml = `<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
        <div style="font-family:var(--mono);font-size:10px;color:var(--text2);letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">CASH IN HAND AFTER SALE</div>
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
          <table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px">
            ${row('Sale value', n2(value), { color:'var(--green)' })}
            ${row('Less: selling costs' + (sellCostPct ? ' (' + sellCostPct + '%)' : ''), sellCosts > 0 ? '−' + n2(sellCosts) : '—', { color: sellCosts > 0 ? 'var(--red)' : '' })}
            ${row('Less: loan payout', loan > 0 ? '−' + n2(loan) : '—', { color: loan > 0 ? 'var(--red)' : '' })}
            ${row('Less: est. CGT', taxCell, { color: tax > 0 ? 'var(--red)' : tax < 0 ? 'var(--green)' : '' })}
            ${row('Net cash from sale' + (taxKnown ? '' : ' (before CGT)'), n2(netCash), { bold: true, top: true, color: netCash >= 0 ? 'var(--green)' : 'var(--red)' })}
            ${row('Plus: offset balance (your own cash)', offset > 0 ? '+' + n2(offset) : '—', { color: offset > 0 ? 'var(--green)' : '' })}
            ${row('Total cash after sale', n2(totalCash), { bold: true, top: true, color:'var(--gold)' })}
          </table>
        </div>
        ${netCash < 0 ? note('Negative: the sale price wouldn\'t cover the loan and costs — you\'d need to find the shortfall' + (offset > 0 ? ', which your offset balance may help cover.' : '.'), '8px') : ''}
      </div>`;

      if(est.status === 'exempt') return `<details ${boxAttrs}>${title}${note('Main residence — assumed exempt from CGT, so no tax on a sale.')}${cashHtml}</details>`;
      if(est.status === 'missing') return `<details ${boxAttrs}>${title}${note('Add a purchase price and purchase date to estimate CGT (needed for the cost base and the 12-month discount). Cash below is before any CGT.')}${cashHtml}</details>`;

      const ownerLines = est.rows.length > 1
        ? `<div style="font-size:11px;color:var(--text2);font-family:var(--mono);margin-top:10px">${est.rows.map(r => `${escHtml(typeof getPersonLabel==='function' ? getPersonLabel(r.person) : r.person)}: <b>${n2(r.tax)}</b>`).join(' &nbsp;·&nbsp; ')}</div>` : '';
      return `<details ${boxAttrs}>
        ${title}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
          ${stat('Sale Value (current)', n2(est.value), 'pos')}
          ${stat('Cost Base', n2(est.costBase))}
          ${est.sellCosts > 0 ? stat('Selling Costs' + (est.sellCostPct ? ' (' + est.sellCostPct + '%)' : ''), n2(est.sellCosts), 'neg') : ''}
          ${stat('Capital Gain', n2(est.gain), clr(est.gain))}
          ${stat('CGT Discount', est.long ? '50% (held 12+ months)' : 'None (under 12 months)')}
          ${stat('Est. CGT Payable', est.gain > 0 ? n2(est.totalTax) : 'None — capital loss', est.totalTax > 0 ? 'neg' : est.totalTax < 0 ? 'pos' : 'neu')}
        </div>
        ${ownerLines}
        ${cashHtml}
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);line-height:1.5;margin-top:10px">Estimate if this property alone were sold today: current value${est.sellCosts ? ' less selling costs' : ''} less cost base (purchase price + costs + improvements), 50% discount if held over 12 months, taxed at each owner's marginal rate on top of their estimated income, including gains/losses already realised this year and carried-forward losses. Cash in hand repays the full loan from the sale; your offset balance stays yours and is added separately. ${est.sellCosts ? '' : 'Selling costs aren\'t included — set "Est. Selling Costs %" when you edit this property to include agent/legal fees. '}Not tax advice.</div>
      </details>`;
    })();

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
            ${p.notes?' · '+escHtml(p.notes):''}
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn" onclick="editProperty(this)" data-id="${p.id}">Edit</button>
          <button class="btn btn-r" onclick="deleteProperty(this)" data-id="${p.id}">Delete</button>
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
            ${stat('Total Balance',    n2(m.loanCur), 'debt-red')}
            ${stat('Initial Total',    n2(m.loanInit))}
            ${stat('Total Offset',     n2(m.splits.reduce((s,sp)=>s+(+sp.offset||0),0)), 'pos')}
            ${stat('Effective Loan',   n2(m.effectiveLoan), 'debt-brick')}
            ${stat('Wtd Avg Rate',     m.wtRate.toFixed(2)+'% p.a.')}
            ${stat('Monthly Interest', n2(m.monthlyInterest), 'neg')}
            ${stat('Offset Savings/mo',n2(m.interestSaved),   'pos')}
            ${stat('Est. Repayment',   n2(m.repay), 'debt-coral')}
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
            ${m.investmentAnnualInterest>0 ? stat('\u2514 Investment (deductible)', n2(m.investmentAnnualInterest), 'neg') : ''}
            ${m.personalAnnualInterest>0   ? stat('\u2514 Personal (not deductible)', n2(m.personalAnnualInterest), 'neu') : ''}
            ${stat('Net Annual Income',n2(m.annualNetRent), clr(m.annualNetRent))}
            ${stat('Gross Yield',      m.grossYield.toFixed(2)+'%', m.grossYield>0?'pos':'neu')}
            ${stat('Net Yield',        m.netYield.toFixed(2)+'%',   clr(m.netYield))}
            ${stat('Manager',          p.hasManager==='yes'?'Yes':'Self')}
          </div>
        </div>`:(isDR?`<div style="background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:14px">
          <div style="font-family:var(--mono);font-size:10px;color:var(--text2);letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px">DEBT RECYCLING</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${stat('Effective DR Balance', n2(m.drEffectiveBalance))}
            ${stat('Annual Interest (deductible)', n2(m.drAnnualInterest), 'neg')}
            ${stat(fyLabel(drDivs.curFY)+' Dividend Income',  n2(drDivs.curFYIncome),  'pos')}
            ${stat(fyLabel(drDivs.prevFY)+' Dividend Income', n2(drDivs.prevFYIncome), 'pos')}
            ${stat('Net Cash Flow ('+fyLabel(drDivs.curFY)+')', n2(drDivs.curFYIncome-m.drAnnualInterest), clr(drDivs.curFYIncome-m.drAnnualInterest))}
            ${(()=>{
              // Total Investment = Invested Amount (Buy orders + DRP orders,
              // i.e. full cost basis of currently held units) + Capital Gain.
              // Dividend Income is displayed for reference only and is NOT
              // added in, since DRP amounts are already inside Investment Amount.
              const drpAmount = drCap.costBasis - drCap.investedBuyOnly;
              const totalInv = drCap.costBasis + drCap.lifetimeUnrealised;
              window.__drBreakdown[p.id] = {
                propName: p.name, buyOnly: drCap.investedBuyOnly, drpAmount,
                invested: drCap.costBasis,
                capitalGain: drCap.lifetimeUnrealised, dividends: drDivs.lifetimeIncome,
                total: totalInv,
              };
              return `<div style="cursor:pointer" onclick="showDRTotalBreakdown('${p.id}')" title="Click for breakdown">
                <div style="font-size:10px;color:var(--text3);letter-spacing:.07em;text-transform:uppercase;margin-bottom:2px">Total Investment <span style="text-decoration:underline">ⓘ</span></div>
                <div class="${clr(totalInv)}" style="font-family:var(--mono);font-size:13px;font-weight:600">${n2(totalInv)}</div>
              </div>`;
            })()}
            ${(()=>{
              const capGain = drCap.lifetimeUnrealised;
              const divs    = drDivs.lifetimeIncome;
              const totalGain = capGain + divs;
              window.__drGainBreakdown[p.id] = {
                propName: p.name, currentValue: drCap.currentValue, invested: drCap.costBasis,
                capitalGain: capGain, dividends: divs, total: totalGain,
              };
              return `<div style="cursor:pointer" onclick="showDRGainBreakdown('${p.id}')" title="Click for breakdown">
                <div style="font-size:10px;color:var(--text3);letter-spacing:.07em;text-transform:uppercase;margin-bottom:2px">Total Gain (Capital + Dividends) <span style="text-decoration:underline">ⓘ</span></div>
                <div class="${clr(totalGain)}" style="font-family:var(--mono);font-size:13px;font-weight:600">${n2(totalGain)}</div>
              </div>`;
            })()}
            ${stat('ROI %', (drCap.costBasis>0 ? ((drCap.lifetimeUnrealised+drDivs.lifetimeIncome)/drCap.costBasis*100) : 0).toFixed(2)+'%', clr(drCap.lifetimeUnrealised + drDivs.lifetimeIncome))}
            ${stat('Linked Symbols', (p.drSymbols&&p.drSymbols.length) ? p.drSymbols.map(s=>escHtml(plainSymbol(s))).join(', ') : '—')}
            <div style="grid-column:1/-1;margin-top:2px">
              <button class="btn" style="width:100%;padding:5px 10px;font-size:11px" onclick="showDRPerformance('${p.id}')">FY PERFORMANCE ›</button>
            </div>
          </div>
        </div>`:`<div style="background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:14px;display:flex;align-items:center;justify-content:center">
          <div style="text-align:center;color:var(--text3);font-family:var(--mono);font-size:12px">Primary Residence<br>No rental income</div>
        </div>`)}
      </div>

      ${saleBox}
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

  const gainTint = totalGain >= 0 ? 'var(--asset-teal)' : 'var(--debt-red)';
  const cards = [
    {l:'Property Value',  v:n2(totalVal,0),    s:'neu',            sub:heldProperties.length+' propert'+(heldProperties.length===1?'y':'ies'), fn:'', tint:'var(--cat-property)'},
    {l:'Total Equity',    v:n2(totalEquity,0), s:clr(totalEquity), sub:'Value − loan balance',   fn:'', tint:'var(--asset-forest)'},
    {l:debtLabel,         v:n2(debtVal,0),     s:'neg',            sub:debtSub,                  fn:'togglePropDebt()', tint:'var(--debt-red)'},
    {l:'Unrealised Gain', v:n2(totalGain,0),   s:clr(totalGain),   sub:'vs purchase price',      fn:'', tint:gainTint},
    {l:rentLabel,         v:n2(rentVal,0),     s:'pos',            sub:rentSub,                  fn:'togglePropRent()', tint:'var(--cat-income)'},
    {l:repayLabel,        v:n2(repayVal,0),    s:'neg',            sub:repaySub,                 fn:'togglePropRepay()', tint:'var(--debt-coral)'},
  ];
  $('pw-cards').innerHTML = cards.map(c=>{
    const click = c.fn ? ` onclick="${c.fn}" title="Click to toggle"` : '';
    const style = (c.fn ? 'cursor:pointer;' : '') + cardTint(c.tint);
    return `<div class="card"${click} style="${style}">
      <div class="card-label">${c.l}</div>
      <div class="card-value ${c.s}">${c.v}</div>
      <div class="card-sub">${c.sub}</div>
    </div>`;
  }).join('');
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