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
  amitAdjustments = amitAdjustments.filter(a=>a.id!==id);
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
        if(newCost < 0){ capped += -newCost; newCost = 0; }
        p.cost = newCost;
      });
      if(capped > 0.005) amitLog.push({ symbol:e.symbol, date:e.date, amount:e.amount, capped });
      continue;
    }

    const t = e, sym = t.symbol;

    if(t.type === 'buy' || t.type === 'drp'){
      ensure(sym).push({ id:'p'+(seq++), units:+t.units, cost:(+t.units * +t.price) + (+t.fees||0), date:t.date });

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
          destList.push({ id:'p'+(seq++), units:+t.units, cost:+t.overrideCostBasis, date:earliest });
        } else if(sub === 'spinoff_to'){
          const stashUnits = stash.reduce((s,p)=>s+p.units,0) || 1;
          stash.forEach(p=>{
            destList.push({ id:'p'+(seq++), units: p.units*(+t.units/stashUnits), cost: p.cost*allocPct, date:p.date });
          });
        } else {
          const stashUnits = stash.reduce((s,p)=>s+p.units,0) || 1;
          const ratioUnits = +t.units / stashUnits;
          stash.forEach(p=>{
            destList.push({ id:'p'+(seq++), units: p.units*ratioUnits, cost: p.cost, date:p.date });
          });
        }
        if(sub === 'spinoff_to'){
          const parentList = ensure(fromSym);
          stash.forEach(p=> parentList.push({ ...p, cost: p.cost*(1-allocPct) }));
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
  const { disposals, amitLog } = buildDisposals();
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

  return { disposals, propDisposals, amitLog, byPersonFY, result, persons };
}

// ── RENDER ────────────────────────────────────────────────────────────
let cgtFY = null;
let cgtExpanded = {};
let cgtSymFilter = '';

function renderCGT(){
  const panel = $('panel-cgt');
  if(!panel) return;

  const summary = computeCGTSummary();
  const { disposals, propDisposals, amitLog, result, persons } = summary;

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
        <thead><tr><th>PROPERTY</th><th>SOLD</th><th>OWNER</th><th>COST BASE</th><th>PROCEEDS</th><th>GAIN/LOSS</th><th>DISCOUNT</th></tr></thead>
        <tbody>
          ${fyProps.map(p=>`<tr>
            <td><b>${escHtml(p.name)}</b></td>
            <td>${p.soldDate}</td>
            <td>${getPersonLabel(p.owner)}</td>
            <td>${p.exempt?'—':n2(p.costBase)}</td>
            <td>${p.exempt?'—':n2(p.proceeds)}</td>
            <td class="${p.exempt?'neu':clr(p.gain)}">${p.exempt?'Exempt (main residence)':n2(p.gain)}</td>
            <td>${p.exempt?'—':(p.longTerm&&p.gain>0?'<span class="badge b-etf">50%</span>':(p.longTerm?'n/a (loss)':'—'))}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>` : '';

  const symbolsInUse = [...new Set(trades.map(t=>t.symbol).filter(Boolean))].sort();
  const amitRows = [...amitAdjustments].sort((a,b)=>b.date.localeCompare(a.date));
  const amitBodyHtml = amitRows.length ? amitRows.map(a=>`<tr>
    <td>${a.date}</td>
    <td><b>${escHtml(a.symbol)}</b></td>
    <td style="color:${a.amount>=0?'var(--green)':'var(--red)'}">${a.amount>=0?'+':''}${n2(a.amount)}</td>
    <td style="color:var(--text3);font-size:11px">${escHtml(a.notes)}</td>
    <td><button class="del-btn" onclick="deleteAmitAdjustment('${a.id}');renderCGT()">✕</button></td>
  </tr>`).join('') : '<tr><td colspan="5" class="empty">No AMIT adjustments recorded yet.</td></tr>';

  const carryInSettings = getCGTLossCarryIn();
  const carryInHtml = persons.map(person=>{
    const c = carryInSettings[person] || {};
    return `<div class="fgi">
      <label class="fl">${getPersonLabel(person)} — Opening Capital Loss Carry-Forward</label>
      <div style="display:flex;gap:8px">
        <input class="fi" type="number" step="any" min="0" placeholder="Amount"
          id="cgt-carryin-amt-${person}" value="${c.amount||''}" style="flex:1">
        <input class="fi" type="number" step="1" placeholder="As at FY (e.g. ${dateToFY(new Date().toISOString().slice(0,10))})"
          id="cgt-carryin-fy-${person}" value="${c.fy||''}" style="width:170px">
      </div>
    </div>`;
  }).join('');

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
      <div class="fst">AMIT COST-BASE ADJUSTMENTS</div>
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:10px">
        Enter each distribution's net cost-base adjustment from the fund's annual tax statement.
        Negative = cost base decrease (the common case for tax-deferred distributions).
      </div>
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
      <button class="btn btn-g" onclick="addAmitAdjustmentFromForm()">+ ADD ADJUSTMENT</button>
      <div class="ovx" style="margin-top:14px">
        <table><thead><tr><th>Date</th><th>Symbol</th><th>Adjustment</th><th>Notes</th><th></th></tr></thead>
        <tbody>${amitBodyHtml}</tbody></table>
      </div>
    </div>

    <div class="fs" style="margin-top:16px">
      <div class="fst">OPENING LOSS CARRY-FORWARD</div>
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:10px">
        If you have unused capital losses from before you started tracking here, enter them once —
        future years will carry forward automatically from there.
      </div>
      <div class="fg">${carryInHtml}</div>
      <button class="btn btn-g" onclick="cgtSaveCarryIn()">SAVE CARRY-FORWARD</button>
    </div>
  `;
}

function addAmitAdjustmentFromForm(){
  const sym    = $('amit-sym') ? $('amit-sym').value : '';
  const date   = $('amit-date').value;
  const amount = $('amit-amount').value;
  const notes  = $('amit-notes').value;
  if(addAmitAdjustment(sym, date, amount, notes)){
    notify('✓ AMIT adjustment added');
    renderCGT();
  }
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
