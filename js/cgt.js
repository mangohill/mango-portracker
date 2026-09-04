// ── cgt.js ──────────────────────────────────────────────────────────────
// Capital Gains Tracker: FIFO parcel matching + AMIT cost-base adjustments
// + corporate-action continuity + property CGT + ownership split + real
// ATO-style capital loss carry-forward across financial years.
//
// ── ASSUMPTIONS (also shown in the tab itself) ──────────────────────────
// • FIFO parcel matching for stock/ETF/crypto disposals — oldest parcel
//   sold first. The ATO also allows specific-parcel identification with
//   adequate records; this tool doesn't support choosing a different lot.
// • Corporate actions (merger/split/rename/spin-off) recorded in Trades
//   are treated as CGT rollovers: no gain/loss triggered, cost base AND
//   original acquisition date carry over per underlying parcel. This
//   matches how those entries already behave in Holdings, but isn't
//   universally correct tax treatment for every real-world corporate
//   action (e.g. a straight cash takeover IS a CGT event) — check yours.
// • AMIT cost-base adjustments are entered per symbol per distribution
//   (record) date, as a single dollar amount from the fund's tax
//   statement. It's spread across whatever parcels were open on that
//   date, weighted by units. A parcel's cost base is floored at $0 — any
//   amount that would push it negative is capped and flagged rather than
//   auto-converted into a capital gain (which is what the ATO actually
//   does with an over-reduction) — check flagged amounts with your
//   accountant.
// • Capital losses (current year + carried forward) are applied against
//   non-discounted (short-term) gains before discounted (long-term)
//   gains — the most common approach since it preserves more of the 50%
//   discount — then the discount is applied to whatever long-term amount
//   remains. The ATO allows other orderings; you can choose differently
//   at lodgement time.
// • Property CGT cost base = purchase price + purchase costs + capital
//   improvements. Proceeds = sale price − selling costs. Main residence
//   exemption is all-or-nothing (no partial/6-year-rule apportionment).
// • Estimates only — not tax advice. Confirm with your accountant.
// ─────────────────────────────────────────────────────────────────────────

// ── CGT CUTOFF DATE ───────────────────────────────────────────────────
// The Div 296/CGT-indexation legislation splits gains at this one date —
// the 50% discount applies to gains accrued up to it; gains accruing after
// it use cost-base indexation plus a 30% minimum tax-rate floor instead.
// Every place that cares about "the cutoff" — Date comparisons, the sim
// input field, its localStorage key, and the save/load/fetch/auto-snapshot
// functions — reads from this constant and the labels derived from it, so
// modelling a different date (or the real cutoff eventually moving) is a
// one-line change instead of an error-prone find-and-replace.
// CGT_CUTOFF_DATE itself is declared once in helpers.js (loaded before this
// file) since prunePfSnapshotHistory's own tiering also has a "cutoff"
// concept — keeping this one declaration point avoids a duplicate `const`
// across script files. Everything derived from it lives here, next to where
// it's used.
function cgtCutoffDateObj(){ return new Date(CGT_CUTOFF_DATE); }
function cgtFmtDMY(d){ return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear(); }
function cgtFmtLong(d){
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return d.getDate()+' '+MONTHS[d.getMonth()]+' '+d.getFullYear();
}
const CGT_CUTOFF_LABEL = cgtFmtDMY(cgtCutoffDateObj());       // e.g. "30/06/2027"
const CGT_CUTOFF_LABEL_LONG = cgtFmtLong(cgtCutoffDateObj()); // e.g. "30 June 2027"
const CGT_POST_CUTOFF_LABEL_LONG = (()=>{
  const d = cgtCutoffDateObj(); d.setDate(d.getDate()+1); return cgtFmtLong(d); // e.g. "1 July 2027"
})();

// One-time migration: the cutoff-price storage keys used to be named after
// the specific date (pt_price_20270630[_auto_saved]). Copy any existing
// data across to the cutoff-agnostic keys once; the old keys are left in
// place (harmless leftovers) rather than deleted.
(function migrateCgtCutoffStorageKeys(){
  try{
    if(localStorage.getItem('pt_price_cgt_cutoff')==null && localStorage.getItem('pt_price_20270630')!=null){
      localStorage.setItem('pt_price_cgt_cutoff', localStorage.getItem('pt_price_20270630'));
    }
    if(localStorage.getItem('pt_price_cgt_cutoff_auto_saved')==null && localStorage.getItem('pt_price_20270630_auto_saved')!=null){
      localStorage.setItem('pt_price_cgt_cutoff_auto_saved', localStorage.getItem('pt_price_20270630_auto_saved'));
    }
  }catch(e){}
})();

// ── AMIT COST BASE ADJUSTMENTS ───────────────────────────────────────────
// Stored per symbol per distribution (record) date, as entered from each
// fund's annual tax statement.
let amitAdjustments = (()=>{try{return JSON.parse(localStorage.getItem('pt_amit')||'[]');}catch(e){return [];}})();

function saveAmitAdjustments(){ localStorage.setItem('pt_amit', JSON.stringify(amitAdjustments)); }

function addAmitAdjustment(symbol, date, amount, notes){
  symbol = (symbol||'').trim().toUpperCase();
  if(!symbol || !date || isNaN(+amount)){ notify('Symbol, date and amount are required.','err'); return false; }
  amitAdjustments.push({ id: uid(), symbol, date, amount: +amount, notes: (notes||'').trim() });
  saveAmitAdjustments();
  return true;
}
function deleteAmitAdjustment(id){
  amitAdjustments = amitAdjustments.filter(a=>String(a.id)!==String(id));
  saveAmitAdjustments();
}

function getCGTLossCarryIn(){
  try{ return JSON.parse(localStorage.getItem('pt_cgt_loss_carry_in')||'{}'); }catch(e){ return {}; }
}
function saveCGTLossCarryIn(o){ localStorage.setItem('pt_cgt_loss_carry_in', JSON.stringify(o)); }

// Generic ownership share (100% / 50%-joint / 0%) off a raw owner key
// rather than a symbol — used for properties, which store a single owner
// field the same way stock ownership does.
function shareForOwner(ownerKey, person){
  if(ownerKey === person) return 1.0;
  if(ownerKey === 'joint') return 0.5;
  return 0.0;
}

// ── FIFO PARCEL ENGINE (stocks/ETFs/crypto) ─────────────────────────────
// Walks every trade + every AMIT adjustment in chronological order,
// maintaining open parcels per symbol (with continuity through corporate
// actions), consuming them FIFO on each sell.
function buildDisposals(){
  const parcels = {};    // symbol -> [{units, cost, date}]
  const disposals = [];  // [{symbol, saleDate, unitsSold, proceeds, costConsumed, gain, lots, shortfallUnits}]
  const amitLog = [];    // [{symbol, date, amount, capped}]

  const events = [];
  for(const t of trades) events.push({ ...t, _kind:'trade', _sortDate:t.date });
  for(const a of amitAdjustments) events.push({ _kind:'amit', symbol:a.symbol, date:a.date, amount:+a.amount, _sortDate:a.date });

  events.sort((a,b)=>{
    const d = a._sortDate.localeCompare(b._sortDate);
    if(d !== 0) return d;
    if(a._kind==='amit' && b._kind!=='amit') return 1; // adjustment applies at end of that day
    if(b._kind==='amit' && a._kind!=='amit') return -1;
    if(a._kind==='trade' && b._kind==='trade'){
      const aFrom = (a.subtype||'').endsWith('_from') ? -1 : 0;
      const bFrom = (b.subtype||'').endsWith('_from') ? -1 : 0;
      return aFrom - bFrom;
    }
    return 0;
  });

  const ensure = sym => (parcels[sym] = parcels[sym] || []);
  let seq = 0;

  for(const e of events){
    if(e._kind === 'amit'){
      const list = ensure(e.symbol).filter(p=>p.units > 0.000001);
      const totalUnits = list.reduce((s,p)=>s+p.units,0);
      if(totalUnits <= 0) continue; // nothing held on this record date — nothing to adjust
      let capped = 0;
      list.forEach(p=>{
        const share = e.amount * (p.units / totalUnits);
        let newCost = p.cost + share; // negative amount = cost-base decrease (typical case)
        let applied = share;
        if(newCost < 0){ applied = -p.cost; capped += -newCost; newCost = 0; }
        p.cost = newCost;
        p.amitTotal = (p.amitTotal||0) + applied;
      });
      if(capped > 0.005) amitLog.push({ symbol:e.symbol, date:e.date, amount:e.amount, capped });
      continue;
    }

    const t = e, sym = t.symbol;

    if(t.type === 'buy' || t.type === 'drp'){
      const buyCost = (+t.units * +t.price) + (+t.fees||0);
      ensure(sym).push({ id:'p'+(seq++), units:+t.units, cost:buyCost, originalCost:buyCost, amitTotal:0, date:t.date, source:t.type });

    } else if(t.type === 'sell'){
      let unitsToSell = +t.units;
      const saleDate = t.date;
      const proceeds = (unitsToSell * +t.price) - (+t.fees||0);
      const list = ensure(sym);
      const lots = [];
      let costConsumed = 0, i = 0;
      while(unitsToSell > 0.000001 && i < list.length){
        const p = list[i];
        if(p.units <= 0.000001){ i++; continue; }
        const take = Math.min(p.units, unitsToSell);
        const takeCost = p.cost * (take / p.units);
        const heldDays = (new Date(saleDate) - new Date(p.date)) / 86400000;
        const longTerm = heldDays > 365;
        const lotProceeds = proceeds * (take / (+t.units || 1));
        lots.push({ units:take, cost:takeCost, buyDate:p.date, longTerm, heldDays:Math.round(heldDays),
                     proceeds:lotProceeds, gain:+(lotProceeds - takeCost).toFixed(4) });
        costConsumed += takeCost;
        const takeRatio = take / p.units;
        p.originalCost = (p.originalCost||p.cost) * (1 - takeRatio);
        p.amitTotal = (p.amitTotal||0) * (1 - takeRatio);
        p.units -= take; p.cost -= takeCost;
        unitsToSell -= take;
        if(p.units <= 0.000001) i++;
      }
      parcels[sym] = list.filter(p=>p.units > 0.000001);
      const shortfallUnits = unitsToSell > 0.000001 ? unitsToSell : 0;
      disposals.push({
        symbol: sym, saleDate, unitsSold:+t.units, proceeds, costConsumed,
        gain:+(proceeds - costConsumed).toFixed(4), lots, shortfallUnits, tradeId:t.id,
      });

    } else if(t.type === 'corporate_action'){
      const sub = t.subtype || '';
      if(sub.endsWith('_from')){
        parcels['_stash_'+sym] = ensure(sym).map(p=>({ ...p }));
        parcels[sym] = [];
      } else if(sub.endsWith('_to')){
        const fromSym = t.fromSymbol || sym;
        const stash = parcels['_stash_'+fromSym] || [];
        const allocPct = t.allocPct != null ? (+t.allocPct/100) : 1;
        const destList = ensure(sym);
        if(t.overrideCostBasis){
          const earliest = stash.length ? stash.reduce((a,b)=> a.date < b.date ? a : b).date : t.date;
          destList.push({ id:'p'+(seq++), units:+t.units, cost:+t.overrideCostBasis, originalCost:+t.overrideCostBasis, amitTotal:0, date:earliest, source:'buy' });
        } else if(sub === 'spinoff_to'){
          const stashUnits = stash.reduce((s,p)=>s+p.units,0) || 1;
          stash.forEach(p=>{
            destList.push({ id:'p'+(seq++), units: p.units*(+t.units/stashUnits), cost: p.cost*allocPct,
                            originalCost:(p.originalCost||p.cost)*allocPct, amitTotal:(p.amitTotal||0)*allocPct, date:p.date, source:p.source });
          });
        } else {
          const stashUnits = stash.reduce((s,p)=>s+p.units,0) || 1;
          const ratioUnits = +t.units / stashUnits;
          stash.forEach(p=>{
            destList.push({ id:'p'+(seq++), units: p.units*ratioUnits, cost: p.cost,
                            originalCost:(p.originalCost!=null?p.originalCost:p.cost), amitTotal:(p.amitTotal||0), date:p.date, source:p.source });
          });
        }
        if(sub === 'spinoff_to'){
          const parentList = ensure(fromSym);
          stash.forEach(p=> parentList.push({ ...p, cost: p.cost*(1-allocPct),
                                               originalCost:(p.originalCost||p.cost)*(1-allocPct), amitTotal:(p.amitTotal||0)*(1-allocPct) }));
        }
        delete parcels['_stash_'+fromSym];
      }
    }
  }

  return { disposals, amitLog, openParcels: parcels };
}

// ── PROPERTY CGT ──────────────────────────────────────────────────────────
function buildPropertyDisposals(){
  return (typeof properties!=='undefined' ? properties : [])
    .filter(p => p.sold && p.soldDate)
    .map(p=>{
      if(p.mainResExempt){
        return { id:p.id, name:p.name, owner:p.owner||'lumia', soldDate:p.soldDate,
                 exempt:true, gain:0, longTerm:false, proceeds:0, costBase:0 };
      }
      const costBase = (+p.purchasePrice||0) + (+p.purchaseCosts||0) + (+p.capitalImprovements||0);
      const proceeds = (+p.salePrice||0) - (+p.sellingCosts||0);
      const heldDays = (new Date(p.soldDate) - new Date(p.purchaseDate||p.soldDate)) / 86400000;
      return {
        id:p.id, name:p.name, owner:p.owner||'lumia', soldDate:p.soldDate,
        exempt:false, costBase, proceeds, gain:+(proceeds-costBase).toFixed(2),
        longTerm: heldDays > 365, heldDays:Math.round(heldDays),
      };
    });
}

