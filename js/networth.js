// ── networth.js ──────────────────────────────────────────────────────
// Consolidated Net Worth tab: combines Portfolio market value, Property
// equity, and Super balance into one number, plus a simple compound-
// growth FIRE projection using the 4% rule against actual spending data
// where available. All read-only against existing data; the only writes
// are the user's own FIRE assumption inputs (growth rate / monthly
// contribution), stored under pt_fire_* so they persist between visits.

function nwPortfolioValue(){
  if(typeof calcH !== 'function' || typeof prices === 'undefined') return 0;
  return calcH().reduce((s,h) => {
    const sym = typeof priceSymbol === 'function' ? priceSymbol(h.symbol) : h.symbol;
    const p = prices[sym];
    return s + (p != null ? p * h.units : 0);
  }, 0);
}

// Live Net Worth = Portfolio + Property Value + Offset Cash + Super − Loan
// (algebraically the same as Portfolio + Property Equity + Offset Cash + Super).
// propMetrics().equity is value minus the FULL loan balance — offset cash isn't
// netted off the loan for that figure (propMetrics' effectiveLoan is separate and
// only used for interest/LVR). The annual FY snapshots below already carry offset
// balances as their own "Cash" line via fyOffsetData, so live Net Worth does the
// same: equity and offset cash are separate figures, and they sum to the same total
// as before.
function nwPropertyEquity(){
  if(typeof properties === 'undefined' || typeof propMetrics !== 'function') return 0;
  return properties.filter(p => !p.sold).reduce((s,p) => s + propMetrics(p).equity, 0);
}
// Gross value of all unsold properties, and the FULL loan balance owed on
// them (offset cash is NOT netted off the loan — it's shown separately as
// Offset Cash and added to net worth on its own line).
function nwPropertyValue(){
  if(typeof properties === 'undefined' || typeof propMetrics !== 'function') return 0;
  return properties.filter(p => !p.sold).reduce((s,p) => s + propMetrics(p).cval, 0);
}
function nwLoanBalance(){
  if(typeof properties === 'undefined' || typeof propMetrics !== 'function') return 0;
  return properties.filter(p => !p.sold).reduce((s,p) => s + propMetrics(p).loanCur, 0);
}
function nwOffsetCash(){
  if(typeof properties === 'undefined' || typeof propMetrics !== 'function') return 0;
  return properties.filter(p => !p.sold).reduce((s,p) => {
    const m = propMetrics(p);
    return s + (m.splits||[]).reduce((t,sp)=>t+(+sp.offset||0),0);
  }, 0);
}

// Property's real annual cash effect, using the exact same "Net Annual
// Income" figure already shown per-property in the Property dashboard
// (annualRent − expenses − annualInterest) — not a separately-derived
// number, so this always matches what you see there. Only counts actual
// rentals (propType !== 'ppor'), same as the dashboard's own rental
// aggregates; a home you live in has no rental income to net off.
// Deliberately interest-only, not full P&I repayments: principal paid
// down builds equity (already excluded from the liquid FIRE balance
// below), so folding it in again here would double-count it.
function nwPropertyCashFlow(){
  if(typeof properties === 'undefined' || typeof propMetrics !== 'function') return 0;
  return properties.filter(p => !p.sold && p.propType !== 'ppor')
    .reduce((s,p) => s + propMetrics(p).annualNetRent, 0);
}

function nwSuperBalance(){
  if(typeof superAccounts === 'undefined') return 0;
  return superAccounts.reduce((s,a) => s + (+a.balance || 0), 0);
}

// Most recent FY's categorised spend, for the FIRE number — falls back
// to null (user must enter manually) if there's no spending data yet.
function nwLatestAnnualSpend(){
  // spendingData lazy-loads only when the Spending tab has been opened this
  // session (see initSpending() in spending.js) — landing on Net Worth first
  // would otherwise silently skip real spending history in favour of the
  // 60,000 fallback below, even though it's sitting in storage.
  if(typeof spendingData === 'undefined') return null;
  if(!spendingData.length && typeof loadSpending === 'function') loadSpending();
  if(!spendingData.length) return null;
  const SP_MONEY_IN = new Set(['__REFUND__','__OTHER_INCOME__']);
  const SP_EXCLUDE = new Set(['__TRANSFERS__']);
  const sumFY = fy => spendingData
    .filter(d => d.fy===fy && d.amount<0 && !SP_MONEY_IN.has(d.category) && !SP_EXCLUDE.has(d.category))
    .reduce((s,d) => s + (-d.amount), 0);
  const allFys = [...new Set(spendingData.map(d=>d.fy))].filter(f=>f!=null).sort((a,b)=>b-a);
  if(!allFys.length) return null;
  // This used to take the newest FY in the data unconditionally. Once you've
  // imported anything since 1 July that is the IN-PROGRESS year — a few months
  // of spend — and the FIRE number (25x this) came out several times too low.
  // Prefer the latest COMPLETE FY; only if the in-progress year is all there
  // is, annualise it by the months elapsed rather than using the raw partial.
  const curFY = +dateToFY(localDateStr());
  const completeFY = allFys.find(f => f < curFY);
  if(completeFY != null){
    const t = sumFY(completeFY);
    if(t > 0) return t;
  }
  const t = sumFY(allFys[0]);
  if(!(t > 0)) return null;
  const monthsElapsed = (new Date().getMonth() + 6) % 12 + 1; // Jul=1 ... Jun=12
  return t / monthsElapsed * 12;
}

function nwFireInputs(){
  const g = parseFloat(localStorage.getItem('pt_fire_growth_pct'));
  const c = parseFloat(localStorage.getItem('pt_fire_monthly_contrib'));
  const s = parseFloat(localStorage.getItem('pt_fire_annual_spend'));
  const age = parseFloat(localStorage.getItem('pt_fire_current_age'));
  const fiAge = parseFloat(localStorage.getItem('pt_fire_fi_age'));
  const reAge = parseFloat(localStorage.getItem('pt_fire_re_age'));
  return {
    growthPct: isFinite(g) ? g : 7,
    monthlyContrib: isFinite(c) ? c : 0,
    annualSpend: isFinite(s) ? s : (nwLatestAnnualSpend() || 60000),
    currentAge: isFinite(age) ? age : null,
    fiAge: isFinite(fiAge) ? fiAge : null,
    reAge: isFinite(reAge) ? reAge : null,
  };
}
function nwSaveFireInputs(){
  const g = parseFloat($('nw-fire-growth').value);
  const c = parseFloat($('nw-fire-contrib').value);
  const s = parseFloat($('nw-fire-spend').value);
  const age = parseFloat($('nw-fire-age').value);
  const fiAge = parseFloat($('nw-fire-fi-age').value);
  const reAge = parseFloat($('nw-fire-re-age').value);
  if(isFinite(g)) localStorage.setItem('pt_fire_growth_pct', g);
  if(isFinite(c)) localStorage.setItem('pt_fire_monthly_contrib', c);
  if(isFinite(s)) localStorage.setItem('pt_fire_annual_spend', s);
  if(isFinite(age))   localStorage.setItem('pt_fire_current_age', age); else localStorage.removeItem('pt_fire_current_age');
  if(isFinite(fiAge)) localStorage.setItem('pt_fire_fi_age', fiAge);   else localStorage.removeItem('pt_fire_fi_age');
  if(isFinite(reAge)) localStorage.setItem('pt_fire_re_age', reAge);   else localStorage.removeItem('pt_fire_re_age');
  renderNetWorth();
}

