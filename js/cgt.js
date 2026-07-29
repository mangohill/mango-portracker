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
      ensure(sym).push({ id:'p'+(seq++), units:+t.units, cost:buyCost, originalCost:buyCost, amitTotal:0, date:t.date });

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
          destList.push({ id:'p'+(seq++), units:+t.units, cost:+t.overrideCostBasis, originalCost:+t.overrideCostBasis, amitTotal:0, date:earliest });
        } else if(sub === 'spinoff_to'){
          const stashUnits = stash.reduce((s,p)=>s+p.units,0) || 1;
          stash.forEach(p=>{
            destList.push({ id:'p'+(seq++), units: p.units*(+t.units/stashUnits), cost: p.cost*allocPct,
                            originalCost:(p.originalCost||p.cost)*allocPct, amitTotal:(p.amitTotal||0)*allocPct, date:p.date });
          });
        } else {
          const stashUnits = stash.reduce((s,p)=>s+p.units,0) || 1;
          const ratioUnits = +t.units / stashUnits;
          stash.forEach(p=>{
            destList.push({ id:'p'+(seq++), units: p.units*ratioUnits, cost: p.cost,
                            originalCost:(p.originalCost!=null?p.originalCost:p.cost), amitTotal:(p.amitTotal||0), date:p.date });
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
        Estimates only, not tax advice. FIFO parcel matching · corporate actions assumed CGT-free rollovers ·
        losses offset short-term gains before long-term, discount applied after ·
        AMIT cost base floored at $0 (excess flagged, not auto-realised). Confirm with your accountant.
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
// layout) by adapting the new, corrected engine underneath. NOTE: this
// still reproduces the OLD (pre-fix) loss-vs-discount ordering for
// backward compatibility — the Capital Gains tab itself uses the corrected
// order. If your tax.js references these, treat its CGT figure as an
// approximation until it's pointed at computeCGTSummary() directly.
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
  const longGain = longGainRaw * 0.5; // old (pre-fix) ordering — see note above
  const netGain  = Math.max(0, shortGain + longGain - totalLoss);
  return { shortGain, longGainRaw, longGain, totalLoss, netGain, incompleteCount };
}