// ── FY SUMMARY WITH REAL LOSS CARRY-FORWARD ─────────────────────────────
// For each person: bucket every gain/loss lot (stock lots + property
// disposals) attributed to them by ownership share into its FY, then walk
// FYs chronologically applying losses (current year, then prior carry-
// forward) against short-term gains first, then long-term — THEN apply
// the 50% discount to whatever long-term amount remains.
function computeCGTSummary(){
  const { disposals, amitLog, openParcels } = buildDisposals();
  const propDisposals = buildPropertyDisposals();
  const persons = getAllPersons();
  const carryInSettings = getCGTLossCarryIn();

  const byPersonFY = {};
  function bucket(person, fy){
    byPersonFY[person] = byPersonFY[person] || {};
    byPersonFY[person][fy] = byPersonFY[person][fy] || { shortGain:0, longGain:0, losses:0 };
    return byPersonFY[person][fy];
  }

  for(const d of disposals){
    const fy = dateToFY(d.saleDate);
    const owner = getSymbolOwner(d.symbol);
    for(const person of persons){
      const share = shareForOwner(owner, person);
      if(share <= 0) continue;
      const b = bucket(person, fy);
      for(const lot of d.lots){
        const g = lot.gain * share;
        if(g >= 0){ if(lot.longTerm) b.longGain += g; else b.shortGain += g; }
        else b.losses += -g;
      }
    }
  }
  for(const p of propDisposals){
    if(p.exempt) continue;
    const fy = dateToFY(p.soldDate);
    for(const person of persons){
      const share = shareForOwner(p.owner, person);
      if(share <= 0) continue;
      const b = bucket(person, fy);
      const g = p.gain * share;
      if(g >= 0){ if(p.longTerm) b.longGain += g; else b.shortGain += g; }
      else b.losses += -g;
    }
  }

  const result = {};
  for(const person of persons){
    const fys = Object.keys(byPersonFY[person]||{}).map(Number).sort((a,b)=>a-b);
    if(!fys.length) continue;
    result[person] = {};
    const opening = carryInSettings[person];
    let carry = (opening && fys.length && +opening.amount>0 && +opening.fy<=fys[0]) ? +opening.amount : 0;

    for(const fy of fys){
      const b = byPersonFY[person][fy];
      const pool = b.losses + carry;
      const offsetShort = Math.min(b.shortGain, pool);
      let remaining = pool - offsetShort;
      const netShort = b.shortGain - offsetShort;
      const offsetLong = Math.min(b.longGain, remaining);
      remaining -= offsetLong;
      const netLongPreDiscount = b.longGain - offsetLong;
      const discountedLong = netLongPreDiscount * 0.5;
      const netCapitalGain = netShort + discountedLong;
      const lossCarryOut = remaining;

      result[person][fy] = {
        shortGain: b.shortGain, longGain: b.longGain, losses: b.losses,
        lossCarryIn: carry, netShort, netLongPreDiscount, discountedLong,
        netCapitalGain, lossCarryOut,
      };
      carry = lossCarryOut;
    }
  }

  return { disposals, propDisposals, amitLog, byPersonFY, result, persons, openParcels };
}

// ── CURRENT COST BASE (AMIT-adjusted) — built standalone so the search box
// can trigger a partial re-render of just the list, not the whole CGT panel
// (a full renderCGT() on every keystroke would blow away input focus).
function computeCostBaseRows(openParcels){
  return Object.entries(openParcels)
    .filter(([sym,list])=> !sym.startsWith('_stash_') && list.reduce((s,p)=>s+p.units,0) > 0.000001)
    .map(([sym,list])=>{
      const units    = list.reduce((s,p)=>s+p.units,0);
      const adjCost  = list.reduce((s,p)=>s+p.cost,0);
      const origCost = list.reduce((s,p)=>s+(p.originalCost!=null?p.originalCost:p.cost),0);
      const amitTot  = list.reduce((s,p)=>s+(p.amitTotal||0),0);
      return { sym, units, origCost, amitTot, adjCost, parcels:list };
    })
    .sort((a,b)=>a.sym.localeCompare(b.sym));
}

function buildCostBaseHtml(openParcels){
  const costBaseRows = computeCostBaseRows(openParcels);
  const filtered = costBaseRows
    .filter(r=> !cgtCostBaseSearch || r.sym.toUpperCase().includes(cgtCostBaseSearch.trim().toUpperCase()))
    .filter(r=> cgtCostBaseFilter !== 'adjusted' || Math.abs(r.amitTot) > 0.005);
  return filtered.length ? filtered.map(r=>{
    const expanded = !!cgtCostBaseExpanded[r.sym];
    return `
    <div style="border:1px solid var(--border);border-radius:6px;margin-bottom:8px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:10px 14px;background:var(--surface2);cursor:pointer"
           onclick="cgtCostBaseExpanded['${r.sym}']=!cgtCostBaseExpanded['${r.sym}'];renderCostBaseList()">
        <span style="font-family:var(--mono);font-weight:700">${escHtml(r.sym)}</span>
        <span style="font-size:11px;color:var(--text3)">${nN(r.units,6)} units held</span>
        <span style="font-size:11px;color:var(--text3)">Original cost: ${n2(r.origCost)}</span>
        <span style="font-size:11px" class="${r.amitTot>=0?'pos':'neg'}">AMIT adj: ${r.amitTot>=0?'+':''}${n2(r.amitTot)}</span>
        <span style="margin-left:auto;font-family:var(--mono);font-weight:700">Adjusted cost base: ${n2(r.adjCost)}</span>
        <span style="font-size:11px;color:var(--text3)">(${n2(r.units?r.origCost/r.units:0,4)}/unit → ${n2(r.units?r.adjCost/r.units:0,4)}/unit)</span>
        <span style="color:var(--text3);font-size:11px">${expanded?'▲':'▼'}</span>
      </div>
      ${expanded ? `
      <div style="padding:10px 14px">
        <table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px">
          <thead><tr style="color:var(--text3);border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:4px">BUY DATE</th>
            <th style="text-align:right;padding:4px">UNITS</th>
            <th style="text-align:right;padding:4px">ORIGINAL COST</th>
            <th style="text-align:right;padding:4px">ORIGINAL $/UNIT</th>
            <th style="text-align:right;padding:4px">AMIT ADJ</th>
            <th style="text-align:right;padding:4px">ADJUSTED COST</th>
            <th style="text-align:right;padding:4px">ADJUSTED $/UNIT</th>
          </tr></thead>
          <tbody>
            ${r.parcels.map(p=>{
              const origCostP = p.originalCost!=null?p.originalCost:p.cost;
              return `<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:4px">${p.date}</td>
              <td style="text-align:right;padding:4px">${nN(p.units,6)}</td>
              <td style="text-align:right;padding:4px">${n2(origCostP)}</td>
              <td style="text-align:right;padding:4px">${n2(p.units?origCostP/p.units:0,4)}</td>
              <td style="text-align:right;padding:4px" class="${(p.amitTotal||0)>=0?'pos':'neg'}">${(p.amitTotal||0)>=0?'+':''}${n2(p.amitTotal||0)}</td>
              <td style="text-align:right;padding:4px;font-weight:700">${n2(p.cost)}</td>
              <td style="text-align:right;padding:4px">${n2(p.units?p.cost/p.units:0,4)}</td>
            </tr>`;}).join('')}
          </tbody>
        </table>
      </div>` : ''}
    </div>`;
  }).join('') : `<div class="empty"><div class="empty-icon">📗</div>${
    !costBaseRows.length ? 'No open holdings with tracked parcels yet'
    : cgtCostBaseFilter==='adjusted' ? 'No holdings have an AMIT adjustment applied yet'
    : 'No symbols match "'+escHtml(cgtCostBaseSearch)+'"'
  }</div>`;
}

// Partial re-render: only touches the list container, so typing in the
// search box (oninput) never loses focus the way a full renderCGT() would.
function renderCostBaseList(){
  const el = $('cgt-costbase-list');
  if(!el) return; // section collapsed or not on this tab
  const { openParcels } = computeCGTSummary();
  el.innerHTML = buildCostBaseHtml(openParcels);
}

function cgtClearCostBaseSearch(){
  cgtCostBaseSearch = '';
  const input = $('cgt-costbase-search');
  if(input) input.value = '';
  renderCostBaseList();
}

// ── AMIT COST-BASE ADJUSTMENTS table — search-filtered, built standalone
// (same reasoning as the cost-base list) so typing in the search box only
// re-renders the table body, not the whole panel.
function buildAmitBodyHtml(){
  const amitSortState = getSort('amit');
  let rows = amitSortState.col
    ? sortRows(amitAdjustments, amitSortState.col, amitSortState.dir)
    : [...amitAdjustments].sort((a,b)=>b.date.localeCompare(a.date));
  if(cgtAmitSearch.trim()){
    const q = cgtAmitSearch.trim().toUpperCase();
    rows = rows.filter(a=>(a.symbol||'').toUpperCase().includes(q));
  }
  if(!rows.length){
    const msg = cgtAmitSearch.trim()
      ? `No AMIT adjustments found for "${escHtml(cgtAmitSearch)}".`
      : 'No AMIT adjustments recorded yet.';
    return `<tr><td colspan="5" class="empty">${msg}</td></tr>`;
  }
  return rows.map(a=>`<tr>
    <td>${a.date}</td>
    <td><b>${escHtml(a.symbol)}</b></td>
    <td style="color:${a.amount>=0?'var(--green)':'var(--red)'}">${a.amount>=0?'+':''}${n2(a.amount)}</td>
    <td style="color:var(--text3);font-size:11px">${escHtml(a.notes)}</td>
    <td style="white-space:nowrap">
      <button class="del-btn" onclick="editAmitAdjustment('${a.id}')" title="Edit">✎</button>
      <button class="del-btn" onclick="deleteAmitAdjustment('${a.id}');renderCGT()" title="Delete">✕</button>
    </td>
  </tr>`).join('');
}

function renderAmitTable(){
  const el = $('cgt-amit-tbody');
  if(!el) return; // section collapsed or not on this tab
  el.innerHTML = buildAmitBodyHtml();
}

function cgtClearAmitSearch(){
  cgtAmitSearch = '';
  const input = $('cgt-amit-search');
  if(input) input.value = '';
  renderAmitTable();
}

// ── RENDER ────────────────────────────────────────────────────────────
let cgtFY = null;
let cgtExpanded = {};
let cgtSymFilter = '';
let cgtCostBaseExpanded = {};
let cgtCostBaseSearch = '';
let cgtCostBaseFilter = 'all'; // 'all' | 'adjusted'
let cgtAmitCollapsed = false;
let cgtCostBaseCollapsed = false;
let cgtAmitSearch = '';
let cgtLastSim = null;
let cgtFifoCollapsed = true;