// Solves for the flat annual contribution C such that, starting from
// balance P and compounding annually at ratePct for `years` (same
// year-end-contribution convention as the forward projection loop:
// bal = bal*(1+r) + C each year), the balance lands exactly on target.
// Standard future-value-of-annuity algebra, just solved for C instead
// of for the ending balance.
function nwRequiredAnnualContribution(P, target, ratePct, years){
  if(years <= 0) return null;
  const r = ratePct/100;
  if(Math.abs(r) < 1e-9) return (target - P) / years;
  const fvFactor = Math.pow(1+r, years);
  return (target - P*fvFactor) * r / (fvFactor - 1);
}

let _nwFireChart = null;
// ── ANNUAL (30 JUNE) SNAPSHOTS ─────────────────────────────────────────
// Persists a per-financial-year record of Holdings, Super, and Property so
// they stay easy to find later and exportable as CSV, rather than only
// ever visible live.
//
// Holdings: backfilled AND kept fresh from calcH(dateStr) + that date's
// stored prices — the app already has daily price history back to ~2018,
// so every past 30 June can be reconstructed accurately, not just future
// ones. Recomputed each time this section renders (cheap — all data's
// already in memory) so a later-corrected trade also fixes past snapshots.
//
// Super: NOT duplicated here — reads directly from each account's own
// fyData (see checkSuperFYRollover in properties.js), which already is
// the 30-June-ish balance history.
//
// Property: has no history at all (properties.js only ever stores a
// single live currentValue, overwritten on every edit) — so this can only
// start capturing from now forward, the first time the app is opened
// after a new FY begins, via checkPropertyFYRollover() in properties.js.
// Past years show "no data" — there was never a historical value stored
// to recover.
const HOLDINGS_FY_STORE_KEY = 'pt_holdings_fy_snapshots';

function loadHoldingsFYSnapshots(){
  try{ return JSON.parse(localStorage.getItem(HOLDINGS_FY_STORE_KEY)) || {}; }
  catch(e){ return {}; }
}
function saveHoldingsFYSnapshots(obj){
  localStorage.setItem(HOLDINGS_FY_STORE_KEY, JSON.stringify(obj));
}

// Reconstructs itemized holdings as of a specific date, using the same
// per-symbol daily/near-date pricing logic markToMarketAt() already uses
// elsewhere (Portfolio Change, Biggest Movers), so this always agrees
// with what those features would say for the same date.
function buildHoldingsSnapshotForDate(dateStr){
  const snap = pfSnapshots[dateStr];
  const holdings = calcH(dateStr).filter(h=>Math.abs(h.units)>1e-9);
  let total = 0, dailyNeeded = 0, dailyPriced = 0;
  const rows = holdings.map(h=>{
    const sym = priceSymbol(h.symbol);
    let p = isDailyPricedSym(sym) ? priceNearOrBefore(sym, dateStr) : (snap && snap.prices && snap.prices[sym]);
    if(p==null && !isDailyPricedSym(sym) && prices[sym]!=null) p = prices[sym]; // carry-forward for manual/monthly-NAV symbols
    if(isDailyPricedSym(sym)){ dailyNeeded++; if(p!=null) dailyPriced++; }
    const mv = p!=null ? p*h.units : null;
    if(mv!=null) total += mv;
    return {
      symbol: h.symbol, assetType: h.assetType, owner: getSymbolOwner(h.symbol), source: h.source,
      units: +h.units.toFixed(6), price: p, mktValue: mv!=null ? +mv.toFixed(2) : null, costBasis: +h.costBasis.toFixed(2),
    };
  });
  return { rows, total: +total.toFixed(2), complete: dailyNeeded===0 || dailyPriced===dailyNeeded };
}

// Backfills every past 30 June once (and refreshes it every render — cheap,
// and keeps a later-corrected trade reflected in old snapshots too).
function refreshHoldingsFYSnapshots(){
  const store = loadHoldingsFYSnapshots();
  const pricedDates = Object.keys(pfSnapshots).filter(d=>pfSnapshots[d]&&pfSnapshots[d].prices&&Object.keys(pfSnapshots[d].prices).length).sort();
  if(!pricedDates.length) return store;
  const earliestYear = +pricedDates[0].slice(0,4);
  const todayStr = localDateStr();
  const curFYEnd = +dateToFY(todayStr);
  for(let y = earliestYear; y <= curFYEnd; y++){
    const targetDate = `${y}-06-30`;
    if(targetDate > todayStr) continue; // hasn't happened yet
    const built = buildHoldingsSnapshotForDate(targetDate);
    // A 30 June before any price data exists (holdings present, nothing
    // priced) totalled to $0 and was stored as "$0 *", reading as a real
    // zero-value portfolio. Treat it as no data instead, and drop any such
    // stale entry a previous version stored.
    const anyPriced = built.rows.some(r=>r.price!=null);
    if(built.rows.length && anyPriced) store[y] = Object.assign({date: targetDate}, built);
    else if(built.rows.length && !anyPriced) delete store[y];
  }
  saveHoldingsFYSnapshots(store);
  return store;
}

