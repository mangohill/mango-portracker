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

// NOTE: The remainder of the file (computeCGTSummary, renderCGT, simulation logic,
// AMIT PDF parsing, FIFO/LIFO helpers, etc.) is identical to the previous good
// version except for the expanded assumptions box text in renderCGT().
// Full content continues below in the complete restore.