function renderCGT(){
  const panel = $('panel-cgt');
  if(!panel) return;

  const summary = computeCGTSummary();
  const { disposals, propDisposals, amitLog, result, persons, openParcels } = summary;

  const allFYs = [...new Set([
    ...disposals.map(d=>dateToFY(d.saleDate)),
    ...propDisposals.filter(p=>!p.exempt).map(p=>dateToFY(p.soldDate)),
  ])].sort((a,b)=>b-a);

  if(cgtFY == null) cgtFY = allFYs[0] || dateToFY(new Date().toISOString().slice(0,10));

  const fyPillsHtml = allFYs.length
    ? allFYs.map(fy=>`<span class="ca-pill${fy===cgtFY?' active':''}" onclick="cgtFY=${fy};cgtExpanded={};renderCGT()">FY${fy}</span>`).join('')
    : '<span style="color:var(--text3);font-family:var(--mono);font-size:12px">No disposals recorded yet</span>';

  const personCards = persons.map(person=>{
    const r = (result[person]||{})[cgtFY];
    if(!r) return '';
    return `
    <div class="card">
      <div class="card-label">${getPersonLabel(person)} — NET CAPITAL GAIN</div>
      <div class="card-value ${clr(r.netCapitalGain)}">${n2(r.netCapitalGain)}</div>
      <div class="card-sub">
        Short: ${n2(r.netShort)} · Long (post-discount): ${n2(r.discountedLong)}
        ${r.lossCarryOut > 0.005 ? '<br>Loss carried to next FY: ' + n2(r.lossCarryOut) : ''}
        ${r.lossCarryIn > 0.005 ? '<br>Loss carried in: ' + n2(r.lossCarryIn) : ''}
      </div>
    </div>`;
  }).join('');

  const amitWarnings = amitLog.filter(a=>dateToFY(a.date)===cgtFY);
  const amitWarningHtml = amitWarnings.length ? `
    <div class="fs" style="border-color:var(--gold);margin-bottom:16px">
      <div class="fst" style="color:var(--gold)">⚠ AMIT ADJUSTMENT CAPPED</div>
      ${amitWarnings.map(a=>`<div style="font-family:var(--mono);font-size:12px;margin-bottom:6px">
        <b>${escHtml(a.symbol)}</b> ${a.date} — entered adjustment ${n2(a.amount)}, but ${n2(a.capped)}
        of it would have pushed cost base below $0. That excess wasn't applied — the ATO treats an
        over-reduction as an extra capital gain in that year, which this tool doesn't auto-add.
        Check with your accountant.
      </div>`).join('')}
    </div>` : '';

  const fyDisposals = disposals.filter(d=>dateToFY(d.saleDate)===cgtFY)
    .filter(d=>!cgtSymFilter || d.symbol===cgtSymFilter)
    .sort((a,b)=>a.saleDate.localeCompare(b.saleDate));

  const symOptions = [...new Set(disposals.filter(d=>dateToFY(d.saleDate)===cgtFY).map(d=>d.symbol))].sort();

  const disposalsHtml = fyDisposals.length ? fyDisposals.map((d)=>{
    const gidx = disposals.indexOf(d);
    const expanded = !!cgtExpanded[gidx];
    const owner = getSymbolOwner(d.symbol);
    return `
    <div style="border:1px solid var(--border);border-radius:6px;margin-bottom:8px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;background:var(--surface2);cursor:pointer"
           onclick="cgtExpanded[${gidx}]=!cgtExpanded[${gidx}];renderCGT()">
        <span style="font-family:var(--mono);font-weight:700">${escHtml(d.symbol)}</span>
        <span style="font-size:11px;color:var(--text3)">${d.saleDate}</span>
        <span style="font-size:11px;color:var(--text3)">${nN(d.unitsSold,6)} units @ ${n2(d.proceeds/(d.unitsSold||1),4)}</span>
        <span style="font-size:11px;color:var(--text3)">Owner: ${getPersonLabel(owner)}</span>
        <span style="margin-left:auto;font-family:var(--mono);font-weight:700" class="${clr(d.gain)}">${n2(d.gain)}</span>
        <span style="color:var(--text3);font-size:11px">${expanded?'▲':'▼'}</span>
      </div>
      ${expanded ? `
      <div style="padding:10px 14px">
        <table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px">
          <thead><tr style="color:var(--text3);border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:4px">BUY DATE</th>
            <th style="text-align:right;padding:4px">UNITS</th>
            <th style="text-align:right;padding:4px">COST BASE</th>
            <th style="text-align:right;padding:4px">PROCEEDS</th>
            <th style="text-align:right;padding:4px">GAIN/LOSS</th>
            <th style="text-align:right;padding:4px">HELD</th>
            <th style="text-align:right;padding:4px">DISCOUNT</th>
            <th style="text-align:right;padding:4px">FINAL (NET CG)</th>
          </tr></thead>
          <tbody>
            ${d.lots.map(l=>`<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:4px">${l.buyDate}</td>
              <td style="text-align:right;padding:4px">${nN(l.units,6)}</td>
              <td style="text-align:right;padding:4px">${n2(l.cost)}</td>
              <td style="text-align:right;padding:4px">${n2(l.proceeds)}</td>
              <td style="text-align:right;padding:4px" class="${clr(l.gain)}">${n2(l.gain)}</td>
              <td style="text-align:right;padding:4px">${l.heldDays}d</td>
              <td style="text-align:right;padding:4px">${l.longTerm && l.gain>0 ? '<span class="badge b-etf">50%</span>' : (l.longTerm?'<span style="color:var(--text3)">n/a (loss)</span>':'—')}</td>
              <td style="text-align:right;padding:4px;font-weight:700" class="${clr(l.longTerm && l.gain>0 ? l.gain*0.5 : l.gain)}">${n2(l.longTerm && l.gain>0 ? l.gain*0.5 : l.gain)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        ${d.shortfallUnits>0.000001?`<div style="color:var(--red);font-size:11px;margin-top:8px">⚠ ${nN(d.shortfallUnits,6)} units sold had no matching buy parcel on record — cost base for that portion is treated as $0. Check your trade history for missing buys.</div>`:''}
      </div>` : ''}
    </div>`;
  }).join('') : '<div class="empty"><div class="empty-icon">📉</div>No stock/ETF/crypto disposals in FY'+cgtFY+'</div>';

  const fyProps = propDisposals.filter(p=>dateToFY(p.soldDate)===cgtFY);
  const propsHtml = fyProps.length ? `
    <div class="tw">
      <div class="th"><span class="tt">PROPERTY DISPOSALS — FY${cgtFY}</span></div>
      <div class="ovx"><table>
        <thead><tr><th>PROPERTY</th><th>SOLD</th><th>OWNER</th><th>COST BASE</th><th>PROCEEDS</th><th>GAIN/LOSS</th><th>DISCOUNT</th><th>FINAL (NET CG)</th></tr></thead>
        <tbody>
          ${fyProps.map(p=>`<tr>
            <td><b>${escHtml(p.name)}</b></td>
            <td>${p.soldDate}</td>
            <td>${getPersonLabel(p.owner)}</td>
            <td>${p.exempt?'—':n2(p.costBase)}</td>
            <td>${p.exempt?'—':n2(p.proceeds)}</td>
            <td class="${p.exempt?'neu':clr(p.gain)}">${p.exempt?'Exempt (main residence)':n2(p.gain)}</td>
            <td>${p.exempt?'—':(p.longTerm&&p.gain>0?'<span class="badge b-etf">50%</span>':(p.longTerm?'n/a (loss)':'—'))}</td>
            <td style="font-weight:700" class="${p.exempt?'neu':clr(p.longTerm && p.gain>0 ? p.gain*0.5 : p.gain)}">${p.exempt?'—':n2(p.longTerm && p.gain>0 ? p.gain*0.5 : p.gain)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>` : '';

  const symbolsInUse = [...new Set(trades.map(t=>t.symbol).filter(Boolean))].sort();
  const amitBodyHtml = buildAmitBodyHtml();

  // ── CURRENT COST BASE (AMIT-adjusted, per currently-held symbol) ──────
  const costBaseHtml = buildCostBaseHtml(openParcels);

  // FIFO vs LIFO summary (sell now using current prices)
  const fifoLifoRows = computeFIFOvsLIFOSummary(openParcels);
  const fifoLifoHtml = fifoLifoRows.length ? `
    <div class="ovx"><table>
      <thead><tr>
        <th>SYMBOL</th>
        <th style="text-align:right">UNITS</th>
        <th style="text-align:right">PRICE</th>
        <th style="text-align:right">FIFO TAXABLE</th>
        <th style="text-align:right">LIFO TAXABLE</th>
        <th style="text-align:right">FIFO @30%</th>
        <th style="text-align:right">LIFO @30%</th>
        <th style="text-align:right">BETTER</th>
      </tr></thead>
      <tbody>
        ${fifoLifoRows.map(r=>`<tr>
          <td><b>${escHtml(r.sym)}</b></td>
          <td style="text-align:right">${nN(r.units,6)}</td>
          <td style="text-align:right">${n2(r.price)}</td>
          <td style="text-align:right" class="${clr(r.fifo.taxable)}">${n2(r.fifo.taxable)}</td>
          <td style="text-align:right" class="${clr(r.lifo.taxable)}">${n2(r.lifo.taxable)}</td>
          <td style="text-align:right">${n2(r.fifoTax30)}</td>
          <td style="text-align:right">${n2(r.lifoTax30)}</td>
          <td style="text-align:right">${r.better}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  ` : '<div class="empty"><div class="empty-icon">🔁</div>No open holdings to simulate.</div>';

  const carryInSettings = getCGTLossCarryIn();
  const carryInHtml = persons.map(person=>{
    const c = carryInSettings[person] || {};
    return `<div class="fgi">
      <label class="fl">${getPersonLabel(person)} — Opening Capital Loss Carry-Forward</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="fi" type="number" step="any" min="0" placeholder="Amount"
          id="cgt-carryin-amt-${person}" value="${c.amount||''}" style="flex:1;min-width:100px">
        <input class="fi" type="number" step="1" placeholder="As at FY (e.g. ${dateToFY(new Date().toISOString().slice(0,10))})"
          id="cgt-carryin-fy-${person}" value="${c.fy||''}" style="flex:1;min-width:150px">
      </div>
    </div>`;
  }).join('');

  // Pending PDF-parsed entries awaiting review/confirmation
  const pdfPendingHtml = (amitPdfPending.length) ? `
    <div class="fs" style="border-color:var(--gold);margin-bottom:14px">
      <div class="fst" style="color:var(--gold)">📄 PARSED FROM PDF — REVIEW BEFORE ADDING</div>
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:10px">
        Auto-extracted from the statement text — double-check the symbol, date and amount
        against the PDF before adding (parsing can misread unusual layouts). Edit any field directly.
      </div>
      ${amitPdfPending.map((p,idx)=>`
        <div style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;padding:10px;background:var(--surface2);border-radius:6px;margin-bottom:8px">
          <div class="fgi" style="flex:0 0 90px"><label class="fl">Symbol</label>
            <input class="fi" value="${escHtml(p.symbol)}" oninput="amitPdfPending[${idx}].symbol=this.value.toUpperCase()"></div>
          <div class="fgi" style="flex:0 0 140px"><label class="fl">Record Date</label>
            <input class="fi" type="date" value="${p.date||''}" oninput="amitPdfPending[${idx}].date=this.value"></div>
          <div class="fgi" style="flex:0 0 120px"><label class="fl">Adjustment ($)</label>
            <input class="fi" type="number" step="any" value="${p.amount}" oninput="amitPdfPending[${idx}].amount=parseFloat(this.value)||0"></div>
          <div class="fgi" style="flex:1 1 160px"><label class="fl">Notes</label>
            <input class="fi" value="${escHtml(p.notes)}" oninput="amitPdfPending[${idx}].notes=this.value"></div>
          <div style="font-size:10px;color:var(--text3);flex:0 0 100%;margin-top:-4px">
            source: ${escHtml(p.filename)}${p.warning?' · <span style="color:var(--gold)">'+escHtml(p.warning)+'</span>':''}
          </div>
          <button class="btn btn-g" style="padding:5px 12px;font-size:11px" onclick="cgtConfirmPdfEntry(${idx})">✓ Add</button>
          <button class="btn" style="padding:5px 12px;font-size:11px;color:var(--text3)" onclick="cgtDiscardPdfEntry(${idx})">Discard</button>
        </div>
      `).join('')}
      ${amitPdfPending.length>1 ? '<button class="btn btn-g" onclick="cgtConfirmAllPdfEntries()">✓ ADD ALL</button>' : ''}
    </div>` : '';

  panel.innerHTML = `
    <div class="fs" style="border-color:var(--border2);margin-bottom:16px">
      <div class="fst">📉 CAPITAL GAINS — ASSUMPTIONS</div>
      <div style="font-family:var(--mono);font-size:11px;color:var(--text2);line-height:1.7">
                Estimates only — not tax advice. Confirm with your accountant.<br><br>
        <b>Core rules:</b> FIFO parcel matching · corporate actions treated as CGT-free rollovers (cost base + acquisition date carry over) ·
        capital losses offset short-term gains before long-term, then the 50% discount is applied ·
        AMIT cost base floored at $0 (any excess is flagged, not auto-realised as a gain).<br><br>
        <b>From ${CGT_POST_CUTOFF_LABEL_LONG}:</b> Gains accrued up to ${CGT_CUTOFF_LABEL_LONG} continue to receive the 50% CGT discount (if held &gt;12 months).
        Gains accruing from ${CGT_POST_CUTOFF_LABEL_LONG} are calculated with cost-base indexation and are subject to a 30% minimum tax rate floor on that post-cutoff portion.
        The simulation section lets you model this split using a price at ${CGT_CUTOFF_LABEL} and CPI / cumulative inflation inputs.
      </div>
    </div>

    ${amitWarningHtml}

    <div class="fr" style="margin-bottom:16px;flex-wrap:wrap">${fyPillsHtml}</div>

    <div class="cards">${personCards || '<div class="empty">No CGT events recorded yet.</div>'}</div>

    <div class="tw">
      <div class="th">
        <span class="tt">STOCK / ETF / CRYPTO DISPOSALS — FY${cgtFY}</span>
        <select class="fsm" onchange="cgtSymFilter=this.value;renderCGT()">
          <option value="">All symbols</option>
          ${symOptions.map(s=>`<option value="${s}" ${s===cgtSymFilter?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <div style="padding:12px">${disposalsHtml}</div>
    </div>

    ${propsHtml}

    <div class="fs" style="margin-top:16px">
      <div class="fst" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between" onclick="cgtFifoCollapsed=!cgtFifoCollapsed;renderCGT()">
        <span>FIFO vs LIFO — SELL NOW (uses current prices)</span>
        <span style="color:var(--text3);font-size:10px">${cgtFifoCollapsed?'▼ show':'▲ hide'}</span>
      </div>
      ${cgtFifoCollapsed ? '' : `
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:8px">
        Estimates only. 50% discount applies to long-term gains up to ${CGT_CUTOFF_LABEL}. Post-cutoff portions are inferred and treated using indexation + 30% minimum where applicable.
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:end">
        <div class="fgi" style="flex:0 0 160px"><label class="fl">Symbol</label>
          <select class="fi" id="cgt-sim-symbol" onchange="cgtUpdateSlider()">${symbolsInUse.map(sym=>`<option value="${sym}">${sym}</option>`).join('')}</select></div>
        <div class="fgi" style="flex:0 0 200px"><label class="fl">Sell by</label>
          <div style="display:flex;gap:6px">
            <select class="fi" id="cgt-sim-mode" style="flex:0 0 120px" onchange="cgtUpdateSlider()">
              <option value="units">Units</option>
              <option value="dollars">Dollars</option>
            </select>
            <input class="fi" id="cgt-sim-units" type="number" step="any" placeholder="Blank = all" style="flex:1"
                   oninput="cgtSyncUnitsFromInput(this)">
          </div>
        </div>
        <div class="fgi" style="flex:0 0 180px"><label class="fl">Sale price / unit ($)</label>
          <input class="fi" id="cgt-sim-price" type="number" step="any" placeholder="Leave empty = current price" onchange="cgtRunSimulation()"></div>
        <div class="fgi" style="flex:0 0 220px"><label class="fl">Price on ${CGT_CUTOFF_LABEL} ($)</label>
          <div style="display:flex;gap:6px"><input class="fi" id="cgt-sim-price-cutoff" type="number" step="any" placeholder="Optional - stored per symbol" onchange="(function(){ cgtSaveCutoffPrice(); cgtRunSimulation(); })()">
          <button class="btn" onclick="cgtFetchCutoffPrice()">Fetch</button></div></div>
        <div class="fgi" style="flex:0 0 180px"><label class="fl">Sell date</label>
          <input class="fi" type="date" id="cgt-sim-selldate" value="${new Date().toISOString().slice(0,10)}" onchange="cgtUpdateSlider(); cgtRunSimulation();"></div>
        <div style="width:100%">
          <input type="range" id="cgt-sim-slider" min="0" max="0" step="1" oninput="cgtSyncSliderChange(this)" disabled>
          <div style="font-size:11px;color:var(--text3);margin-top:6px">Selected: <span id="cgt-sim-slider-val">—</span></div>
        </div>
        <div class="fgi" style="flex:0 0 160px"><label class="fl">Person</label>
          <select class="fi" id="cgt-sim-person" onchange="cgtOnPersonChange()">${persons.map(p=>`<option value="${p}">${getPersonLabel(p)}</option>`).join('')}</select></div>
        <div class="fgi" style="flex:0 0 200px"><label class="fl">Person annual taxable income</label>
          <input class="fi" id="cgt-sim-income" type="number" step="any" placeholder="e.g. 90000" oninput="(function(){ const el=$('cgt-sim-income-note'); if(el) el.textContent=''; })()">
          <div id="cgt-sim-income-note" style="font-size:11px;color:var(--text3);margin-top:4px"></div>
        </div>
        <div class="fgi" style="flex:0 0 140px"><label class="fl">Marginal tax % (override)</label>
          <input class="fi" id="cgt-sim-marginal-rate" type="number" step="any" placeholder="Auto from prev FY" onchange="cgtRunSimulation()"></div>
        <div class="fgi" style="flex:0 0 140px"><label class="fl">CPI % (annual) <span title="Annual CPI used to compound from ${CGT_CUTOFF_LABEL} to sale when cumulative inflation not provided">ℹ</span></label>
          <input class="fi" id="cgt-sim-cpi" type="number" step="any" value="2.5" onchange="cgtRunSimulation()"></div>
        <div class="fgi" style="flex:0 0 220px"><label class="fl">Cumulative inflation (cutoff→sale) % (optional) <span title="Provide the total inflation between ${CGT_CUTOFF_LABEL} and the sale (e.g. 8 for 8%). If left blank, the app will compound the annual CPI over the exact period.">ℹ</span></label>
          <input class="fi" id="cgt-sim-cum-infl" type="number" step="any" placeholder="e.g. 8 for 8% total" onchange="cgtRunSimulation()"></div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-g" onclick="cgtRunSimulation()">Run simulation</button>
            <select id="cgt-sim-method" class="fi" style="flex:0 0 110px">
              <option value="FIFO">FIFO</option>
              <option value="LIFO">LIFO</option>
            </select>
            <button class="btn" onclick="cgtShowExportPreview(document.getElementById('cgt-sim-method').value)">Export lots CSV</button>
          </div>
      </div>

      <div id="cgt-sim-results">${fifoLifoHtml}</div>
      `}
    </div>

    <div class="fs" style="margin-top:20px">
      <div class="fst" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between" onclick="cgtAmitCollapsed=!cgtAmitCollapsed;renderCGT()">
        <span>AMIT COST-BASE ADJUSTMENTS</span>
        <span style="color:var(--text3);font-size:10px">${cgtAmitCollapsed?'▼ show':'▲ hide'}</span>
      </div>
      ${cgtAmitCollapsed ? '' : `
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:10px">
        Enter each distribution's net cost-base adjustment from the fund's annual tax statement.
        Negative = cost base decrease (the common case for tax-deferred distributions).
      </div>

      <div class="dz" style="padding:24px" ondragover="event.preventDefault();this.classList.add('drag')"
           ondragleave="this.classList.remove('drag')"
           ondrop="event.preventDefault();this.classList.remove('drag');handleAmitPdfFiles(event.dataTransfer.files)"
           onclick="$('amit-pdf-input').click()">
        <div class="dz-icon">📄</div>
        <div class="dz-txt">Drop AMIT/AMMA tax statement PDF(s) here, or click to browse</div>
        <div class="dz-sub">Auto-extracts symbol, FY-end date and cost-base adjustment — you review before adding. Works offline for most statements; a few (font-encoding dependent) need a one-time internet-connected fallback read.</div>
      </div>
      <input type="file" id="amit-pdf-input" accept="application/pdf" multiple style="display:none"
             onchange="handleAmitPdfFiles(this.files)">
      <div id="amit-pdf-status" style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:14px"></div>

      ${pdfPendingHtml}

      <div class="fg">
        <div class="fgi"><label class="fl">Symbol</label>
          <select class="fi" id="amit-sym">${symbolsInUse.map(sym=>`<option value="${sym}">${sym}</option>`).join('')}</select>
        </div>
        <div class="fgi"><label class="fl">Record Date</label><input class="fi" type="date" id="amit-date"></div>
        <div class="fgi"><label class="fl">Adjustment ($, +/-)</label>
          <input class="fi" type="number" step="any" id="amit-amount" placeholder="-12.34 for a decrease"></div>
        <div class="fgi"><label class="fl">Notes</label>
          <input class="fi" type="text" id="amit-notes" placeholder="e.g. FY26 AMMA statement"></div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-g" id="amit-form-btn" onclick="addAmitAdjustmentFromForm()">${amitEditingId ? '✓ SAVE CHANGES' : '+ ADD ADJUSTMENT'}</button>
          ${amitEditingId ? '<button class="btn" onclick="cancelEditAmitAdjustment()">Cancel edit</button>' : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="fsm" id="cgt-amit-search" type="text" placeholder="Search symbol…" value="${escHtml(cgtAmitSearch)}"
                 oninput="cgtAmitSearch=this.value;renderAmitTable()" style="min-width:160px;text-transform:none">
          <button class="btn" style="padding:4px 9px;font-size:11px" onclick="cgtClearAmitSearch()">✕</button>
        </div>
      </div>
      <div class="ovx" style="margin-top:14px">
        <table><thead><tr>
          ${sortTh('amit','date','Date','renderCGT')}
          ${sortTh('amit','symbol','Symbol','renderCGT')}
          ${sortTh('amit','amount','Adjustment','renderCGT')}
          ${sortTh('amit','notes','Notes','renderCGT')}
          <th></th>
        </tr></thead>
        <tbody id="cgt-amit-tbody">${amitBodyHtml}</tbody></table>
      </div>
      `}
    </div>

    <div class="fs" style="margin-top:16px">
      <div class="fst" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between" onclick="cgtCostBaseCollapsed=!cgtCostBaseCollapsed;renderCGT()">
        <span>CURRENT COST BASE (AMIT-ADJUSTED)</span>
        <span style="color:var(--text3);font-size:10px">${cgtCostBaseCollapsed?'▼ show':'▲ hide'}</span>
      </div>
      ${cgtCostBaseCollapsed ? '' : `
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:10px">
        Live cost base of every currently-held parcel, after all AMIT adjustments applied above. Click a symbol to see the per-parcel breakdown.
      </div>
      <div class="fr" style="margin-bottom:12px">
        <input class="fsm" id="cgt-costbase-search" type="text" placeholder="Search symbol…" value="${escHtml(cgtCostBaseSearch)}"
               oninput="cgtCostBaseSearch=this.value;renderCostBaseList()" style="min-width:180px">
        <button class="btn" style="padding:5px 10px;font-size:11px" onclick="cgtClearCostBaseSearch()">✕ Clear</button>
        <span class="ca-pill${cgtCostBaseFilter==='all'?' active':''}" onclick="cgtCostBaseFilter='all';renderCGT()">All</span>
        <span class="ca-pill${cgtCostBaseFilter==='adjusted'?' active':''}" onclick="cgtCostBaseFilter='adjusted';renderCGT()">AMIT-adjusted only</span>
      </div>
      <div id="cgt-costbase-list">${costBaseHtml}</div>
      `}
    </div>

    <div class="fs" style="margin-top:16px">
      <div class="fst">OPENING LOSS CARRY-FORWARD</div>
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:10px">
        If you have unused capital losses from before you started tracking here, enter them once —
        future years will carry forward automatically from there.
      </div>
      <div class="fg" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${carryInHtml}</div>
      <button class="btn btn-g" onclick="cgtSaveCarryIn()">SAVE CARRY-FORWARD</button>
    </div>
  `;
  // Initialize slider state after DOM is updated
  setTimeout(cgtUpdateSlider, 0);
  // Attempt auto-snapshot of prices at the cutoff date if it's been reached
  try{ setTimeout(cgtAutoSnapshotCutoffPrice, 200); }catch(e){}
}

// ── EDIT EXISTING AMIT ENTRY ─────────────────────────────────────────────
let amitEditingId = null;

function editAmitAdjustment(id){
  const a = amitAdjustments.find(x=>String(x.id)===String(id));
  if(!a) return;
  amitEditingId = a.id;
  renderCGT();
  // Populate the form after render (fresh DOM)
  if($('amit-sym'))  { if(![...$('amit-sym').options].some(o=>o.value===a.symbol)){ const opt=document.createElement('option'); opt.value=a.symbol; opt.textContent=a.symbol; $('amit-sym').appendChild(opt); } $('amit-sym').value = a.symbol; }
  if($('amit-date'))   $('amit-date').value = a.date;
  if($('amit-amount')) $('amit-amount').value = a.amount;
  if($('amit-notes'))  $('amit-notes').value = a.notes;
  $('amit-form-btn')?.scrollIntoView({behavior:'smooth', block:'center'});
}

function cancelEditAmitAdjustment(){
  amitEditingId = null;
  renderCGT();
}

function addAmitAdjustmentFromForm(){
  const sym    = $('amit-sym') ? $('amit-sym').value : '';
  const date   = $('amit-date').value;
  const amount = $('amit-amount').value;
  const notes  = $('amit-notes').value;

  if(amitEditingId != null){
    const a = amitAdjustments.find(x=>String(x.id)===String(amitEditingId));
    if(!a){ amitEditingId=null; renderCGT(); return; }
    if(!sym || !date || isNaN(+amount)){ notify('Symbol, date and amount are required.','err'); return; }
    a.symbol = sym.trim().toUpperCase(); a.date = date; a.amount = +amount; a.notes = (notes||'').trim();
    saveAmitAdjustments();
    amitEditingId = null;
    notify('✓ AMIT adjustment updated');
    renderCGT();
    return;
  }

  if(addAmitAdjustment(sym, date, amount, notes)){
    notify('✓ AMIT adjustment added');
    renderCGT();
  }
}

// ── PDF UPLOAD & AUTO-PARSE ──────────────────────────────────────────────
// Reuses the app's own local PDF text extractor (extractPDFText, defined in
// tax.js and already used for registry dividend PDF imports) — no external
// library, works fully offline. Regex-parses the extracted text for the
// symbol, FY-end date and cost-base adjustment. Always shown as an editable
// preview before anything is saved.
let amitPdfPending = [];

// Regex-based extraction — handles the wording variants seen across
// registries (Link/MUFG/Computershare use "excess"/"shortfall"; VanEck uses
// "increase amount"/"decrease amount"). Symbol comes from an "ASX Code:"
// label when present, otherwise falls back to the filename.
function parseAmitStatementText(text, filename){
  const symMatch   = text.match(/ASX\s*[Cc]ode\s*:\s*([A-Z0-9]{2,6})/i);
  const yearMatch  = text.match(/year\s+ended\s+30\s+June\s+(\d{4})/i);
  const excessMatch    = text.match(/excess[^$]{0,40}\$\s*([\d,]+\.\d{2})/i)
                       || text.match(/decrease\s+amount[^$]{0,20}\$\s*([\d,]+\.\d{2})/i);
  const shortfallMatch = text.match(/shortfall[^$]{0,40}\$\s*([\d,]+\.\d{2})/i)
                       || text.match(/increase\s+amount[^$]{0,20}\$\s*([\d,]+\.\d{2})/i);

  let symbol = symMatch ? symMatch[1].toUpperCase() : '';
  let warning = '';
  if(!symbol){
    // Fallback: derive from filename, e.g. "VAE_2025.pdf" -> "VAE"
    const base = (filename||'').replace(/\.pdf$/i,'');
    const guess = base.split(/[_\-\s]/)[0];
    symbol = guess ? guess.toUpperCase() : '';
    warning = 'Symbol not found in PDF text — guessed from filename, please verify.';
  }

  const year = yearMatch ? yearMatch[1] : '';
  const date = year ? `${year}-06-30` : '';
  if(!year) warning = (warning ? warning+' ' : '') + 'Could not find the statement date — please set it manually.';

  const excess    = excessMatch    ? parseFloat(excessMatch[1].replace(/,/g,''))    : 0;
  const shortfall = shortfallMatch ? parseFloat(shortfallMatch[1].replace(/,/g,'')) : 0;
  // This is the one that actually matters — if the local extractor's text has
  // no trace of the adjustment labels at all, it's likely a font-encoding
  // issue (some registries embed the label text with non-standard character
  // codes the lightweight local extractor can't decode), not genuinely a
  // zero-adjustment statement. Worth a proper re-read via the fallback.
  const needsFallback = !excessMatch && !shortfallMatch;
  if(needsFallback){
    warning = (warning ? warning+' ' : '') + 'No AMIT cost-base adjustment figures found in the quick read — retrying with the fuller PDF reader…';
  }
  const amount = +(shortfall - excess).toFixed(2);

  return { symbol, date, amount, notes: filename ? ('Auto-parsed from ' + filename) : '', filename, warning, needsFallback };
}

// ── FALLBACK: pdf.js via CDN ─────────────────────────────────────────────
// Only used when the local extractor above can't find the adjustment
// figures at all — typically because the PDF's label text uses a custom
// font encoding (needs a ToUnicode CMap) that the lightweight local parser
// doesn't resolve. pdf.js handles font/CMap decoding properly, at the cost
// of needing internet access on first use. This is a fallback, not the
// default — most statements never need it.
let _pdfJsLoadPromise = null;
function loadPdfJsFallback(){
  if(window.pdfjsLib) return Promise.resolve();
  if(_pdfJsLoadPromise) return _pdfJsLoadPromise;
  _pdfJsLoadPromise = new Promise((resolve, reject)=>{
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
    script.onload = ()=>{
      try{
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        resolve();
      }catch(e){ reject(e); }
    };
    script.onerror = ()=> reject(new Error('Could not load the fallback PDF reader — check your internet connection.'));
    document.head.appendChild(script);
  });
  return _pdfJsLoadPromise;
}

async function extractPdfTextViaFallback(file){
  await loadPdfJsFallback();
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  let fullText = '';
  for(let i=1; i<=pdf.numPages; i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Naive stream-order concatenation can leave a label and its dollar value
    // far apart in the joined text even though they sit on the same visual
    // row (common in template-driven statement generators that draw labels
    // and variable data as separate operations). Reconstruct actual reading
    // order instead: group fragments into lines by Y position, then sort
    // each line left-to-right by X — using the position data pdf.js gives
    // us for free (the local extractor above doesn't track this).
    const items = content.items.map(it => ({
      str: it.str, x: it.transform[4], y: it.transform[5],
    })).filter(it => it.str.trim());

    const lineTolerance = 3;
    const lines = [];
    items.forEach(it=>{
      let line = lines.find(l => Math.abs(l.y - it.y) <= lineTolerance);
      if(!line){ line = { y: it.y, items: [] }; lines.push(line); }
      line.items.push(it);
    });
    lines.sort((a,b) => b.y - a.y); // top to bottom (PDF y-axis runs bottom-up)
    lines.forEach(line=>{
      line.items.sort((a,b) => a.x - b.x); // left to right
      fullText += line.items.map(it=>it.str).join(' ') + '\n';
    });
  }
  return fullText;
}

async function handleAmitPdfFiles(fileList){
  const files = Array.from(fileList||[]);
  if(!files.length) return;
  const statusEl = $('amit-pdf-status');
  for(const file of files){
    if(statusEl) statusEl.textContent = `Reading ${file.name}…`;
    try{
      const text = await extractPDFText(file); // local extractor from tax.js — no CDN, no network
      if(!text || text.length < 20){
        notify(`Could not read text from ${file.name} — it may be an image-scanned PDF.`, 'err');
        continue;
      }
      let parsed = parseAmitStatementText(text, file.name);

      if(parsed.needsFallback){
        if(statusEl) statusEl.textContent = `${file.name}: quick read incomplete, trying fuller PDF reader (needs internet)…`;
        try{
          const fallbackText = await extractPdfTextViaFallback(file);
          const fallbackParsed = parseAmitStatementText(fallbackText, file.name);
          if(!fallbackParsed.needsFallback){
            fallbackParsed.notes = 'Auto-parsed from ' + file.name + ' (fuller PDF reader)';
            parsed = fallbackParsed;
          } else {
            parsed.warning = parsed.warning.replace('retrying with the fuller PDF reader…', '')
              + 'Still no adjustment figures found even with the fuller reader — check this is the right statement, or enter manually.';
          }
        }catch(e){
          parsed.warning = parsed.warning.replace('retrying with the fuller PDF reader…', '')
            + 'Fuller PDF reader unavailable (' + e.message + ') — enter the adjustment manually.';
        }
      }

      amitPdfPending.push(parsed);
    }catch(e){
      notify(`Could not read ${file.name}: ${e.message}`, 'err');
    }
  }
  if(statusEl) statusEl.textContent = '';
  $('amit-pdf-input').value = '';
  renderCGT();
}

function cgtConfirmPdfEntry(idx){
  const p = amitPdfPending[idx];
  if(!p) return;
  if(addAmitAdjustment(p.symbol, p.date, p.amount, p.notes)){
    amitPdfPending.splice(idx, 1);
    notify('✓ AMIT adjustment added');
    renderCGT();
  }
}

function cgtDiscardPdfEntry(idx){
  amitPdfPending.splice(idx, 1);
  renderCGT();
}

function cgtConfirmAllPdfEntries(){
  let added = 0;
  const remaining = [];
  for(const p of amitPdfPending){
    if(addAmitAdjustment(p.symbol, p.date, p.amount, p.notes)) added++;
    else remaining.push(p);
  }
  amitPdfPending = remaining;
  notify(`✓ ${added} AMIT adjustment${added!==1?'s':''} added`);
  renderCGT();
}

function cgtSaveCarryIn(){
  const persons = getAllPersons();
  const out = {};
  persons.forEach(person=>{
    const amtEl = $('cgt-carryin-amt-'+person);
    const fyEl  = $('cgt-carryin-fy-'+person);
    const amount = amtEl ? parseFloat(amtEl.value)||0 : 0;
    const fy     = fyEl ? parseInt(fyEl.value)||0 : 0;
    if(amount > 0 && fy > 0) out[person] = { amount, fy };
  });
  saveCGTLossCarryIn(out);
  notify('✓ Loss carry-forward saved');
  renderCGT();
}

// ── BACKWARD-COMPATIBILITY SHIM ──────────────────────────────────────────
// An earlier, incomplete version of this file exposed calcCGTEvents() /
// summarizeCGTEvents() with an older API, and tax.js may still call them
// for its CGT estimate line. These wrappers preserve that exact call
// signature and return shape (so nothing crashes or silently changes
// layout) by adapting the new, corrected engine underneath.
// summarizeCGTEvents() now applies losses against gains BEFORE the 50%
// discount (short-term gains offset first, then long-term), matching the
// order the Capital Gains tab itself uses via computeCGTSummary() — this
// used to reproduce an older, pre-fix ordering that discounted long-term
// gains before losses were applied, understating the taxable gain whenever
// losses exceeded short-term gains. As before, calcCGTEvents() is currently
// unused (nothing in this app calls it), so this only matters if something
// starts calling it in future — prefer computeCGTSummary() directly.
function calcCGTEvents(sellsInput){
  const { disposals } = buildDisposals();
  const bySaleId = {};
  disposals.forEach(d=>{ bySaleId[d.tradeId] = d; });
  const events = [];
  for(const sell of (sellsInput||[])){
    const d = bySaleId[sell.id];
    const share = sell._share !== undefined ? sell._share : 1.0;
    if(!d){
      events.push({
        id: sell.id, symbol: sell.symbol, sellDate: sell.date,
        units:+sell.units, price:+sell.price, fees:+sell.fees||0,
        proceeds: (+sell.units*+sell.price)-(+sell.fees||0), costBasis:0,
        grossGain:0, share, shortPortion:0, longPortion:0, parcels:[],
        unmatchedUnits:+sell.units, dataIncomplete:true, isLoss:false,
      });
      continue;
    }
    const grossGain = d.gain * share;
    let shortPortion = 0, longPortion = 0;
    d.lots.forEach(l=>{
      const portion = l.gain * share;
      if(l.longTerm) longPortion += portion; else shortPortion += portion;
    });
    const parcels = d.lots.map(l=>({
      buyDate:l.buyDate, units:l.units, baseCostPerUnit: l.units ? l.cost/l.units : 0,
      amitAdjPerUnit:0, adjCostPerUnit: l.units ? l.cost/l.units : 0,
      parcelCost:l.cost, heldDays:l.heldDays, over12m:l.longTerm,
    }));
    events.push({
      id: sell.id, symbol: d.symbol, sellDate: d.saleDate,
      units: d.unitsSold, price:+sell.price, fees:+sell.fees||0,
      proceeds: d.proceeds, costBasis: d.costConsumed, grossGain,
      share, shortPortion, longPortion, parcels,
      unmatchedUnits: d.shortfallUnits||0, dataIncomplete: (d.shortfallUnits||0) > 0.0001,
      isLoss: grossGain < 0,
    });
  }
  return events.sort((a,b)=>a.sellDate.localeCompare(b.sellDate));
}

function summarizeCGTEvents(events){
  let shortGain=0, longGainRaw=0, totalLoss=0, incompleteCount=0;
  (events||[]).forEach(e=>{
    if(e.dataIncomplete){ incompleteCount++; return; }
    if(e.grossGain >= 0){
      if(e.shortPortion>0) shortGain += e.shortPortion;
      if(e.longPortion>0)  longGainRaw += e.longPortion;
    } else {
      totalLoss += Math.abs(e.grossGain);
    }
  });
  // Apply losses against gains before the discount — short-term first,
  // then long-term — then discount only the long-term gain that survives.
  let remainingLoss = totalLoss;
  const shortAfterLoss = Math.max(0, shortGain - remainingLoss);
  remainingLoss = Math.max(0, remainingLoss - shortGain);
  const longAfterLoss = Math.max(0, longGainRaw - remainingLoss);
  const longGain = longAfterLoss * 0.5;
  const netGain  = shortAfterLoss + longGain;
  return { shortGain, longGainRaw, longGain, totalLoss, netGain, incompleteCount };
}

// ── FIFO vs LIFO SIMULATION (SELL NOW, USING CURRENT PRICE) ───────────
function simulateMatchingForSymbol(parcelsList, price, method, sellUnits=null, opts={}){
  const cutoff = new Date('2027-06-30');
  const saleDate = opts && opts.saleDate ? new Date(opts.saleDate) : new Date();
  const list = (parcelsList||[]).map(p=>({ units: p.units, cost: p.cost, date: p.date, source: p.source }));
  let totalAvailable = list.reduce((s,p)=>s+(p.units||0),0);
  let unitsToSell = sellUnits == null ? totalAvailable : Math.min(sellUnits, totalAvailable);
  const ordered = method === 'LIFO'
    ? list.slice().sort((a,b)=>b.date.localeCompare(a.date))
    : list.slice().sort((a,b)=>a.date.localeCompare(b.date));
  const lots = [];
  let remaining = unitsToSell;

  while(remaining > 0.000001 && ordered.length){
    const p = ordered[0];
    if(!p || p.units <= 0.000001){ ordered.shift(); continue; }
    const take = Math.min(p.units, remaining);
    const proceeds = take * price;
    const costPortion = p.cost * (take / (p.units || take));
    const heldDays = (saleDate - new Date(p.date)) / 86400000;
    const gain = proceeds - costPortion;
    lots.push({ units: take, buyDate: p.date, cost: costPortion, proceeds, gain, heldDays: Math.round(heldDays) });
    p.units -= take;
    p.cost -= costPortion;
    remaining -= take;
  }

  // shortfall units (no matching buy) treated as cost 0
  if(remaining > 0.000001){
    const proceeds = remaining * price;
    lots.push({ units: remaining, buyDate: null, cost: 0, proceeds, gain: proceeds, heldDays: 0 });
    remaining = 0;
  }

  const totalGain = lots.reduce((s,l)=>s+l.gain,0);
  return { totalGain:+totalGain.toFixed(2), lots };
}

function australianTaxOnIncome(income){
  // Wrapper to use `calcTax()` (which selects ATO brackets by fiscal year).
  // Accepts optional second arg `fy` when callers supply a fiscal year.
  income = Math.max(0, income || 0);
  // If caller passed an FY via arguments, forward it to calcTax
  if(arguments.length >= 2){
    const fy = arguments[1];
    return calcTax(income, fy);
  }
  return calcTax(income);
}

function marginalTaxOnGain(gain, baseIncome, fy){
  const b = Math.max(0, baseIncome || 0);
  const before = calcTax(b, fy);
  const after = calcTax(b + Math.max(0, gain), fy);
  return +(after - before).toFixed(2);
}

function computeTaxOnLots(lots, opts){
  // opts: { useDiscountBeforeCutoff:true, cpiRate:0, saleDate:'YYYY-MM-DD', priceAtCutoff: number }
  // Returns breakdown: { taxableTotal, taxablePre, taxablePost }
  const cutoff = cgtCutoffDateObj();
  const saleDate = opts && opts.saleDate ? new Date(opts.saleDate) : new Date();
  const useDiscountBeforeCutoff = opts && opts.useDiscountBeforeCutoff !== false;
  const priceAtCutoff = opts && (opts.priceAtCutoff != null) ? Number(opts.priceAtCutoff) : null;
  let taxablePre = 0;
  let taxablePost = 0;

  // If sale is on or before cutoff, treat all as pre-cutoff
  if(saleDate <= cutoff){
    for(const l of lots){
      const longTerm = l.heldDays > 365;
      const val = (longTerm && l.gain > 0 && useDiscountBeforeCutoff) ? l.gain * 0.5 : l.gain;
      taxablePre += val;
    }
    return { taxableTotal: +((taxablePre + taxablePost).toFixed(2)), taxablePre: +taxablePre.toFixed(2), taxablePost: +taxablePost.toFixed(2) };
  }

  for(const l of lots){
    const buyDate = l.buyDate ? new Date(l.buyDate) : null;
    if(!buyDate){
      // unknown buy date -> treat full gain as post-cutoff
      taxablePost += l.gain;
      continue;
    }

    const boughtBeforeCutoff = buyDate < (new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate()+1));
    if(!boughtBeforeCutoff){
      // acquired on/after the day after cutoff => whole gain is post-cutoff
      taxablePost += l.gain;
      continue;
    }

    // acquired before cutoff and sold after => split accrual
    if(boughtBeforeCutoff && saleDate > cutoff){
      if(priceAtCutoff && priceAtCutoff > 0){
        const units = l.units || 1;
        const valueAtCutoff = units * priceAtCutoff;
        const gainPre = Math.max(0, valueAtCutoff - l.cost);
        const preHeldDays = Math.max(0, Math.floor((cutoff - buyDate) / 86400000));
        const longPre = preHeldDays > 365;
        const tPre = (longPre && gainPre > 0 && useDiscountBeforeCutoff) ? gainPre * 0.5 : gainPre;

        // Index the cutoff value forward to the sale date (cumulative inflation after cutoff)
        const yearsAfterCutoff = Math.max(0, (saleDate - cutoff) / (365*86400000));
        let factorAfter;
        if(opts && opts.cumulativeInflation != null && !isNaN(Number(opts.cumulativeInflation))){
          factorAfter = 1 + (Number(opts.cumulativeInflation) / 100);
        } else {
          factorAfter = Math.pow(1 + ((opts && opts.cpiRate||0)/100), yearsAfterCutoff);
        }
        const indexedBase = valueAtCutoff * factorAfter;
        const tPost = l.proceeds - indexedBase;

        taxablePre += tPre;
        taxablePost += tPost;
        continue;
      }

      // Fallback: apportion by time
      const totalDays = Math.max(1, (saleDate - buyDate) / 86400000);
      const preDays = Math.max(0, Math.min((cutoff - buyDate) / 86400000, totalDays));
      const propPre = preDays / totalDays;
      const gainPre = Math.max(0, l.gain * propPre);
      const tPre = (preDays > 365 && gainPre > 0 && useDiscountBeforeCutoff) ? gainPre * 0.5 : gainPre;
      const tPost = l.gain - gainPre;
      taxablePre += tPre;
      taxablePost += tPost;
      continue;
    }

    // default: treat as post-cutoff
    taxablePost += l.gain;
  }

  return { taxableTotal: +((taxablePre + taxablePost).toFixed(2)), taxablePre: +taxablePre.toFixed(2), taxablePost: +taxablePost.toFixed(2) };
}

function computeFIFOvsLIFOSummary(openParcels){
  return Object.entries(openParcels)
    .filter(([sym,list])=> !sym.startsWith('_stash_') && list.reduce((s,p)=>s+p.units,0) > 0.000001)
    .map(([sym,list])=>{
      const units = list.reduce((s,p)=>s+p.units,0);
      const price = prices[priceSymbol(sym)] || 0;
      const fifo = simulateMatchingForSymbol(list, price, 'FIFO');
      const lifo = simulateMatchingForSymbol(list, price, 'LIFO');
      // simulateMatchingForSymbol() only returns raw gain (totalGain/lots) — it
      // doesn't apply the CGT discount. Run each through the same discount-aware
      // engine used everywhere else so "taxable" here means the same thing it
      // does in the simulation popup and the exported CSV.
      const today = new Date().toISOString().slice(0,10);
      fifo.taxable = computeTaxOnLots(fifo.lots, { saleDate: today }).taxableTotal;
      lifo.taxable = computeTaxOnLots(lifo.lots, { saleDate: today }).taxableTotal;
      const fifoTax30 = Math.max(0, fifo.taxable) * 0.30;
      const lifoTax30 = Math.max(0, lifo.taxable) * 0.30;
      const better = fifo.taxable < lifo.taxable ? 'FIFO' : (lifo.taxable < fifo.taxable ? 'LIFO' : 'Tie');
      return { sym, units, price, fifo, lifo, fifoTax30:+fifoTax30.toFixed(2), lifoTax30:+lifoTax30.toFixed(2), better };
    })
    .sort((a,b)=>a.sym.localeCompare(b.sym));
}

// Run the user-facing simulation using selected inputs
function cgtRunSimulation(){
  const sym = $('cgt-sim-symbol') ? $('cgt-sim-symbol').value : null;
  if(!sym){ notify('No symbol selected for simulation','err'); return; }
  const unitsVal = parseFloat($('cgt-sim-units')?.value);
  const units = isNaN(unitsVal) ? null : unitsVal;
  const person = $('cgt-sim-person') ? $('cgt-sim-person').value : null;
  const incomeEl = $('cgt-sim-income');
  const incomeStr = incomeEl ? (incomeEl.value||'').toString().trim() : '';
  const incomeEmpty = incomeStr === '';
  let income = parseFloat(incomeStr);
  if(isNaN(income)) income = null;
  const cpi = parseFloat($('cgt-sim-cpi')?.value) || 0;

  const { openParcels } = computeCGTSummary();
  const fullList = (openParcels[sym]||[]).filter(p=>p.units>0.000001);
  // Use owner share: simulate only the selected person's portion of each parcel
  const share = (typeof ownerShare === 'function') ? ownerShare(sym, person) : (getSymbolOwner(sym)===person?1:(getSymbolOwner(sym)==='joint'?0.5:0));
  const list = fullList.map(p=>({ ...p, units: p.units * share, cost: p.cost * share }));
  if(!list.length){ notify('No open parcels for '+sym,'err'); return; }
  const price = prices[priceSymbol(sym)] || 0;
  const mode = $('cgt-sim-mode') ? $('cgt-sim-mode').value : 'units';
  const explicitSalePrice = parseFloat($('cgt-sim-price')?.value);
  const salePricePerUnit = (!isNaN(explicitSalePrice) && explicitSalePrice>0) ? explicitSalePrice : price;
  // If user selected dollars mode, interpret the units input as $ amount and convert to units
  let sellUnits = units;
  if(mode === 'dollars'){
    const dollars = units; // units variable holds parsed numeric input
    if(dollars == null) sellUnits = null; else sellUnits = price > 0 ? (dollars / price) : 0;
  }

  const sellDateStr = $('cgt-sim-selldate') ? $('cgt-sim-selldate').value : new Date().toISOString().slice(0,10);
  const explicitCutoffPrice = parseFloat($('cgt-sim-price-cutoff')?.value);
  const cutoffPrice = !isNaN(explicitCutoffPrice) ? explicitCutoffPrice : cgtLoadCutoffPrice(sym);
  const fifo = simulateMatchingForSymbol(list, salePricePerUnit, 'FIFO', sellUnits, { saleDate: sellDateStr });
  const lifo = simulateMatchingForSymbol(list, salePricePerUnit, 'LIFO', sellUnits, { saleDate: sellDateStr });

  // Compute inferred taxable breakdown (pre/post) based on dates and available price@cutoff
  const cumInflVal = (function(){ const v = parseFloat($('cgt-sim-cum-infl')?.value); return isNaN(v)? null : v; })();
  const fifoBreak = computeTaxOnLots(fifo.lots, { useDiscountBeforeCutoff:true, cpiRate:cpi, cumulativeInflation:cumInflVal, saleDate: sellDateStr, priceAtCutoff: cutoffPrice });
  const lifoBreak = computeTaxOnLots(lifo.lots, { useDiscountBeforeCutoff:true, cpiRate:cpi, cumulativeInflation:cumInflVal, saleDate: sellDateStr, priceAtCutoff: cutoffPrice });

  // If any lot crosses the cutoff and no price@cutoff is provided, warn the user
  const saleDateObj = new Date(sellDateStr);
  const cutoff = cgtCutoffDateObj();
  const anyCrosses = fifo.lots.concat(lifo.lots).some(l=>{
    if(!l.buyDate) return false;
    const bd = new Date(l.buyDate);
    return bd < (new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate()+1)) && saleDateObj > cutoff;
  });
  const needsCutoffPrice = anyCrosses && !(cutoffPrice != null);

  // If income not provided, try to load previous FY tax record for this person
  if(income == null){
    try{
      const curFY = dateToFY(new Date().toISOString().slice(0,10));
      const prevFY = curFY - 1;
      const rec = getTaxRecord(prevFY) || {};
      const pRec = rec[person] || {};
      const salaryNet = (+pRec.salary || 0) - (+pRec.sacrifice || 0);
      // Dividends (grossed-up + franking) for prevFY attributed by ownership
      const myDivs = dividends.filter(d=>dateToFY(d.date)===prevFY && ['dividend','distribution','drp','interest'].includes(d.type))
        .reduce((s,d)=>{
          const own = getSymbolOwner(d.symbol);
          const share = own===person ? 1 : (own==='joint'?0.5:0);
          return s + ((+d.amount||0) * share);
        },0);
      const myFrank = dividends.filter(d=>dateToFY(d.date)===prevFY && ['dividend','distribution','drp','interest'].includes(d.type))
        .reduce((s,d)=>{
          const own = getSymbolOwner(d.symbol);
          const share = own===person ? 1 : (own==='joint'?0.5:0);
          return s + frankingCredit((+d.amount||0)*share, d.frankingPct||0);
        },0);
      // CGT realised in prevFY for this person
      const cgts = computeCGTSummary();
      const myCGT = ((cgts.result||{})[person]||{})[prevFY] ? +(((cgts.result||{})[person]||{})[prevFY].netCapitalGain||0) : 0;
      // Property P&L for prevFY (approx using rec.props inputs for that FY)
      let netPropGain = 0, netPropLoss = 0, investInterestDeduction = 0;
      (properties||[]).forEach(p=>{
        const pOwner = p.owner || 'lumia';
        const isOwner = pOwner===person || pOwner==='joint';
        if(!isOwner) return;
        const share = pOwner==='joint' ? 0.5 : 1;
        if(p.propType === 'ppor') return; // PPOR excluded
        const annualRent = (p.weeklyRent||0)*52*share;
        const pRec = (rec.props && rec.props[p.id]) ? rec.props[p.id] : {};
        const splits = normaliseSplits(p);
        let rentalInterest = 0, invInterest = 0;
        splits.forEach(sp=>{
          const purpose = sp.purpose || 'rental';
          const bal = +sp.balance||0, off = +sp.offset||0, rate = +sp.rate||0;
          const annInt = Math.max(0, bal - off) * (rate/100);
          if(purpose === 'investment') invInterest += annInt;
          else if(purpose === 'rental') rentalInterest += annInt;
        });
        investInterestDeduction += invInterest * share;
        const expenses = share * ((+pRec.rates||0)+(+pRec.insurance||0)+(+pRec.repairs||0)+(+pRec.agent||0)+(+pRec.other||0)+(+pRec.depr_bldg||0)+(+pRec.depr_pe||0)) + rentalInterest*share;
        if(annualRent - expenses >= 0) netPropGain += (annualRent - expenses); else netPropLoss += (expenses - annualRent);
      });

      const taxableIncome = salaryNet + myDivs + myFrank - investInterestDeduction + netPropGain - netPropLoss + myCGT;
      income = taxableIncome || 0;
      // If the user left the income input empty, auto-fill it and show a note
      try{
        if(incomeEmpty && incomeEl){ incomeEl.value = Math.round(income); const noteEl = $('cgt-sim-income-note'); if(noteEl) noteEl.textContent = '(auto-filled)'; }
      }catch(e){}
    }catch(e){ income = 0; }
  } else {
    // explicit user-provided income — clear any auto-filled note
    try{ const noteEl = $('cgt-sim-income-note'); if(noteEl) noteEl.textContent = ''; }catch(e){}
  }
  // Marginal tax estimates: allow override by explicit marginal rate (%) input
  const explicitMarginalRate = parseFloat($('cgt-sim-marginal-rate')?.value);
  function taxByRate(taxable){
    if(!isFinite(taxable)) return 0;
    if(!isNaN(explicitMarginalRate)) return +(taxable * (explicitMarginalRate/100)).toFixed(2);
    // fallback to marginal calculation based on income
    const saleFY = (typeof dateToFY === 'function') ? dateToFY(sellDateStr) : null;
    return marginalTaxOnGain(taxable, income, saleFY);
  }

  const fifoPreTaxPay = taxByRate(fifoBreak.taxablePre);
  const lifoPreTaxPay = taxByRate(lifoBreak.taxablePre);
  // For post-cutoff portion apply 30% floor when comparing to marginal rate
  function taxPostPortion(postTaxable){
    const byRate = taxByRate(postTaxable);
    const floor = +(postTaxable * 0.30).toFixed(2);
    return Math.max(byRate, floor);
  }
  const fifoPostPay = taxPostPortion(fifoBreak.taxablePost);
  const lifoPostPay = taxPostPortion(lifoBreak.taxablePost);
  const fifoTotalPay = +(fifoPreTaxPay + fifoPostPay).toFixed(2);
  const lifoTotalPay = +(lifoPreTaxPay + lifoPostPay).toFixed(2);

  // Compute full tax estimates using existing tax functions (calcTax, calcHECS, calcMLS)
  // so the main results table can display authoritative full deltas.
  let fifoFull = null, lifoFull = null;
  try{
    const curFY = dateToFY(new Date().toISOString().slice(0,10));
    const prevFY = curFY - 1;
    const taxRec = getTaxRecord(prevFY) || {};
    const personRec = taxRec[person] || {};
    const other = person==='lumia' ? 'chilli' : 'lumia';
    const otherRec = taxRec[other] || {};
    const baseIncome = income || 0;
    const otherIncome = (+otherRec.salary||0) - (+otherRec.sacrifice||0);
    const familyIncome = baseIncome + otherIncome;
    const hecsDebt = +personRec.hecs || 0;
    const hasPH = !!(personRec.privateHealth || taxRec.privateHealthFamily);
    const deps = +(taxRec.dependants||0);

    // Compute full tax delta but honour the post-cutoff 30% minimum floor.
    // Accepts pre/post breakdown so we can attribute tax increments correctly.
    function fullTaxDelta(taxablePre, taxablePost){
      taxablePre = +taxablePre || 0;
      taxablePost = +taxablePost || 0;
      const beforeTax = calcTax(Math.max(0, baseIncome));
      const beforeHECS = calcHECS(Math.max(0, baseIncome), hecsDebt);
      const beforeMLS = calcMLS(Math.max(0, baseIncome), Math.max(0, familyIncome), hasPH, deps);

      // Apply pre portion first, then post portion so we can isolate post incremental tax
      const afterPreIncome = Math.max(0, baseIncome + taxablePre);
      const afterPreTax = calcTax(afterPreIncome);
      const afterPreHECS = calcHECS(afterPreIncome, hecsDebt);
      const afterPreMLS = calcMLS(afterPreIncome, Math.max(0, familyIncome + taxablePre), hasPH, deps);

      const afterFullIncome = Math.max(0, baseIncome + taxablePre + taxablePost);
      const afterFullTax = calcTax(afterFullIncome);
      const afterFullHECS = calcHECS(afterFullIncome, hecsDebt);
      const afterFullMLS = calcMLS(afterFullIncome, Math.max(0, familyIncome + taxablePre + taxablePost), hasPH, deps);

      // Increments attributable to pre and post portions
      const preInc = (afterPreTax + afterPreHECS + afterPreMLS) - (beforeTax + beforeHECS + beforeMLS);
      const postIncByRate = (afterFullTax + afterFullHECS + afterFullMLS) - (afterPreTax + afterPreHECS + afterPreMLS);

      // 30% floor applies to post portion only
      const postFloor = +(taxablePost * 0.30).toFixed(2);
      const postInc = Math.max(postIncByRate, postFloor);

      const totalDelta = +(preInc + postInc).toFixed(2);

      return {
        beforeTax, beforeHECS, beforeMLS,
        afterTax: afterFullTax, afterHECS: afterFullHECS, afterMLS: afterFullMLS,
        delta: totalDelta,
        breakdown: { preInc:+preInc.toFixed(2), postInc: +postInc.toFixed(2), postIncByRate:+postIncByRate.toFixed(2) }
      };
    }

    fifoFull = fullTaxDelta(fifoBreak.taxablePre, fifoBreak.taxablePost);
    lifoFull = fullTaxDelta(lifoBreak.taxablePre, lifoBreak.taxablePost);
  }catch(e){ /* ignore, fallback to table estimate */ }

  // Build results HTML
  const warningHtml = needsCutoffPrice ? `<div style="background:#fff3cd;border:1px solid #ffeeba;color:#856404;padding:8px;border-radius:4px;margin-bottom:8px">Warning: No price recorded for ${CGT_CUTOFF_LABEL} — time‑apportionment fallback used for lots crossing the cutoff; results are approximate.</div>` : '';

  const html = `
    ${warningHtml}
    <div style="margin-bottom:8px;font-size:13px"><b>Simulation — ${escHtml(sym)} @ ${n2(price)}</b></div>
    <div class="ovx"><table>
        <thead><tr><th>Method</th><th style="text-align:right">Total gain</th>
          <th style="text-align:right">Taxable (inferred)</th><th style="text-align:right">Est. tax (full delta incl HECS/MLS)</th>
      </tr></thead>
      <tbody>
        <tr>
          <td><button class="btn" onclick="cgtShowMethodDetails('FIFO')">FIFO</button></td>
          <td style="text-align:right">${n2(fifo.totalGain)}</td>
          <td style="text-align:right">${n2(fifoBreak.taxableTotal)}</td>
          <td style="text-align:right">${n2((fifoFull && fifoFull.delta)!=null ? fifoFull.delta : fifoTotalPay)}</td>
        </tr>
        <tr>
          <td><button class="btn" onclick="cgtShowMethodDetails('LIFO')">LIFO</button></td>
          <td style="text-align:right">${n2(lifo.totalGain)}</td>
          <td style="text-align:right">${n2(lifoBreak.taxableTotal)}</td>
          <td style="text-align:right">${n2((lifoFull && lifoFull.delta)!=null ? lifoFull.delta : lifoTotalPay)}</td>
        </tr>
      </tbody>
    </table></div>
    <div style="margin-top:8px;font-size:12px;color:var(--text3)">
      Notes: Amounts accrued before ${CGT_POST_CUTOFF_LABEL_LONG} retain the 50% discount for long‑term gains. Portions accruing from ${CGT_POST_CUTOFF_LABEL_LONG} use cost‑base indexation and are taxed at the marginal estimate but subject to a 30% minimum floor where applicable.
    </div>
  `;

  // Compute full tax estimates using existing tax functions (calcTax, calcHECS, calcMLS)
  try{
    const curFY = dateToFY(new Date().toISOString().slice(0,10));
    const prevFY = curFY - 1;
    const taxRec = getTaxRecord(prevFY) || {};
    const personRec = taxRec[person] || {};
    const other = person==='lumia' ? 'chilli' : 'lumia';
    const otherRec = taxRec[other] || {};
    const baseIncome = income || 0;
    const otherIncome = (+otherRec.salary||0) - (+otherRec.sacrifice||0);
    const familyIncome = baseIncome + otherIncome;
    const hecsDebt = +personRec.hecs || 0;
    const hasPH = !!(personRec.privateHealth || taxRec.privateHealthFamily);
    const deps = +(taxRec.dependants||0);

    // (duplicate fullTaxDelta / fifoFull/lifoFull definitions removed)

    // Build pre/post breakdown values for clearer display
    const fifoPostByRate = taxByRate(fifoBreak.taxablePost);
    const lifoPostByRate = taxByRate(lifoBreak.taxablePost);
    const fifoPostFloor = +(fifoBreak.taxablePost * 0.30).toFixed(2);
    const lifoPostFloor = +(lifoBreak.taxablePost * 0.30).toFixed(2);
    const fifoPostUsed = Math.max(fifoPostByRate, fifoPostFloor);
    const lifoPostUsed = Math.max(lifoPostByRate, lifoPostFloor);
    const fifoTableEstimate = +(fifoPreTaxPay + fifoPostUsed).toFixed(2);
    const lifoTableEstimate = +(lifoPreTaxPay + lifoPostUsed).toFixed(2);

    // Render results and store last simulation (fifoFull/lifoFull already computed above when possible)
    $('cgt-sim-results').innerHTML = html;
    cgtLastSim = { sym, person, price: salePricePerUnit, units: sellUnits, fifo, lifo, opts:{cpi, cumulativeInflation: cumInflVal, saleDate: sellDateStr, marginalRate: explicitMarginalRate, priceAtCutoff: parseFloat($('cgt-sim-price-cutoff')?.value)||cgtLoadCutoffPrice(sym)||null}, fifoTaxable: fifoBreak.taxableTotal, lifoTaxable: lifoBreak.taxableTotal, fifoFull, lifoFull };
  }catch(e){ console.warn('cgtRunSimulation: results render failed', e); }
}

function cgtExportLotsCSV(method){
  if(!cgtLastSim){ notify('Run a simulation first','err'); return; }
  const sim = cgtLastSim;
  const methodKey = (method||'FIFO').toUpperCase();
  const lots = methodKey==='LIFO' ? sim.lifo.lots : sim.fifo.lots;
  const opts = { cpiRate: sim.opts.cpi, cumulativeInflation: sim.opts.cumulativeInflation, saleDate: sim.opts.saleDate, priceAtCutoff: sim.opts.priceAtCutoff };
  const rows = [];
  rows.push(['Method','Symbol','Units','BuyDate','Cost','Proceeds','Gain','HeldDays','Taxable']);
  let totalUnits=0, totalCost=0, totalProceeds=0, totalGain=0, totalTaxable=0;
  let totalTaxablePre = 0, totalTaxablePost = 0;
  for(const l of lots){
    const br = computeTaxOnLots([l], opts);
    const taxable = br.taxableTotal;
    rows.push([methodKey, sim.sym, nN(l.units,6), l.buyDate||'', n2(l.cost), n2(l.proceeds), n2(l.gain), l.heldDays||0, n2(taxable)]);
    totalUnits += (l.units||0);
    totalCost += (l.cost||0);
    totalProceeds += (l.proceeds||0);
    totalGain += (l.gain||0);
    totalTaxable += taxable||0;
  }
  // Totals row
  rows.push([]);
  rows.push(['Totals', sim.sym, nN(totalUnits,6), '', n2(totalCost), n2(totalProceeds), n2(totalGain), '', n2(totalTaxable)]);
  // Summary / net tax change
  let netDelta = 0;
  if(methodKey==='FIFO' && sim.fifoFull) netDelta = sim.fifoFull.delta || 0;
  if(methodKey==='LIFO' && sim.lifoFull) netDelta = sim.lifoFull.delta || 0;
  rows.push(['Summary','Net tax change', n2(netDelta)]);
  const csv = rows.map(r=>r.map(c=>typeof c==='string'&&c.includes(',')?`"${c.replace(/"/g,'""')}"`:c).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const filename = `cgt-${sim.sym}-${methodKey}-${new Date().toISOString().slice(0,10)}.csv`;
  triggerDownload(url, filename);
}

function cgtShowExportPreview(method){
  if(!cgtLastSim){ notify('Run a simulation first','err'); return; }
  const sim = cgtLastSim;
  const methodKey = (method||'FIFO').toUpperCase();
  const lots = methodKey==='LIFO' ? sim.lifo.lots : sim.fifo.lots;
  const opts = { cpiRate: sim.opts.cpi, cumulativeInflation: sim.opts.cumulativeInflation, saleDate: sim.opts.saleDate, priceAtCutoff: sim.opts.priceAtCutoff };
  let rowsHtml = lots.length ? `<table style="width:100%;border-collapse:collapse"><thead><tr style="color:var(--text3);border-bottom:1px solid var(--border)"><th>Units</th><th>Buy Date</th><th>Cost</th><th>Proceeds</th><th>Gain</th><th>HeldDays</th><th>Taxable</th></tr></thead><tbody>` : '<div class="empty">No lots selected</div>';
  let totalUnits=0, totalCost=0, totalProceeds=0, totalGain=0, totalTaxable=0;
  for(const l of lots){
    const br = computeTaxOnLots([l], opts);
    const taxable = br.taxableTotal;
    rowsHtml += `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px">${nN(l.units,6)}</td><td style="padding:6px">${l.buyDate||''}</td><td style="padding:6px">${n2(l.cost)}</td><td style="padding:6px">${n2(l.proceeds)}</td><td style="padding:6px">${n2(l.gain)}</td><td style="padding:6px">${l.heldDays||0}</td><td style="padding:6px">${n2(taxable)}</td></tr>`;
    totalUnits += (l.units||0);
    totalCost += (l.cost||0);
    totalProceeds += (l.proceeds||0);
    totalGain += (l.gain||0);
    totalTaxable += taxable||0;
  }
  if(lots.length) rowsHtml += `</tbody></table>`;
  const netDelta = methodKey==='FIFO' && sim.fifoFull ? sim.fifoFull.delta : (methodKey==='LIFO' && sim.lifoFull ? sim.lifoFull.delta : 0);

  const inner = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:14px;font-weight:700">Export preview — ${escHtml(sim.sym)} (${methodKey})</div>
      <button onclick="closeHudPopup('cgt-export-preview')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px">✕</button>
    </div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:8px">Person: ${getPersonLabel(sim.person)} · Units: ${nN(sim.units||0,6)} · Price: ${n2(sim.price)}</div>
    <div style="max-height:320px;overflow:auto;margin-bottom:8px">${rowsHtml}</div>
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px">
      <div style="font-weight:700">Totals</div>
      <div>Units: ${nN(totalUnits,6)}</div>
      <div>Cost: ${n2(totalCost)}</div>
      <div>Proceeds: ${n2(totalProceeds)}</div>
      <div>Gain: ${n2(totalGain)}</div>
      <div>Taxable: ${n2(totalTaxable)}</div>
    </div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Estimated net-tax change if realised: <b>${n2(netDelta)}</b></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" onclick="closeHudPopup('cgt-export-preview')">Cancel</button>
      <button class="btn btn-g" onclick="(function(){ closeHudPopup('cgt-export-preview'); cgtExportLotsCSV('${methodKey}'); })()">Export CSV</button>
    </div>
  `;

  openHudPopup('cgt-export-preview', inner, { minWidth: '640px' });
}

function cgtShowMethodDetails(method){
  if(!cgtLastSim){ notify('Run a simulation first','err'); return; }
  const sim = cgtLastSim;
  const methodKey = (method||'FIFO').toUpperCase();
  const lots = methodKey==='LIFO' ? sim.lifo.lots : sim.fifo.lots;
  const opts = sim.opts || {};
  const saleDate = opts.saleDate ? new Date(opts.saleDate) : new Date();
  const marginalRateOverride = (opts.marginalRate != null && !isNaN(opts.marginalRate)) ? opts.marginalRate : null;
  const priceAtCutoff = opts.priceAtCutoff != null ? opts.priceAtCutoff : null;
  const cutoff = cgtCutoffDateObj();
  const isPost = (saleDate > cutoff);

  let rowsHtml = lots.length ? `<table style="width:100%;border-collapse:collapse"><thead><tr style="color:var(--text3);border-bottom:1px solid var(--border)"><th>Units</th><th>Buy Date</th><th>Cost</th><th>Proceeds</th><th>Gain</th><th>HeldDays</th><th>Calc</th><th>Taxable</th></tr></thead><tbody>` : '<div class="empty">No lots selected</div>';
  let totalUnits=0, totalCost=0, totalProceeds=0, totalGain=0, totalTaxable=0;
  let totalTaxablePre = 0, totalTaxablePost = 0;
  for(const l of lots){
    const years = (l.heldDays||0)/365;
    let taxable=0, calcText='';
    const buyDate = l.buyDate ? new Date(l.buyDate) : null;
    const boughtBeforeCutoff = buyDate ? (buyDate < new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate()+1)) : false;

    if(!isPost){
      const longTerm = l.heldDays > 365;
      if(longTerm && l.gain>0){ taxable = l.gain * 0.5; calcText = `50% discount on ${n2(l.gain)} → ${n2(taxable)}`; }
      else { taxable = l.gain; calcText = `No discount → ${n2(taxable)}`; }

      rowsHtml += `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px">${nN(l.units,6)}</td><td style="padding:6px">${l.buyDate||''}</td><td style="padding:6px">${n2(l.cost)}</td><td style="padding:6px">${n2(l.proceeds)}</td><td style="padding:6px">${n2(l.gain)}</td><td style="padding:6px">${l.heldDays||0}</td><td style="padding:6px">${escHtml(calcText)}</td><td style="padding:6px">${n2(taxable)}</td></tr>`;
      totalTaxablePre += taxable||0;
    } else if(boughtBeforeCutoff && saleDate > cutoff){
      // split into pre/post rows
      if(priceAtCutoff && priceAtCutoff > 0){
        const units = l.units || 1;
        const valueAtCutoff = units * priceAtCutoff;
        const gainPre = Math.max(0, valueAtCutoff - l.cost);
        const preHeldDays = Math.max(0, Math.floor((cutoff - buyDate) / 86400000));
        const longPre = preHeldDays > 365;
        const taxablePre = (longPre && gainPre > 0) ? gainPre * 0.5 : gainPre;

        // Index value@cutoff forward to sale date
        const yearsAfterCutoff = Math.max(0, (saleDate - cutoff) / (365*86400000));
        let factorAfter;
        if(opts && opts.cumulativeInflation != null && !isNaN(Number(opts.cumulativeInflation))){
          factorAfter = 1 + (Number(opts.cumulativeInflation) / 100);
        } else {
          factorAfter = Math.pow(1 + ((opts.cpi||0)/100), yearsAfterCutoff);
        }
        const indexedBase = valueAtCutoff * factorAfter;
        const gainPost = l.proceeds - indexedBase;
        const taxablePost = gainPost;

        taxable = (taxablePre||0) + (taxablePost||0);
        totalTaxablePre += (taxablePre||0);
        totalTaxablePost += (taxablePost||0);

        const preCalc = `Pre@${CGT_CUTOFF_LABEL}: value ${n2(valueAtCutoff)} - cost ${n2(l.cost)} = gain ${n2(gainPre)}; ${longPre? '50% discount → ' + n2(taxablePre) : 'No discount → ' + n2(taxablePre)}`;
        const postCalc = `Post: indexed base ${n2(indexedBase)} (value@cutoff ${n2(valueAtCutoff)} * CPI factor ${nN(factorAfter,6)}) → gain ${n2(gainPost)} → taxable ${n2(taxablePost)}`;

        rowsHtml += `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px">${nN(l.units,6)}</td><td style="padding:6px">${l.buyDate||''}</td><td style="padding:6px">${n2(l.cost)}</td><td style="padding:6px">${n2(valueAtCutoff)}</td><td style="padding:6px">${n2(gainPre)}</td><td style="padding:6px">${preHeldDays}</td><td style="padding:6px">${escHtml(preCalc)}</td><td style="padding:6px">${n2(taxablePre)}</td></tr>`;
        rowsHtml += `<tr style="background:rgba(0,0,0,0.02);border-bottom:1px solid var(--border)"><td style="padding:6px">${nN(l.units,6)}</td><td style="padding:6px"></td><td style="padding:6px">${n2(indexedBase)}</td><td style="padding:6px">${n2(l.proceeds)}</td><td style="padding:6px">${n2(gainPost)}</td><td style="padding:6px">${Math.max(0, Math.floor((saleDate - cutoff) / 86400000))}</td><td style="padding:6px">${escHtml(postCalc)}</td><td style="padding:6px">${n2(taxablePost)}</td></tr>`;
      } else {
        // fallback: time apportionment shown as two rows
        const totalDays = Math.max(1, (saleDate - buyDate) / 86400000);
        const preDays = Math.max(0, Math.min((cutoff - buyDate) / 86400000, totalDays));
        const propPre = preDays / totalDays;
        const gainPre = Math.max(0, l.gain * propPre);
        const taxablePre = (preDays > 365 && gainPre > 0) ? gainPre * 0.5 : gainPre;
        const taxablePost = l.gain - gainPre;
        taxable = taxablePre + taxablePost;
        totalTaxablePre += (taxablePre||0);
        totalTaxablePost += (taxablePost||0);

        const preCalc = `Apportioned pre ${nN(propPre*100,2)}% → gain ${n2(gainPre)} ${preDays>365? '(50% discount applied)':''}`;
        const postCalc = `Apportioned post ${nN((1-propPre)*100,2)}% → gain ${n2(l.gain - gainPre)}`;

        rowsHtml += `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px">${nN(l.units,6)}</td><td style="padding:6px">${l.buyDate||''}</td><td style="padding:6px">${n2(l.cost)}</td><td style="padding:6px">${n2(l.gain*propPre)}</td><td style="padding:6px">${n2(gainPre)}</td><td style="padding:6px">${Math.floor(preDays)}</td><td style="padding:6px">${escHtml(preCalc)}</td><td style="padding:6px">${n2(taxablePre)}</td></tr>`;
        rowsHtml += `<tr style="background:rgba(0,0,0,0.02);border-bottom:1px solid var(--border)"><td style="padding:6px">${nN(l.units,6)}</td><td style="padding:6px"></td><td style="padding:6px">${n2(l.cost)}</td><td style="padding:6px">${n2(l.gain*(1-propPre))}</td><td style="padding:6px">${n2(l.gain - gainPre)}</td><td style="padding:6px">${Math.max(0, Math.floor((saleDate - cutoff) / 86400000))}</td><td style="padding:6px">${escHtml(postCalc)}</td><td style="padding:6px">${n2(taxablePost)}</td></tr>`;
      }
    } else {
      // Default post-cutoff treatment for lots that do not cross the cutoff: apply indexation
      const factor = Math.pow(1 + ((opts.cpi||0)/100), years);
      const adjCost = l.cost * factor;
      taxable = l.proceeds - adjCost;
      calcText = `Indexation: cost ${n2(l.cost)} * ${nN(factor,6)} → ${n2(adjCost)}; taxable = ${n2(l.proceeds)} - ${n2(adjCost)} = ${n2(taxable)}`;

      rowsHtml += `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px">${nN(l.units,6)}</td><td style="padding:6px">${l.buyDate||''}</td><td style="padding:6px">${n2(l.cost)}</td><td style="padding:6px">${n2(l.proceeds)}</td><td style="padding:6px">${n2(l.gain)}</td><td style="padding:6px">${l.heldDays||0}</td><td style="padding:6px">${escHtml(calcText)}</td><td style="padding:6px">${n2(taxable)}</td></tr>`;
    }

    // aggregate totals once per lot
    totalUnits += (l.units||0); totalCost += (l.cost||0); totalProceeds += (l.proceeds||0); totalGain += (l.gain||0); totalTaxable += taxable||0;
  }
  if(lots.length) rowsHtml += `</tbody></table>`;

  // compute marginal/full tax impacts if possible
  let marginal = null, full = null, baseIncome = 0;
  try{
    const recFY = dateToFY(new Date().toISOString().slice(0,10)) - 1;
    const taxRec = getTaxRecord(recFY) || {};
    const personRec = taxRec[sim.person] || {};
    baseIncome = $('cgt-sim-income') ? parseFloat($('cgt-sim-income').value) || 0 : 0;
    const saleFY = (typeof dateToFY === 'function') ? dateToFY(saleDate.toISOString().slice(0,10)) : null;
    marginal = marginalTaxOnGain(totalTaxable, baseIncome, saleFY);
    // reuse stored full-deltas if present
    if(methodKey==='FIFO' && sim.fifoFull) full = sim.fifoFull.delta; else if(methodKey==='LIFO' && sim.lifoFull) full = sim.lifoFull.delta;
  }catch(e){ }

  // compute post-cutoff totals and 30% floor for display
  // taxByRate mirrors the helper defined inside cgtRunSimulation — it's
  // redefined here because that one is local to cgtRunSimulation and isn't
  // in scope in this function (this only matters when a lot has a nonzero
  // post-cutoff taxable amount, i.e. sale date is after 30/06/2027).
  function taxByRate(taxable){
    if(!isFinite(taxable)) return 0;
    if(marginalRateOverride != null && !isNaN(marginalRateOverride)) return +(taxable * (marginalRateOverride/100)).toFixed(2);
    const saleFY = (typeof dateToFY === 'function') ? dateToFY(saleDate.toISOString().slice(0,10)) : null;
    return marginalTaxOnGain(taxable, baseIncome, saleFY);
  }
  const preByRate = totalTaxablePre ? taxByRate(totalTaxablePre) : 0;
  const postByRate = totalTaxablePost ? taxByRate(totalTaxablePost) : 0;
  const postFloor = +(totalTaxablePost * 0.30).toFixed(2);
  let displayMarginal = null;
  if(marginal != null){
    // Apply 30% minimum floor to the post-cutoff portion only, but keep
    // the pre-cutoff marginal tax for the pre portion. Sum both parts.
    const postUsed = Math.max(postByRate, postFloor);
    displayMarginal = +(preByRate + postUsed).toFixed(2);
  }

  const inner = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:14px;font-weight:700">Detailed calculations — ${escHtml(sim.sym)} (${methodKey})</div>
      <button onclick="closeHudPopup('cgt-method-details')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px">✕</button>
    </div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:8px">
      Sell date: ${saleDate.toISOString().slice(0,10)} · ${opts && opts.cumulativeInflation!=null ? ('Cumulative inflation: '+n2(opts.cumulativeInflation)+'%') : ('CPI: '+n2(opts.cpi||0)+'%')} · Mode: inferred (date split) · Sale price/unit: ${n2(sim.price)}${marginalRateOverride!=null?(' · Marginal %: '+n2(marginalRateOverride)):''}${priceAtCutoff!=null?(' · Price@'+CGT_CUTOFF_LABEL+': '+n2(priceAtCutoff)):''}
      <br>Income used: ${n2(baseIncome||0)}${$('cgt-sim-income-note') && $('cgt-sim-income-note').textContent ? ' (' + $('cgt-sim-income-note').textContent + ')' : ''}
    </div>
    <div style="max-height:360px;overflow:auto;margin-bottom:8px">${rowsHtml}</div>
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px">
      <div style="font-weight:700">Totals</div>
      <div>Units: ${nN(totalUnits,6)}</div>
      <div>Cost: ${n2(totalCost)}</div>
      <div>Proceeds: ${n2(totalProceeds)}</div>
      <div>Gain: ${n2(totalGain)}</div>
      <div>Taxable: ${n2(totalTaxable)}</div>
    </div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px">${full!=null?('Full tax delta (incl HECS/MLS): <b>'+n2(full)+'</b>'):(displayMarginal!=null?('Estimated marginal tax change: <b>'+n2(displayMarginal)+'</b>'):'n/a')}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" onclick="closeHudPopup('cgt-method-details')">Close</button>
      <button class="btn btn-g" onclick="(function(){ closeHudPopup('cgt-method-details'); cgtShowExportPreview('${methodKey}'); })()">Export these lots</button>
    </div>
  `;
  openHudPopup('cgt-method-details', inner, { minWidth: '760px' });
}

// Run built-in example scenarios for manual testing and validation
function cgtRunExampleScenarios(){
  const cutoff = cgtCutoffDateObj();
  const scenarios = [];

  // Scenario A: bought well before cutoff, sold after, price@cutoff provided
  scenarios.push({
    name: 'Buy 2018 → Sell 2028 (price@cutoff available)',
    lots: [{ units:100, buyDate:'2018-01-15', cost:1000, proceeds:1800, gain:800, heldDays: Math.floor((new Date('2028-01-01')-new Date('2018-01-15'))/86400000) }],
    opts: { saleDate: '2028-01-01', priceAtCutoff: 12, cpiRate:2.5 }
  });

  // Scenario B: bought before cutoff, sold after, no price@cutoff (fallback)
  scenarios.push({
    name: 'Buy 2019 → Sell 2028 (no cutoff price, fallback)',
    lots: [{ units:50, buyDate:'2019-05-20', cost:500, proceeds:900, gain:400, heldDays: Math.floor((new Date('2028-02-01')-new Date('2019-05-20'))/86400000) }],
    opts: { saleDate: '2028-02-01', priceAtCutoff: null, cpiRate:2.5 }
  });

  // Scenario C: bought after cutoff
  scenarios.push({
    name: 'Buy 2028 → Sell 2029 (post-cutoff acquisition)',
    lots: [{ units:10, buyDate:'2028-03-01', cost:1000, proceeds:1200, gain:200, heldDays: Math.floor((new Date('2029-03-01')-new Date('2028-03-01'))/86400000) }],
    opts: { saleDate: '2029-03-01', priceAtCutoff: null, cpiRate:2.5 }
  });

  let out = '<div style="font-size:13px"><b>Example scenarios</b></div>';
  out += '<div style="margin-top:8px">';
  for(const s of scenarios){
    const br = computeTaxOnLots(s.lots, s.opts);
    out += `<div style="margin-bottom:10px;padding:8px;border:1px solid var(--border);border-radius:6px">`;
    out += `<div style="font-weight:700">${escHtml(s.name)}</div>`;
    out += `<div>Taxable pre-cutoff: ${n2(br.taxablePre)} · Taxable post-cutoff: ${n2(br.taxablePost)} · Total taxable: ${n2(br.taxableTotal)}</div>`;
    out += `</div>`;
  }
  out += '</div>';
  openHudPopup('cgt-examples', out, { minWidth: '600px' });
}

function cgtUpdateSlider(){
  const symEl = $('cgt-sim-symbol');
  const personEl = $('cgt-sim-person');
  const modeEl = $('cgt-sim-mode');
  const inputEl = $('cgt-sim-units');
  const slider = $('cgt-sim-slider');
  const label = $('cgt-sim-slider-val');
  if(!symEl || !slider || !modeEl || !personEl){ if(label) label.textContent='—'; return; }
  const sym = symEl.value;
  let person = personEl.value;
  // Auto-select the person based on symbol ownership when symbol changes
  if(sym){
    try{
      const owner = getSymbolOwner(sym);
      if(owner && personEl.value !== owner){ personEl.value = owner; person = owner; }
    }catch(e){ /* ignore if helper missing */ }
  }
  const mode = modeEl.value;
  const { openParcels } = computeCGTSummary();
  const fullList = (openParcels[sym]||[]).filter(p=>p.units>0.000001);
  const share = (typeof ownerShare==='function') ? ownerShare(sym, person) : (getSymbolOwner(sym)===person?1:(getSymbolOwner(sym)==='joint'?0.5:0));
  const availableUnits = fullList.reduce((s,p)=>s + (p.units * share), 0);
  const price = prices[priceSymbol(sym)] || 0;
  // load stored cutoff price for this symbol (if any)
  const storedCutoffPrice = cgtLoadCutoffPrice(sym);
  if(storedCutoffPrice != null){ const elCutoff = $('cgt-sim-price-cutoff'); if(elCutoff) elCutoff.value = storedCutoffPrice; }

  if(mode === 'dollars'){
    if(price <= 0 || availableUnits <= 0){ slider.disabled = true; slider.max = 0; slider.value = 0; if(label) label.textContent='—'; return; }
    const maxD = Math.round(price * availableUnits);
    slider.disabled = false;
    slider.min = 0; slider.max = maxD; slider.step = 1;
    const inVal = parseFloat(inputEl?.value);
    if(!isNaN(inVal)) slider.value = Math.min(Math.max(0, inVal), maxD);
    else slider.value = maxD;
    if(label) label.textContent = '$' + n2(Number(slider.value));
  } else {
    if(availableUnits <= 0){ slider.disabled = true; slider.max = 0; slider.value = 0; if(label) label.textContent='—'; return; }
    slider.disabled = false;
    slider.min = 0; slider.max = +availableUnits.toFixed(6); slider.step = 0.0001;
    const inVal = parseFloat(inputEl?.value);
    if(!isNaN(inVal)) slider.value = Math.min(Math.max(0, inVal), availableUnits);
    else slider.value = +availableUnits.toFixed(6);
    if(label) label.textContent = nN(Number(slider.value),6) + ' units';
  }
}

function cgtSyncUnitsFromInput(el){
  // keep slider in sync while typing
  const mode = $('cgt-sim-mode') ? $('cgt-sim-mode').value : 'units';
  const slider = $('cgt-sim-slider');
  const label = $('cgt-sim-slider-val');
  if(!slider) return;
  const v = parseFloat(el.value);
  if(isNaN(v)) return;
  if(mode === 'dollars'){
    slider.value = Math.min(Math.max(Number(slider.min||0), v), Number(slider.max||0));
    if(label) label.textContent = '$' + n2(Number(slider.value));
  } else {
    slider.value = Math.min(Math.max(Number(slider.min||0), v), Number(slider.max||0));
    if(label) label.textContent = nN(Number(slider.value),6) + ' units';
  }
}

function cgtSyncSliderChange(sl){
  const mode = $('cgt-sim-mode') ? $('cgt-sim-mode').value : 'units';
  const input = $('cgt-sim-units');
  const label = $('cgt-sim-slider-val');
  if(!input) return;
  if(mode === 'dollars'){
    input.value = Number(sl.value);
    if(label) label.textContent = '$' + n2(Number(sl.value));
  } else {
    input.value = Number(sl.value);
    if(label) label.textContent = nN(Number(sl.value),6) + ' units';
  }
}

function cgtOnPersonChange(){
  const person = $('cgt-sim-person') ? $('cgt-sim-person').value : null;
  if(person) cgtAutoFillIncome(person);
  cgtUpdateSlider();
  // Auto-run simulation when person/income auto-fills
  try{ setTimeout(()=>{ cgtRunSimulation(); }, 50); }catch(e){ }
}

function cgtSaveCutoffPrice(){
  try{
    const sym = $('cgt-sim-symbol') ? $('cgt-sim-symbol').value : null;
    if(!sym) return;
    const v = parseFloat($('cgt-sim-price-cutoff')?.value);
    const map = JSON.parse(localStorage.getItem('pt_price_cgt_cutoff')||'{}');
    if(!isNaN(v)) map[sym] = v; else delete map[sym];
    localStorage.setItem('pt_price_cgt_cutoff', JSON.stringify(map));
  }catch(e){ }
}

function cgtLoadCutoffPrice(sym){
  try{
    const map = JSON.parse(localStorage.getItem('pt_price_cgt_cutoff')||'{}');
    return map[sym];
  }catch(e){ return null; }
}

// Fetch the cutoff-date price from a configurable price-feed endpoint.
// Configure the feed URL in localStorage under key 'pt_price_feed_url'.
// The feed is expected to accept query params `symbol` and `date` and return JSON: { price: number }
function cgtFetchCutoffPrice(){
  const sym = $('cgt-sim-symbol') ? $('cgt-sim-symbol').value : null;
  if(!sym){ notify('Select a symbol first','err'); return; }
  const feedUrl = localStorage.getItem('pt_price_feed_url');
  if(!feedUrl){ notify('No price-feed configured. Set localStorage key pt_price_feed_url', 'err'); return; }
  const date = CGT_CUTOFF_DATE;
  const url = (feedUrl.indexOf('?')>-1) ? (feedUrl + '&symbol=' + encodeURIComponent(sym) + '&date=' + encodeURIComponent(date)) : (feedUrl + '?symbol=' + encodeURIComponent(sym) + '&date=' + encodeURIComponent(date));
  notify('Fetching price for '+sym+' at '+date+'...','');
  fetch(url).then(r=>r.json()).then(j=>{
    if(j && (j.price||j.price===0)){
      $('cgt-sim-price-cutoff').value = Number(j.price);
      cgtSaveCutoffPrice();
      notify('Loaded price '+n2(j.price),'ok');
      cgtRunSimulation();
    } else {
      notify('Feed returned no price','err');
    }
  }).catch(e=>{ notify('Failed to fetch price: '+(e.message||e),'err'); });
}

function cgtAutoFillIncome(person){
  try{
    const curFY = dateToFY(new Date().toISOString().slice(0,10));
    const prevFY = curFY - 1;
    const rec = getTaxRecord(prevFY) || {};
    const pRec = rec[person] || {};
    const salaryNet = (+pRec.salary || 0) - (+pRec.sacrifice || 0);
    const myDivs = (dividends||[]).filter(d=>dateToFY(d.date)===prevFY && ['dividend','distribution','drp','interest'].includes(d.type))
      .reduce((s,d)=>{ const own = getSymbolOwner(d.symbol); const share = own===person ? 1 : (own==='joint'?0.5:0); return s + ((+d.amount||0) * share); },0);
    const myFrank = (dividends||[]).filter(d=>dateToFY(d.date)===prevFY && ['dividend','distribution','drp','interest'].includes(d.type))
      .reduce((s,d)=>{ const own = getSymbolOwner(d.symbol); const share = own===person ? 1 : (own==='joint'?0.5:0); return s + frankingCredit((+d.amount||0)*share, d.frankingPct||0); },0);
    const cgts = computeCGTSummary();
    const myCGT = ((cgts.result||{})[person]||{})[prevFY] ? +(((cgts.result||{})[person]||{})[prevFY].netCapitalGain||0) : 0;

    let netPropGain = 0, netPropLoss = 0, investInterestDeduction = 0;
    (properties||[]).forEach(p=>{
      const pOwner = p.owner || 'lumia';
      const isOwner = pOwner===person || pOwner==='joint';
      if(!isOwner) return;
      const share = pOwner==='joint' ? 0.5 : 1;
      if(p.propType === 'ppor') return;
      const annualRent = (p.weeklyRent||0)*52*share;
      const recp = (rec.props && rec.props[p.id]) ? rec.props[p.id] : {};
      const splits = normaliseSplits(p);
      let rentalInterest = 0, invInterest = 0;
      splits.forEach(sp=>{
        const purpose = sp.purpose || 'rental';
        const bal = +sp.balance||0, off = +sp.offset||0, rate = +sp.rate||0;
        const annInt = Math.max(0, bal - off) * (rate/100);
        if(purpose === 'investment') invInterest += annInt; else if(purpose === 'rental') rentalInterest += annInt;
      });
      investInterestDeduction += invInterest * share;
      const expenses = share * ((+recp.rates||0)+(+recp.insurance||0)+(+recp.repairs||0)+(+recp.agent||0)+(+recp.other||0)+(+recp.depr_bldg||0)+(+recp.depr_pe||0)) + rentalInterest*share;
      if(annualRent - expenses >= 0) netPropGain += (annualRent - expenses); else netPropLoss += (expenses - annualRent);
    });

    const taxableIncome = salaryNet + myDivs + myFrank - investInterestDeduction + netPropGain - netPropLoss + myCGT;
    const input = $('cgt-sim-income');
    if(input) {
      input.value = Math.round(taxableIncome) || 0;
      const noteEl = $('cgt-sim-income-note'); if(noteEl) noteEl.textContent = '(auto-filled)';
    }
  }catch(e){ /* ignore */ }
}

// Auto-snapshot current prices for portfolio symbols on the cutoff date.
// Runs once (sets a saved flag) to avoid duplicate captures.
function cgtAutoSnapshotCutoffPrice(){
  try{
    const savedFlag = localStorage.getItem('pt_price_cgt_cutoff_auto_saved');
    const today = new Date();
    const target = cgtCutoffDateObj();
    if(today < target) return; // not reached yet
    if(savedFlag) return; // already auto-saved
    // gather symbols from trades (portfolio symbols) and holdings
    const syms = new Set();
    (trades||[]).forEach(t=>{ if(t.symbol) syms.add(t.symbol); });
    // also include symbols from properties/tracked parcels if present
    try{ const { openParcels } = computeCGTSummary(); Object.keys(openParcels||{}).forEach(s=>{ if(!s.startsWith('_stash_')) syms.add(s); }); }catch(e){}
    const map = JSON.parse(localStorage.getItem('pt_price_cgt_cutoff')||'{}');
    let any = false;
    syms.forEach(sym=>{
      const p = prices[priceSymbol(sym)];
      if(p != null && !isNaN(p)){
        map[sym] = p; any = true;
      }
    });
    if(any){
      localStorage.setItem('pt_price_cgt_cutoff', JSON.stringify(map));
      localStorage.setItem('pt_price_cgt_cutoff_auto_saved', new Date().toISOString());
      notify('Auto-saved portfolio prices for '+CGT_CUTOFF_LABEL,'ok');
    } else {
      // still set flag to avoid reattempt loops; user can fetch manually later
      localStorage.setItem('pt_price_cgt_cutoff_auto_saved', new Date().toISOString());
    }
  }catch(e){ /* ignore */ }
}