// Assembles the combined view for one FY: holdings from the dedicated
// store above, super and property read live from their own fyData.
function getAnnualSnapshot(year){
  const hStore = loadHoldingsFYSnapshots();
  const h = hStore[year] || null;
  const superRows = (typeof superAccounts!=='undefined' ? superAccounts : [])
    .filter(a=>a.fyData && a.fyData[year]!=null)
    .map(a=>({ name: a.name || a.provider || 'Account', balance: +a.fyData[year] }));
  const superTotal = superRows.length ? superRows.reduce((s,r)=>s+r.balance,0) : null;
  // Debt and offset (cash) are stored separately from value (fyData/
  // fyDebtData/fyOffsetData) because fyData predates loan/offset tracking
  // and is still hand-editable per FY in the Property form — folding them
  // into one field would break that. A property with a value for this FY
  // but no matching debt/offset entry (years before those existed, or a
  // manually-typed fyData value) has that figure treated as unknown, not
  // zero: debtKnown/offsetKnown record that so Loan and Cash totals are
  // never silently understated as if nothing were owed/held.
  const propRows = (typeof properties!=='undefined' ? properties : [])
    // Also drop properties sold on/before that FY's 30 June — older rollovers captured sold
    // properties too, so already-stored data can contain them.
    .filter(p=>p.fyData && p.fyData[year]!=null && !(p.sold && p.soldDate && p.soldDate <= year+'-06-30'))
    .map(p=>{
      const debtKnown = !!(p.fyDebtData && p.fyDebtData[year]!=null);
      const offsetKnown = !!(p.fyOffsetData && p.fyOffsetData[year]!=null);
      return {
        name: p.name,
        value: +p.fyData[year],
        debt: debtKnown ? +p.fyDebtData[year] : null, debtKnown,
        offset: offsetKnown ? +p.fyOffsetData[year] : null, offsetKnown,
      };
    });
  // Property (shown at full/gross value — no loan deducted here) and Loan
  // Remaining are kept as separate totals rather than netted into one
  // "equity" figure, per how the annual snapshot is laid out: Cash (from
  // property offset balances) adds to Net Worth, Property adds at full
  // value, and Loan Remaining is deducted at the end.
  const propTotal = propRows.length ? propRows.reduce((s,r)=>s+r.value,0) : null;
  const loanTotal = propRows.length ? propRows.reduce((s,r)=>s+(r.debtKnown?r.debt:0),0) : 0;
  const loanPartial = propRows.some(r=>!r.debtKnown);
  const cashTotal = propRows.length ? propRows.reduce((s,r)=>s+(r.offsetKnown?r.offset:0),0) : null;
  const cashPartial = propRows.some(r=>!r.offsetKnown);
  const holdingsTotal = h ? h.total : null;
  // Net worth sums whichever of the four are actually available rather
  // than requiring all of them — Property/Cash in particular will
  // legitimately have no data for any year before this feature started
  // tracking it, so requiring completeness would leave Net Worth blank for
  // almost every past year even though Holdings + Super alone is still a
  // real, useful figure. `partial` flags when something's missing (or a
  // loan/offset figure is unknown for that year) so it's never silently
  // presented as if it were the full picture.
  const parts = [holdingsTotal, propTotal, cashTotal, superTotal].filter(v=>v!=null);
  const netWorth = parts.length ? (holdingsTotal||0)+(propTotal||0)+(cashTotal||0)+(superTotal||0)-loanTotal : null;
  const partial = netWorth!=null && (holdingsTotal==null || superTotal==null || cashTotal==null || propTotal==null || loanPartial || cashPartial);
  return { year, date: h ? h.date : `${year}-06-30`, holdings: h, superRows, superTotal, propRows, propTotal, loanTotal, loanPartial, cashTotal, cashPartial, netWorth, partial };
}

function annualSnapshotYears(){
  const hStore = loadHoldingsFYSnapshots();
  const years = new Set(Object.keys(hStore).map(Number));
  (typeof superAccounts!=='undefined' ? superAccounts : []).forEach(a=>{ if(a.fyData) Object.keys(a.fyData).forEach(y=>years.add(+y)); });
  (typeof properties!=='undefined' ? properties : []).forEach(p=>{ if(p.fyData) Object.keys(p.fyData).forEach(y=>years.add(+y)); });
  return [...years].sort((a,b)=>b-a);
}

function renderAnnualSnapshots(){
  const el = $('nw-annual-snapshots');
  if(!el) return;
  refreshHoldingsFYSnapshots();
  const years = annualSnapshotYears();
  if(!years.length){
    el.innerHTML = `<div style="color:var(--text3);font-size:12px">No 30 June snapshots yet — check back after this app has price/trade history spanning a financial-year end.</div>`;
    return;
  }
  // Table body is capped to ~5 visible rows (most recent FYs first) with
  // the rest reachable by scrolling inside the wrapper, rather than the
  // page growing a row per year of history — the header stays pinned via
  // position:sticky so the column labels don't scroll away with it.
  const theadCell = label => `<th style="text-align:right;padding:4px 8px;position:sticky;top:0;background:var(--surface2)">${label}</th>`;
  el.innerHTML = `
    <div style="max-height:192px;overflow-y:auto;overflow-x:auto;border:1px solid var(--border);border-radius:6px">
    <table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px">
      <thead><tr style="color:var(--text3);border-bottom:1px solid var(--border);font-size:10px">
        <th style="text-align:left;padding:4px 8px;position:sticky;top:0;background:var(--surface2)">FY (30 JUN)</th>
        ${theadCell('NET WORTH')}
        ${theadCell('PORTFOLIO')}
        ${theadCell('PROPERTY')}
        ${theadCell('CASH')}
        ${theadCell('SUPER')}
        ${theadCell('LOAN')}
        ${theadCell('CSV')}
      </tr></thead>
      <tbody>
        ${years.map(y=>{
          const s = getAnnualSnapshot(y);
          return `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:5px 8px"><b>FY${y}</b></td>
            <td style="text-align:right;padding:5px 8px;font-weight:700">${s.netWorth!=null ? n2(s.netWorth) + (s.partial?' *':'') : '<span style="color:var(--text3)">—</span>'}</td>
            <td style="text-align:right;padding:5px 8px">${s.holdings ? n2(s.holdings.total) + (s.holdings.complete?'':' *') : '<span style="color:var(--text3)">—</span>'}</td>
            <td style="text-align:right;padding:5px 8px">${s.propTotal!=null ? n2(s.propTotal) : '<span style="color:var(--text3)">—</span>'}</td>
            <td style="text-align:right;padding:5px 8px">${s.cashTotal!=null ? n2(s.cashTotal) + (s.cashPartial?' *':'') : '<span style="color:var(--text3)">—</span>'}</td>
            <td style="text-align:right;padding:5px 8px">${s.superTotal!=null ? n2(s.superTotal) : '<span style="color:var(--text3)">—</span>'}</td>
            <td style="text-align:right;padding:5px 8px">${s.propTotal!=null ? n2(s.loanTotal) + (s.loanPartial?' *':'') : '<span style="color:var(--text3)">—</span>'}</td>
            <td style="text-align:right;padding:5px 8px"><button class="btn btn-g" style="padding:3px 8px;font-size:10px" onclick="exportAnnualSnapshotCSV(${y})">↓ Year</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>
    <div style="font-size:10px;color:var(--text3);margin-top:8px">Showing ${years.length} FY${years.length===1?'':'s'} · scroll for older years (and sideways on narrow screens). Portfolio * = price data incomplete for one or more symbols that 30 June. Cash = property offset-account balances; Property = full value, before loans; Loan = amount deducted to get Net Worth. * on Cash or Loan = that figure is unavailable for one or more properties that FY (treated as $0 in the total below it), so Net Worth may be overstated. Net Worth * = partial total, missing one of Holdings/Super/Cash/Property for that year, or a Cash/Loan * as above (Super may predate this feature if you'd already entered it manually; Property only started being tracked once this feature was added, so early years won't have it).</div>
    <div style="margin-top:12px"><button class="btn btn-g" onclick="exportAllAnnualSnapshotsCSV()">↓ Download all years (combined CSV)</button></div>
  `;
}

// ── CSV EXPORT ─────────────────────────────────────────────────────────
function csvEscape(v){
  if(v==null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function downloadCSVRows(filename, rows){
  const csv = rows.map(r=>r.map(csvEscape).join(',')).join('\r\n');
  // BOM + charset: without them Excel on Windows reads the file as ANSI and
  // mangles non-ASCII text (the U+2212 minus in the NET WORTH note row).
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
}
function exportAnnualSnapshotCSV(year){
  const s = getAnnualSnapshot(year);
  const rows = [];
  rows.push(['ANNUAL SNAPSHOT', 'FY'+year, s.date]);
  rows.push([]);
  rows.push(['NET WORTH', s.netWorth, '', '(Portfolio + Property + Cash + Super − Loan)']);
  rows.push([]);
  rows.push(['HOLDINGS']);
  rows.push(['Symbol','Owner','Asset Type','Units','Price','Market Value','Cost Basis','Source']);
  (s.holdings ? s.holdings.rows : []).forEach(h=>rows.push([
    h.symbol, typeof getPersonLabel==='function' ? getPersonLabel(h.owner) : h.owner, h.assetType, h.units, h.price, h.mktValue, h.costBasis, h.source
  ]));
  rows.push(['', '', '', '', '', 'TOTAL', s.holdings ? s.holdings.total : '']);
  rows.push([]);
  rows.push(['PROPERTY']);
  rows.push(['Property','Value','Loan Balance','Offset (Cash)']);
  s.propRows.forEach(r=>rows.push([r.name, r.value, r.debtKnown ? r.debt : 'unknown', r.offsetKnown ? r.offset : 'unknown']));
  rows.push(['', 'TOTAL', s.propTotal, s.loanTotal, s.cashTotal]);
  rows.push([]);
  rows.push(['SUPER']);
  rows.push(['Account','Balance']);
  s.superRows.forEach(r=>rows.push([r.name, r.balance]));
  rows.push(['TOTAL', s.superTotal]);
  downloadCSVRows(`eofy-snapshot-FY${year}.csv`, rows);
}
function exportAllAnnualSnapshotsCSV(){
  const years = annualSnapshotYears();
  const rows = [['FY','Date','Net Worth','Holdings Total','Holdings Complete','Property Total (Gross)','Cash Total','Super Total','Loan Total','Loan/Cash Known']];
  years.slice().sort((a,b)=>a-b).forEach(y=>{
    const s = getAnnualSnapshot(y);
    rows.push([y, s.date, s.netWorth, s.holdings?s.holdings.total:'', s.holdings?(s.holdings.complete?'yes':'no'):'', s.propTotal, s.cashTotal, s.superTotal, s.loanTotal, (s.loanPartial||s.cashPartial)?'no':'yes']);
  });
  downloadCSVRows('eofy-snapshots-all-years.csv', rows);
}

// One set of colours shared by the top cards and the Composition bar so they
// always match. Property Value / Property equity share pink.
const NW_COLORS = {
  portfolio: 'var(--violet)',
  property:  'var(--pink)',
  cash:      'var(--amber)',
  super:     'var(--green)',
  loan:      'var(--red)',   // card only — not part of the Composition bar
};
// Shades a card in the given colour: tinted background + border, and a matching
// top strip (see the <style> block in the cards markup). color-mix is supported
// by all current browsers; older ones just show the plain card.
function nwTint(c){
  return `--c:${c};border-color:color-mix(in srgb,var(--c) 40%,var(--border));` +
         `background:linear-gradient(160deg,color-mix(in srgb,var(--c) 18%,var(--surface)),var(--surface) 75%)`;
}

// ── AFTER-TAX NET WORTH ─────────────────────────────────────────────────
// Click the Net Worth badge to see Net Worth less the capital gains tax you'd
// owe if everything were sold today. Read-only estimate:
//  • Shares/ETFs/crypto: every open parcel (same FIFO + AMIT-adjusted cost
//    base the CGT tab uses) marked to the live price. Held > 12 months gets
//    the 50% discount.
//  • Investment properties: current value less cost base (purchase price +
//    costs + improvements) and any selling costs entered. PPOR is treated as
//    exempt. Properties with no purchase price/date are left out and flagged.
//  • Losses offset short-term gains first, then long-term, then the discount
//    — the same ordering the CGT tab uses. Capital gains/losses already
//    realised this FY and any carried-forward losses are included, so the tax
//    shown is the EXTRA tax the hypothetical sale would add.
//  • Tax = marginal tax (calcTax(), which already includes the Medicare levy)
//    on top of each person's estimated base income (the CGT simulator's own
//    auto-fill figure).
//  • Super is not reduced (its earnings are taxed inside the fund).
function nwEstimateCGTIfSold(){
  const todayStr = localDateStr();
  const today = new Date(todayStr);
  const curFY = +dateToFY(todayStr);
  const persons = getAllPersons();
  const summary = computeCGTSummary();
  const result = summary.result || {};
  const openParcels = summary.openParcels || {};

  const bucket = () => persons.reduce((o,p)=>{ o[p] = {short:0, long:0, loss:0}; return o; }, {});
  const stock = bucket(), prop = bucket();
  const add = (b, owner, gain, long) => persons.forEach(person => {
    const share = shareForOwner(owner, person);
    if(share <= 0) return;
    const g = gain * share;
    if(g >= 0){ if(long) b[person].long += g; else b[person].short += g; }
    else b[person].loss += -g;
  });

  // Shares / ETFs / crypto
  const unpriced = [];
  Object.entries(openParcels).forEach(([sym, list]) => {
    if(sym.startsWith('_stash_')) return;
    const price = prices[typeof priceSymbol === 'function' ? priceSymbol(sym) : sym];
    const owner = getSymbolOwner(sym);
    list.forEach(p => {
      if(!(p.units > 0.000001)) return;
      if(price == null){ if(!unpriced.includes(sym)) unpriced.push(sym); return; }
      const gain = p.units * price - p.cost;
      const heldDays = Math.floor((today - new Date(p.date)) / 86400000);
      add(stock, owner, gain, heldDays > 365);
    });
  });

  // Investment properties (unsold, not the main residence)
  const propDetail = [], propSkipped = [];
  (typeof properties !== 'undefined' && typeof propMetrics === 'function' ? properties : [])
    .filter(p => !p.sold && p.propType !== 'ppor')
    .forEach(p => {
      if(!(+p.purchasePrice > 0) || !p.purchaseDate){ propSkipped.push(p.name); return; }
      const value = propMetrics(p).cval;
      const costBase = (+p.purchasePrice||0) + (+p.purchaseCosts||0) + (+p.capitalImprovements||0);
      const sellCosts = +p.sellingCosts || 0;
      const gain = value - sellCosts - costBase;
      const long = (today - new Date(p.purchaseDate)) / 86400000 > 365;
      const owner = p.owner || 'lumia';
      add(prop, owner, gain, long);
      propDetail.push({ name: p.name, owner, value, costBase, sellCosts, gain, long });
    });

  const applyLosses = (a, carryIn) => {
    const pool = a.loss + carryIn;
    const offShort = Math.min(a.short, pool);
    let rem = pool - offShort;
    const netShort = a.short - offShort;
    const offLong = Math.min(a.long, rem);
    const netLong = a.long - offLong;
    return { ncg: netShort + netLong * 0.5 };
  };

  const scenario = includeProp => {
    let totalTax = 0;
    const rows = [];
    persons.forEach(person => {
      const hyp = {
        short: stock[person].short + (includeProp ? prop[person].short : 0),
        long:  stock[person].long  + (includeProp ? prop[person].long  : 0),
        loss:  stock[person].loss  + (includeProp ? prop[person].loss  : 0),
      };
      if(!(hyp.short > 0 || hyp.long > 0 || hyp.loss > 0)) return;

      const res = result[person] || {};
      const cur = res[curFY] || null;
      const realised = cur ? { short: cur.shortGain, long: cur.longGain, loss: cur.losses } : { short:0, long:0, loss:0 };
      let carry = 0;
      if(cur) carry = cur.lossCarryIn || 0;
      else {
        const prior = Object.keys(res).map(Number).filter(f => f < curFY).sort((a,b)=>b-a)[0];
        if(prior != null) carry = res[prior].lossCarryOut || 0;
        else {
          const o = typeof getCGTLossCarryIn === 'function' ? (getCGTLossCarryIn()[person] || null) : null;
          if(o && +o.amount > 0 && +o.fy <= curFY) carry = +o.amount;
        }
      }

      const before = applyLosses(realised, carry);
      const after  = applyLosses({ short: realised.short + hyp.short, long: realised.long + hyp.long, loss: realised.loss + hyp.loss }, carry);
      const base = +(typeof cgtEstimateBaseIncome === 'function' ? cgtEstimateBaseIncome(person) : 0) || 0;
      // calcTax() already includes the Medicare levy (it's baked into its
      // return value), so the incremental tax is just the difference — adding
      // calcMedicareLevy() on top would count the levy twice.
      const tax = +(calcTax(base + after.ncg, curFY) - calcTax(base + before.ncg, curFY)).toFixed(2);
      rows.push({ person, short: hyp.short, long: hyp.long, loss: hyp.loss, added: after.ncg - before.ncg, base, tax });
      totalTax += tax;
    });
    return { rows, totalTax: +totalTax.toFixed(2) };
  };

  return { all: scenario(true), stockOnly: scenario(false), propDetail, propSkipped, unpriced };
}

function nwShowAfterTax(){
  if(typeof computeCGTSummary !== 'function' || typeof calcTax !== 'function'){
    if(typeof notify === 'function') notify('CGT/tax modules not loaded yet', 'err');
    return;
  }
  let est;
  try{ est = nwEstimateCGTIfSold(); }
  catch(e){ console.error('After-tax estimate failed', e); if(typeof notify === 'function') notify('Could not estimate CGT: ' + e.message, 'err'); return; }

  const netWorth = nwPortfolioValue() + nwPropertyValue() + nwOffsetCash() + nwSuperBalance() - nwLoanBalance();
  const stockTax = est.stockOnly.totalTax;
  const allTax   = est.all.totalTax;
  const propTax  = +(allTax - stockTax).toFixed(2);
  const hasProp  = est.propDetail.length > 0;
  const esc = v => typeof escHtml === 'function' ? escHtml(v) : String(v);
  const label = k => esc(typeof getPersonLabel === 'function' ? getPersonLabel(k) : k);
  const gl = v => `<span style="color:${v>=0?'var(--green)':'var(--red)'}">${v>=0?'':'−'}${n2(Math.abs(v))}</span>`;
  const cell = 'text-align:right;padding:5px 8px';
  const th = 'text-align:right;padding:4px 8px;color:var(--text3);font-size:10px';

  const line = (lbl, val, opts) => `<tr style="${opts&&opts.top?'border-top:1px solid var(--border);':''}">
    <td style="padding:6px 0;${opts&&opts.bold?'font-weight:700;font-size:14px;':''}">${lbl}</td>
    <td style="text-align:right;padding:6px 0;${opts&&opts.bold?'font-weight:700;font-size:14px;':''}${opts&&opts.color?'color:'+opts.color+';':''}">${val}</td></tr>`;

  const personRows = est.all.rows.length ? `
    <div style="font-size:11px;font-weight:700;color:var(--text2);margin:16px 0 6px">Estimated tax by person (selling everything)</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr><th style="${th};text-align:left">Person</th><th style="${th}">Short-term</th><th style="${th}">Long-term</th><th style="${th}">Losses</th><th style="${th}">Added taxable gain</th><th style="${th}">Est. tax</th></tr></thead>
      <tbody>${est.all.rows.map(r => `<tr style="border-top:1px solid var(--border)">
        <td style="padding:5px 8px">${label(r.person)}</td>
        <td style="${cell}">${n2(r.short)}</td><td style="${cell}">${n2(r.long)}</td><td style="${cell}">${r.loss ? '−'+n2(r.loss) : '—'}</td>
        <td style="${cell}">${n2(r.added)}</td><td style="${cell};font-weight:700;color:var(--red)">${n2(r.tax)}</td></tr>`).join('')}
      </tbody></table></div>`
    : `<div style="color:var(--text3);margin-top:14px">No unrealised gains found — nothing to deduct.</div>`;

  const propTable = hasProp ? `
    <div style="font-size:11px;font-weight:700;color:var(--text2);margin:16px 0 6px">Investment properties included</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr><th style="${th};text-align:left">Property</th><th style="${th}">Value</th><th style="${th}">Cost base</th><th style="${th}">Selling costs</th><th style="${th}">Gain</th><th style="${th}">&gt; 12 months</th></tr></thead>
      <tbody>${est.propDetail.map(p => `<tr style="border-top:1px solid var(--border)">
        <td style="padding:5px 8px">${esc(p.name)} <span style="color:var(--text3)">· ${label(p.owner)}</span></td>
        <td style="${cell}">${n2(p.value)}</td><td style="${cell}">${n2(p.costBase)}</td><td style="${cell}">${p.sellCosts ? n2(p.sellCosts) : '—'}</td>
        <td style="${cell}">${gl(p.gain)}</td><td style="${cell}">${p.long ? 'Yes (50% discount)' : 'No'}</td></tr>`).join('')}
      </tbody></table></div>` : '';

  const flags = [];
  if(est.unpriced.length) flags.push(`No price for ${est.unpriced.map(esc).join(', ')} — excluded from the estimate.`);
  if(est.propSkipped.length) flags.push(`${est.propSkipped.map(esc).join(', ')} excluded — no purchase price/date recorded (needed for a cost base).`);

  const html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:15px;font-weight:700;color:var(--text)">After-tax net worth</div>
      <button class="btn btn-g" style="padding:3px 10px;font-size:11px" onclick="closeHudPopup('nw-after-tax')">✕</button>
    </div>
    <table style="width:100%;border-collapse:collapse">
      ${line('Net worth today', n2(netWorth))}
      ${line('Less: est. CGT on portfolio', '−' + n2(stockTax), {color:'var(--red)'})}
      ${hasProp ? line('Less: est. CGT on investment property', '−' + n2(propTax), {color:'var(--red)'}) : ''}
      ${line('After-tax net worth', n2(netWorth - allTax), {bold:true, top:true})}
    </table>
    ${hasProp ? `<div style="margin-top:8px;color:var(--text2)">If you kept your property and only sold the portfolio: <b>${n2(netWorth - stockTax)}</b></div>` : ''}
    ${personRows}
    ${propTable}
    ${flags.length ? `<div style="margin-top:12px;color:var(--amber);font-size:11px">${flags.map(f => '⚠ ' + f).join('<br>')}</div>` : ''}
    <div style="margin-top:14px;color:var(--text3);font-size:10px;line-height:1.5">
      Estimate of the capital gains tax if every holding were sold today. Uses the 50% discount for assets held over 12 months, offsets losses against short-term gains first, and includes gains/losses already realised this financial year plus any carried-forward losses — so the tax shown is the extra tax the sale would add. Taxed at marginal rates (income tax + Medicare levy) on top of each person's estimated income, the same base-income estimate the CGT simulator auto-fills. Main residence treated as exempt; super isn't reduced. Doesn't include the proposed CGT reform cut-off, brokerage/selling costs (unless entered on the property), or other tax circumstances. Estimate only — not tax advice.
    </div>`;
  openHudPopup('nw-after-tax', html, { minWidth: '560px', maxWidth: '860px', fontSize: '12px' });
}

function renderNetWorth(){
  const panel = document.getElementById('panel-networth');
  if(!panel) return;

  const portfolioVal = nwPortfolioValue();
  const propertyEq = nwPropertyEquity();
  const superBal = nwSuperBalance();
  const offsetCash = nwOffsetCash();
  const propertyVal = nwPropertyValue();
  const loanBal = nwLoanBalance();
  // Net Worth = Portfolio + Property Value + Offset Cash + Super − Loan
  const netWorth = portfolioVal + propertyVal + offsetCash + superBal - loanBal;
  const {growthPct, monthlyContrib, annualSpend, currentAge, fiAge, reAge} = nwFireInputs();
  const fireNumber = annualSpend * 25; // 4% rule

  // Composition bar — simple flex segments, no chart library needed.
  const segs = [
    {label:'Portfolio', val:portfolioVal, color:NW_COLORS.portfolio},
    {label:'Property equity', val:propertyEq, color:NW_COLORS.property},
    {label:'Offset cash', val:offsetCash, color:NW_COLORS.cash},
    {label:'Super', val:superBal, color:NW_COLORS.super},
  ].filter(s => s.val > 0);
  // Percentages use the sum of the segments actually drawn. Dividing by
  // netWorth instead meant a negative component (e.g. underwater property
  // equity) shrank the denominator, so the drawn segments summed past 100%.
  const barTotal = segs.reduce((t,x)=>t+x.val,0);
  const barHtml = barTotal > 0 ? `
    <div style="display:flex;height:14px;border-radius:7px;overflow:hidden;margin:10px 0 8px">
      ${segs.map(s=>`<div style="width:${(s.val/barTotal*100).toFixed(2)}%;background:${s.color}"></div>`).join('')}
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--text2)">
      ${segs.map(s=>`<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.color};margin-right:5px"></span>${s.label} · ${n2(s.val)} (${(s.val/barTotal*100).toFixed(1)}%)</span>`).join('')}
    </div>` : `<div style="color:var(--text3);font-size:12px">No portfolio, property, or super data yet.</div>`;

  // ── FIRE projection ──────────────────────────────────────────────
  // Starting balance is Portfolio only. Property equity is excluded (see
  // nwPropertyCashFlow above) and Super is excluded too: Super can only
  // be drawn once you're BOTH 60+ AND actually retired, and every year
  // this accumulation loop counts is by definition a year you're still
  // working toward the goal (if you'd retired, the loop would already
  // have stopped) — so Super stays locked for the entire projection,
  // regardless of age. It only re-enters the picture in the "working
  // past FI" buffer scenario below, once you've actually stopped.
  const liquidStart = portfolioVal;
  const propertyCF = nwPropertyCashFlow();
  const effectiveAnnualContrib = monthlyContrib*12 + propertyCF;
  const SUPER_ACCESS_AGE = 60;

  const years = [], balances = [];
  let bal = liquidStart, y = 0;
  const rate = growthPct/100;
  const maxYears = 60;
  while(bal < fireNumber && y < maxYears){
    bal = bal*(1+rate) + effectiveAnnualContrib;
    y++;
    years.push(y); balances.push(bal);
  }
  const reached = bal >= fireNumber;
  const fireLabel = reached ? `~${y} year${y===1?'':'s'}` : `Not within ${maxYears} years at current settings`;

  // ── Target-based planning — solve backward from desired ages ──────
  // "FI age" = when the liquid balance first covers the FIRE number.
  // "RE age" = when you actually plan to stop working, which can be the
  // same as FI age or later (working on past FI just banks a buffer).
  const hasFI = currentAge != null && fiAge != null;
  const yearsToFI = hasFI ? fiAge - currentAge : null;
  const validFI = hasFI && yearsToFI > 0;
  const requiredAnnualTotal = validFI ? nwRequiredAnnualContribution(liquidStart, fireNumber, growthPct, yearsToFI) : null;
  const requiredMonthlyFromYou = requiredAnnualTotal != null ? (requiredAnnualTotal - propertyCF) / 12 : null;
  const monthlyGap = requiredMonthlyFromYou != null ? monthlyContrib - requiredMonthlyFromYou : null;

  const hasRE = reAge != null;
  const reBeforeFI = hasRE && hasFI && reAge < fiAge;
  const reAfterFI  = hasRE && hasFI && reAge > fiAge;

  let reBridge = null; // required contribution to hit FIRE by the earlier RE age instead
  if(reBeforeFI && currentAge != null){
    const yearsToRE = reAge - currentAge;
    if(yearsToRE > 0){
      const reqAnnual = nwRequiredAnnualContribution(liquidStart, fireNumber, growthPct, yearsToRE);
      reBridge = { yearsToRE, requiredMonthly: (reqAnnual - propertyCF) / 12 };
    }
  }
  let reBuffer = null; // projected extra balance/spend if working on past FI to RE age
  if(reAfterFI){
    const extraYears = reAge - fiAge;
    let bb = fireNumber;
    for(let i=0;i<extraYears;i++) bb = bb*(1+growthPct/100) + effectiveAnnualContrib;

    // Super only enters the picture once you actually retire — and even
    // then, only if you're retiring at 60 or later. Retiring earlier
    // than 60 doesn't forfeit it, it just stays locked a bit longer.
    const superGrown = (yrs) => { let b = superBal; for(let i=0;i<yrs;i++) b *= (1+growthPct/100); return b; };
    const superAccessibleAtRE = reAge >= SUPER_ACCESS_AGE;
    const superAtRE = currentAge != null ? superGrown(Math.max(0, reAge - currentAge)) : superBal;
    const superAtAccessAge = currentAge != null
      ? superGrown(Math.max(0, Math.max(reAge, SUPER_ACCESS_AGE) - currentAge))
      : superBal;

    const usableAtRE = bb + (superAccessibleAtRE ? superAtRE : 0);
    reBuffer = {
      extraYears, balance: usableAtRE, sustainableSpend: usableAtRE*0.04,
      superAccessibleAtRE, superAtAccessAge,
      yearsUntilSuperUnlocks: superAccessibleAtRE ? 0 : SUPER_ACCESS_AGE - reAge,
    };
  }

  panel.innerHTML = `
    <style>#nw-cards .card[style*="--c"]::before{background:var(--c);}</style>
    <div class="cards" id="nw-cards" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
      <div class="card" role="button" tabindex="0" title="Click for after-tax net worth" style="cursor:pointer" onclick="nwShowAfterTax()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();nwShowAfterTax();}"><div class="card-label">Net Worth</div><div class="card-value neu">${n2(netWorth)}</div><div class="card-sub">Portfolio + Property + Cash + Super − Loan</div><div class="card-sub" style="color:var(--blue)">Click for after-tax view ›</div></div>
      <div class="card" style="${nwTint(NW_COLORS.portfolio)}"><div class="card-label">Portfolio</div><div class="card-value neu">${n2(portfolioVal)}</div><div class="card-sub">Market value</div></div>
      <div class="card" style="${nwTint(NW_COLORS.property)}"><div class="card-label">Property Value</div><div class="card-value neu">${n2(propertyVal)}</div><div class="card-sub">Current value, gross</div></div>
      <div class="card" style="${nwTint(NW_COLORS.cash)}"><div class="card-label">Offset Cash</div><div class="card-value neu">${n2(offsetCash)}</div><div class="card-sub">Offset account balances</div></div>
      <div class="card" style="${nwTint(NW_COLORS.super)}"><div class="card-label">Super</div><div class="card-value neu">${n2(superBal)}</div><div class="card-sub">All accounts</div></div>
      <div class="card" style="${nwTint(NW_COLORS.loan)}"><div class="card-label">Loan</div><div class="card-value neu">${n2(loanBal)}</div><div class="card-sub">Total loan balance</div></div>
    </div>

    <div class="tw" style="margin-bottom:18px">
      <div class="th"><span class="tt">Composition</span></div>
      <div style="padding:16px 20px">${barHtml}</div>
    </div>

    <div class="tw">
      <div class="th"><span class="tt">🔥 FIRE Projection</span><span style="font-size:10px;color:var(--text3)">4% rule · estimates only</span></div>
      <div style="padding:16px 20px">
        <div style="font-size:11px;color:var(--text3);margin-bottom:14px">Uses Portfolio only, not the full Net Worth above — Super is locked until you're 60+ <em>and</em> retired, and property equity can't be spent without selling. Both are handled separately below.</div>
        <div class="fg" style="margin-bottom:14px">
          <div class="fgi"><span class="fl">Annual spend (FIRE basis)</span><input class="fi" id="nw-fire-spend" type="number" step="1000" value="${annualSpend}" onchange="nwSaveFireInputs()"></div>
          <div class="fgi"><span class="fl">Assumed annual growth %</span><input class="fi" id="nw-fire-growth" type="number" step="0.5" value="${growthPct}" onchange="nwSaveFireInputs()"></div>
          <div class="fgi"><span class="fl">Monthly contribution</span><input class="fi" id="nw-fire-contrib" type="number" step="100" value="${monthlyContrib}" onchange="nwSaveFireInputs()"></div>
          <div class="fgi"><span class="fl">Current age</span><input class="fi" id="nw-fire-age" type="number" step="1" placeholder="e.g. 32" value="${currentAge ?? ''}" onchange="nwSaveFireInputs()"></div>
          <div class="fgi"><span class="fl">Target FI age</span><input class="fi" id="nw-fire-fi-age" type="number" step="1" placeholder="e.g. 45" value="${fiAge ?? ''}" onchange="nwSaveFireInputs()"></div>
          <div class="fgi"><span class="fl">Target retire-early age</span><input class="fi" id="nw-fire-re-age" type="number" step="1" placeholder="e.g. 50" value="${reAge ?? ''}" onchange="nwSaveFireInputs()"></div>
        </div>
        <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:14px">
          <div class="card"><div class="card-label">FIRE Number</div><div class="card-value neu">${n2(fireNumber)}</div><div class="card-sub">25× annual spend</div></div>
          <div class="card"><div class="card-label">Time to FIRE</div><div class="card-value ${reached?'pos':'neu'}">${fireLabel}</div><div class="card-sub">Liquid balance + contributions</div></div>
          <div class="card"><div class="card-label">Liquid Starting Balance</div><div class="card-value neu">${n2(liquidStart)}</div><div class="card-sub">Portfolio only — Super locked until retired at 60+</div></div>
          <div class="card"><div class="card-label">Net Rental Income</div><div class="card-value ${propertyCF>=0?'pos':'neg'}">${propertyCF>=0?'+':''}${n2(propertyCF)}/yr</div><div class="card-sub">Sum of each rental's Net Annual Income</div></div>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:14px">Property equity (${n2(propertyEq)}) and offset cash (${n2(offsetCash)}) aren't counted in the liquid balance above — it can't be drawn down like an investment. Instead, its Net Rental Income (same figure shown per-property in the Property tab — rent minus expenses minus interest, excluding your own home) ${propertyCF>=0?'is currently boosting':'is currently reducing'} your yearly contribution by ${n2(Math.abs(propertyCF))}.</div>
        <div style="height:220px"><canvas id="nw-fire-chart"></canvas></div>
        <div style="font-size:11px;color:var(--text3);margin-top:8px">Rough compound-growth estimate only — ignores tax, fees, sequence-of-returns risk, and inflation on the spend figure. Not financial advice.</div>
      </div>
    </div>

    <div class="tw" style="margin-top:18px">
      <div class="th"><span class="tt">🎯 Target-Based Planning</span><span style="font-size:10px;color:var(--text3)">Solves for the savings rate your target ages require</span></div>
      <div style="padding:16px 20px">
        ${!hasFI ? `<div style="color:var(--text3);font-size:12px">Enter your current age and a target FI age above to see the savings rate required to get there.</div>` :
          !validFI ? `<div style="color:var(--red);font-size:12px">Target FI age must be after your current age.</div>` : `
          <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:14px">
            <div class="card"><div class="card-label">Years to FI</div><div class="card-value neu">${yearsToFI}</div><div class="card-sub">Age ${currentAge} → ${fiAge}</div></div>
            <div class="card"><div class="card-label">Required Monthly Savings</div><div class="card-value neu">${n2(Math.max(0,requiredMonthlyFromYou))}</div><div class="card-sub">On top of net rental income</div></div>
            <div class="card"><div class="card-label">Your Current Rate</div><div class="card-value ${monthlyGap>=0?'pos':'neg'}">${n2(monthlyContrib)}</div><div class="card-sub">${monthlyGap>=0?'+':''}${n2(monthlyGap)}/mo vs required</div></div>
          </div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:${reBridge||reBuffer?'14px':'0'}">
            ${requiredMonthlyFromYou<=0
              ? `Your Net Rental Income alone is projected to cover this — no additional personal savings required to hit FI by age ${fiAge}.`
              : monthlyGap>=0
                ? `You're on track — saving ${n2(monthlyGap)}/month more than required, which should get you to FI a bit ahead of age ${fiAge}.`
                : `You're short by ${n2(Math.abs(monthlyGap))}/month to hit FI by age ${fiAge} at a ${growthPct}% growth assumption.`}
          </div>
          ${reBridge ? `
          <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
            <div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:4px">⚠ Retire-early age (${reAge}) is before your FI age (${fiAge})</div>
            <div style="font-size:11px;color:var(--text3)">You can't retire before reaching financial independence. To actually retire by age ${reAge} instead, you'd need ${n2(Math.max(0,reBridge.requiredMonthly))}/month over the next ${reBridge.yearsToRE} years — higher than the figure above.</div>
          </div>` : ''}
          ${reBuffer ? `
          <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
            <div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:4px">Working ${reBuffer.extraYears} more year${reBuffer.extraYears===1?'':'s'} past FI (to age ${reAge})</div>
            <div style="font-size:11px;color:var(--text3)">At your current contribution rate, your Portfolio would grow to a sustainable ${n2(reBuffer.sustainableSpend)}/year (4% rule) by then${reBuffer.superAccessibleAtRE ? `, including Super — unlocked the moment you actually retire at ${reAge} (not earlier, even though 60 comes first while you're still working)` : ''}, vs the ${n2(annualSpend)}/year you targeted.</div>
            ${!reBuffer.superAccessibleAtRE ? `<div style="font-size:11px;color:var(--gold);margin-top:6px">Super stays locked for ${reBuffer.yearsUntilSuperUnlocks} more year${reBuffer.yearsUntilSuperUnlocks===1?'':'s'} after you retire (until age 60) — projected to be worth ~${n2(reBuffer.superAtAccessAge)} when it unlocks, on top of the above.</div>` : ''}
          </div>` : ''}
        `}
      </div>
    </div>

    <div class="tw" style="margin-top:18px">
      <div class="th"><span class="tt">📅 Annual Snapshots (30 June)</span><span style="font-size:10px;color:var(--text3)">Holdings, Super &amp; Property — stored per FY, exportable as CSV</span></div>
      <div style="padding:16px 20px" id="nw-annual-snapshots"></div>
    </div>
  `;

  renderAnnualSnapshots();

  if(_nwFireChart){ _nwFireChart.destroy(); _nwFireChart = null; }
  const ctx = document.getElementById('nw-fire-chart');
  if(ctx && typeof Chart !== 'undefined' && years.length){
    _nwFireChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['Now', ...years.map(y=>'Yr '+y)],
        datasets: [
          { label:'Projected liquid balance', data:[liquidStart, ...balances], borderColor:'#8b5cf6', backgroundColor:'rgba(139,92,246,0.12)', fill:true, tension:0.25, pointRadius:0 },
          { label:'FIRE number', data:Array(years.length+1).fill(fireNumber), borderColor:'#fbbf24', borderDash:[6,4], pointRadius:0 },
        ],
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:'#a5a8ae', font:{size:11} } } },
        scales:{
          x:{ ticks:{ color:'#65686f', maxTicksLimit:10 }, grid:{ color:'rgba(255,255,255,0.04)' } },
          y:{ ticks:{ color:'#65686f', callback:v=>'$'+(v/1000).toFixed(0)+'k' }, grid:{ color:'rgba(255,255,255,0.04)' } },
        },
      },
    });
  }
}