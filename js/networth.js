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
// Totals for "if every unsold property were sold today". Uses the same
// property set and inputs as the Net Worth badge (value, loan, offset) so the
// figures tie out, plus each property's estimated selling costs.
function nwPropertySaleCash(){
  const list = (typeof properties !== 'undefined' && typeof propMetrics === 'function') ? properties.filter(p => !p.sold) : [];
  const sellCosts = list.reduce((t, p) => t + cgtPropertySellingCosts(p, propMetrics(p).cval), 0);
  return { count: list.length, value: nwPropertyValue(), sellCosts: +sellCosts.toFixed(2), loan: nwLoanBalance(), offset: nwOffsetCash() };
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
  const theadCell = label => `<th style="text-align:right;padding:4px 8px;position:sticky;top:0;background:var(--surface);z-index:10">${label}</th>`;
  el.innerHTML = `
    <div style="max-height:192px;overflow-y:auto;overflow-x:auto;border:1px solid var(--border);border-radius:6px">
    <table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px">
      <thead><tr style="color:var(--text3);border-bottom:1px solid var(--border);font-size:10px">
        <th style="text-align:left;padding:4px 8px;position:sticky;top:0;background:var(--surface);z-index:10">FY (30 JUN)</th>
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

// One set of colours shared by the top cards and the Composition bar where they
// overlap. Each asset class has its own category colour (portfolio blue,
// property brown, cash mint, super purple); debt stays red. Net Worth itself is
// the summary card and is intentionally not part of the Composition bar.
const NW_COLORS = {
  networth:  'var(--asset-teal)',    // summary card only — not part of the Composition bar
  portfolio: 'var(--cat-portfolio)',
  property:  'var(--cat-property)',
  cash:      'var(--asset-mint)',
  super:     'var(--cat-super)',
  loan:      'var(--debt-red)',      // card only — not part of the Composition bar
};
// Kept as a thin alias so the Net Worth markup reads clearly; the shared
// tint helper and the CSS wash are reused by the other dashboards.
function nwTint(c){
  return cardTint(c);
}

// ── AFTER-TAX NET WORTH ─────────────────────────────────────────────────
// Click the Net Worth badge to see Net Worth less the capital gains tax you'd
// owe if everything were sold today. Read-only estimate:
//  • Shares/ETFs/crypto: every open parcel (same FIFO + AMIT-adjusted cost
//    base the CGT tab uses) marked to the live price. Held > 12 months gets
//    the 50% discount.
//  • Investment properties: current value less cost base (purchase price +
//    costs + improvements) less selling costs (the property's Est. Selling
//    Costs % if set). PPOR is treated as
//    exempt. Properties with no purchase price/date are left out and flagged.
//  • Losses offset short-term gains first, then long-term, then the discount
//    — the same ordering the CGT tab uses. Capital gains/losses already
//    realised this FY and any carried-forward losses are included, so the tax
//    shown is the EXTRA tax the hypothetical sale would add.
//  • Tax = marginal tax (calcTax(), which already includes the Medicare levy)
//    on top of each person's estimated base income (the CGT simulator's own
//    auto-fill figure).
//  • Super is not reduced (its earnings are taxed inside the fund).
// Which side of the Stocks/Crypto split a symbol is on. Mirrors calcH(): a holding's
// assetType is its latest trade's, and "Stocks" means everything that isn't crypto
// (ETFs, LICs, REITs, bonds and managed funds included), as in the portfolio views.
function nwAssetKinds(){
  const kind = {};
  (typeof trades !== 'undefined' ? [...trades] : [])
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach(t => { kind[t.symbol] = t.assetType === 'crypto' ? 'crypto' : 'stocks'; });
  return sym => kind[sym] || 'stocks';
}
function nwEstimateCGTIfSold(){
  const todayStr = localDateStr();
  const today = new Date(todayStr);
  const curFY = +dateToFY(todayStr);
  const persons = getAllPersons();
  const ctx = cgtSaleContext();
  const openParcels = ctx.openParcels;

  const bucket = () => persons.reduce((o,p)=>{ o[p] = {short:0, long:0, loss:0}; return o; }, {});
  const stock = bucket(), prop = bucket();
  const propBuckets = []; // per-property gain buckets, so the popup can re-tax any subset
  const kindOf = nwAssetKinds();
  const segBuckets = { stocks: bucket(), crypto: bucket() }; // shares/ETFs vs crypto, for separate sell controls
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
      const isLong = cgtIsLongTerm(p.date, today); // same calendar-date rule as the CGT tab
      add(stock, owner, gain, isLong);
      add(segBuckets[kindOf(sym)], owner, gain, isLong);
    });
  });

  // Investment properties (unsold, not the main residence)
  const propDetail = [], propSkipped = [];
  (typeof properties !== 'undefined' && typeof propMetrics === 'function' ? properties : [])
    .filter(p => !p.sold && p.propType !== 'ppor' && !p.mainResExempt) // mainResExempt matches the property card (no CGT)
    .forEach(p => {
      if(!(+p.purchasePrice > 0) || !p.purchaseDate){ propSkipped.push(p.name); return; }
      const value = propMetrics(p).cval;
      const costBase = (+p.purchasePrice||0) + (+p.purchaseCosts||0) + (+p.capitalImprovements||0);
      const sellCosts = cgtPropertySellingCosts(p, value); // Est. Selling Costs % on the property, if set
      const gain = value - sellCosts - costBase;
      const long = cgtIsLongTerm(p.purchaseDate, today);
      const owner = p.owner || 'lumia';
      add(prop, owner, gain, long);
      const pb = bucket(); add(pb, owner, gain, long);
      propBuckets.push({ ref: p, bucket: pb, costBase, gain, long });
      propDetail.push({ name: p.name, owner, value, costBase, sellCosts, gain, long });
    });

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
      const h = cgtHypotheticalTax(person, hyp, ctx); // shared with the Property dashboard
      rows.push({ person, short: hyp.short, long: hyp.long, loss: hyp.loss, added: h.added, base: h.base, tax: h.tax });
      totalTax += h.tax;
    });
    return { rows, totalTax: +totalTax.toFixed(2) };
  };

  return {
    all: scenario(true), stockOnly: scenario(false), propDetail, propSkipped, unpriced,
    // Raw pieces for the interactive popup (see nwAfterTaxScenario)
    persons, stock, segBuckets, propBuckets,
    taxFn: (person, hyp) => cgtHypotheticalTax(person, hyp, ctx),
  };
}

// ── INTERACTIVE "WHAT IF I SELL…" SCENARIO ──────────────────────────────
// nwAfterTaxScenario() is pure — no DOM, no globals beyond what's in `model`
// — so it can be tested on its own. Given the selection (what fraction of each
// part of the portfolio to sell, and which properties) it returns every figure
// the popup shows.
//
// Tax is NOT additive across assets: it's marginal-rate tax on each person's
// COMBINED gains, after loss netting and the 50% discount. So every selection
// is re-run through model.taxFn on the summed gains rather than adding up
// per-asset tax. The extra tax is then ATTRIBUTED in a fixed order — shares &
// ETFs first, then crypto, then properties — each line being the EXTRA tax that
// part adds on top of the ones before it (the same way property CGT has always
// been shown). The total doesn't depend on that order; only the split does.
//
// Partial portfolio sales are pro-rata: selling 40% of shares realises 40% of
// every parcel's gain/loss (the real parcel choice would depend on which lots
// you pick, so this is an approximation).
//
// model = { persons, taxFn(person,hyp), portfolioVal, superBal, netWorth,
//           segments:[{ key, label, short, value, bucket:{person:{short,long,loss}} }],
//           props:[{ name, owner, ppor, taxable, value, loan, offset, sellCosts,
//                    costBase, gain, long, bucket:{person:{short,long,loss}}|null }] }
// sel   = { f: { [segmentKey]: 0..1 sold }, sold: [bool per model.props] }
function nwAfterTaxScenario(model, sel){
  const segments = model.segments || [];
  const fOf = key => Math.min(1, Math.max(0, +(sel.f && sel.f[key]) || 0));
  const soldProps = model.props.filter((_, i) => sel.sold[i]);
  const heldProps = model.props.filter((_, i) => !sel.sold[i]);

  const taxFor = (segList, props) => {
    let total = 0;
    const rows = [];
    model.persons.forEach(person => {
      const hyp = { short: 0, long: 0, loss: 0 };
      segList.forEach(sg => {
        const b = sg.bucket[person], fr = fOf(sg.key);
        hyp.short += b.short * fr; hyp.long += b.long * fr; hyp.loss += b.loss * fr;
      });
      props.forEach(p => {
        if(!p.bucket) return; // main residence / no purchase data: no CGT estimated
        const b = p.bucket[person];
        hyp.short += b.short; hyp.long += b.long; hyp.loss += b.loss;
      });
      if(!(hyp.short > 0 || hyp.long > 0 || hyp.loss > 0)) return;
      const h = model.taxFn(person, hyp);
      rows.push({ person, short: hyp.short, long: hyp.long, loss: hyp.loss, added: h.added, base: h.base, tax: h.tax });
      total += h.tax;
    });
    return { rows, total: +total.toFixed(2) };
  };

  // Attribute portfolio tax segment by segment (each = extra tax on top of the previous ones).
  const segTax = {};
  let running = 0;
  segments.forEach((sg, k) => {
    const t = taxFor(segments.slice(0, k + 1), []).total;
    segTax[sg.key] = +(t - running).toFixed(2);
    running = t;
  });
  const stockTax = running;                       // all sold portfolio parts together
  const all = taxFor(segments, soldProps);
  const allTax = all.total;
  const propTax = +(allTax - stockTax).toFixed(2); // extra tax the sold properties add

  const agg = list => ({
    count: list.length,
    value: list.reduce((t, p) => t + p.value, 0),
    loan: list.reduce((t, p) => t + p.loan, 0),
    offset: list.reduce((t, p) => t + p.offset, 0),
    sellCosts: +list.reduce((t, p) => t + p.sellCosts, 0).toFixed(2),
  });
  const sold = agg(soldProps), held = agg(heldProps);
  held.equity = held.value - held.loan;

  const segs = segments.map(sg => {
    const f = fOf(sg.key), soldV = sg.value * f;
    return { key: sg.key, label: sg.label, short: sg.short, f, value: sg.value,
             sold: soldV, held: sg.value - soldV, tax: segTax[sg.key], cash: soldV - segTax[sg.key] };
  });
  const portfolioHeld = segs.reduce((t, g) => t + g.held, 0);
  const portfolioCash = segs.reduce((t, g) => t + g.cash, 0);
  const propNetCash = sold.value - sold.sellCosts - sold.loan - propTax;
  const propTotalCash = propNetCash + sold.offset;
  const afterTaxNW = model.netWorth - allTax - sold.sellCosts;

  return {
    segs, soldProps, heldProps, sold, held,
    rows: all.rows, stockTax, propTax, allTax,
    portfolioHeld, portfolioCash,
    propNetCash, propTotalCash,
    afterTaxNW, delta: afterTaxNW - model.netWorth,
    // What you'd end up holding, added up from the pieces — must equal afterTaxNW.
    holdTotal: portfolioHeld + held.equity + held.offset + portfolioCash + propTotalCash + model.superBal,
  };
}

// Builds the scenario model from the live data + the estimator's raw pieces.
// The portfolio is split the way the Portfolio tab's Stocks/Crypto views split it
// (crypto vs everything else); a part with no holdings isn't offered at all.
function nwAtBuildModel(est){
  const portfolioVal = nwPortfolioValue(), superBal = nwSuperBalance();
  const segVal = { stocks: 0, crypto: 0 };
  if(typeof calcH === 'function' && typeof prices !== 'undefined'){
    calcH().forEach(h => {
      const p = prices[typeof priceSymbol === 'function' ? priceSymbol(h.symbol) : h.symbol];
      if(p != null) segVal[h.assetType === 'crypto' ? 'crypto' : 'stocks'] += p * h.units;
    });
  }
  const hasGains = b => Object.values(b).some(x => x.short > 0 || x.long > 0 || x.loss > 0);
  const segments = [
    { key: 'stocks', label: 'Shares & ETFs', short: 'shares & ETFs', hint: 'Shares, ETFs, LICs, REITs, bonds & managed funds · partial sales are pro-rata across parcels' },
    { key: 'crypto', label: 'Crypto', short: 'crypto', hint: 'Partial sales are pro-rata across parcels' },
  ].map(d => ({ ...d, value: segVal[d.key], bucket: est.segBuckets[d.key] }))
   .filter(sg => sg.value > 0.005 || hasGains(sg.bucket));

  const list = (typeof properties !== 'undefined' && typeof propMetrics === 'function') ? properties.filter(p => !p.sold) : [];
  const props = list.map(p => {
    const m = propMetrics(p);
    const det = est.propBuckets.find(x => x.ref === p) || null;
    return {
      name: p.name, owner: p.owner || 'lumia', ppor: p.propType === 'ppor',
      taxable: !!det, value: m.cval, loan: m.loanCur,
      offset: (m.splits || []).reduce((t, sp) => t + (+sp.offset || 0), 0),
      sellCosts: cgtPropertySellingCosts(p, m.cval),
      costBase: det ? det.costBase : null, gain: det ? det.gain : null, long: det ? det.long : null,
      bucket: det ? det.bucket : null,
    };
  });
  return {
    persons: est.persons, taxFn: est.taxFn, portfolioVal, superBal, segments, props,
    netWorth: portfolioVal + nwPropertyValue() + nwOffsetCash() + superBal - nwLoanBalance(),
  };
}

// Live state of the open popup (one at a time — openHudPopup toggles).
let nwAtActive = null;
function nwAtSetPortfolio(key, v){
  if(!nwAtActive || !(key in nwAtActive.sel.f)) return;
  nwAtActive.sel.f[key] = Math.min(100, Math.max(0, +v || 0)) / 100;
  nwAtActive.render();
}
function nwAtSet(i, sell){
  if(!nwAtActive || !(i in nwAtActive.sel.sold)) return;
  nwAtActive.sel.sold[i] = !!sell;
  nwAtActive.render();
}
function nwAtAll(sell){
  if(!nwAtActive) return;
  Object.keys(nwAtActive.sel.f).forEach(k => { nwAtActive.sel.f[k] = sell ? 1 : 0; });
  nwAtActive.sel.sold.fill(!!sell);
  nwAtActive.render();
}

// ── After-tax popup ─────────────────────────────────────────────────────
// Click the Net Worth badge. Pick what to sell (shares & ETFs %, crypto %, each
// property) and see the net worth that leaves you with after CGT and selling
// costs. The default — sell everything — is the same figure this popup always
// showed. Estimation rules are documented on nwEstimateCGTIfSold above.
function nwShowAfterTax(){
  if(typeof computeCGTSummary !== 'function' || typeof calcTax !== 'function'){
    if(typeof notify === 'function') notify('CGT/tax modules not loaded yet', 'err');
    return;
  }
  let est;
  try{ est = nwEstimateCGTIfSold(); }
  catch(e){ console.error('After-tax estimate failed', e); if(typeof notify === 'function') notify('Could not estimate CGT: ' + e.message, 'err'); return; }

  const model = nwAtBuildModel(est);
  const allF = v => model.segments.reduce((o, sg) => { o[sg.key] = v; return o; }, {});
  const sel = { f: allF(1), sold: model.props.map(() => true) };
  const everything = nwAfterTaxScenario(model, { f: allF(1), sold: model.props.map(() => true) });
  const nProps = model.props.length;
  const hasTaxableProp = model.props.some(p => p.taxable);
  const anySellCosts = model.props.some(p => p.sellCosts > 0);
  const anyOffset = model.props.some(p => p.offset > 0);

  const esc = v => typeof escHtml === 'function' ? escHtml(v) : String(v);
  const label = k => esc(typeof getPersonLabel === 'function' ? getPersonLabel(k) : k);
  const gl = v => `<span style="color:${v>=0?'var(--green)':'var(--red)'}">${v>=0?'':'−'}${n2(Math.abs(v))}</span>`;
  const dash = v => Math.abs(v) < 0.005 ? '—' : n2(v);
  const minus = v => v > 0.004 ? '−' + n2(v) : v < -0.004 ? '+' + n2(-v) : '—';
  const cell = 'text-align:right;padding:8px 14px;white-space:nowrap';
  const th = 'text-align:right;padding:6px 14px;color:var(--text3);font-size:10px;white-space:nowrap';
  const gcol = v => v >= 0 ? 'var(--green)' : 'var(--red)';
  const title = t => `<div style="font-size:11px;font-weight:700;color:var(--text2);margin:16px 0 6px">${t}</div>`;
  const tbl = rows => `<table style="width:100%;border-collapse:collapse">${rows}</table>`;
  const line = (lbl, val, opts) => `<tr style="${opts&&opts.top?'border-top:1px solid var(--border);':''}">
    <td style="padding:6px 0;${opts&&opts.bold?'font-weight:700;font-size:14px;':''}">${lbl}</td>
    <td style="text-align:right;padding:6px 0;${opts&&opts.bold?'font-weight:700;font-size:14px;':''}${opts&&opts.color?'color:'+opts.color+';':''}">${val}</td></tr>`;

  // ── controls (built once; handlers re-render the results, never this markup) ──
  const segBtn = (i, sell) => `<button type="button" data-nw-i="${i}" data-nw-sell="${sell?1:0}" onclick="nwAtSet(${i},${sell})" style="border:none;padding:5px 14px;font:inherit;font-size:11px;cursor:pointer">${sell?'Sell':'Hold'}</button>`;
  const segRows = model.segments.map(sg => `
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:10px 0;border-top:1px solid var(--border)">
        <div style="flex:1 1 240px;min-width:0">
          <div style="font-weight:600">${esc(sg.label)}</div>
          <div style="font-size:10px;color:var(--text3)">${esc(sg.hint)}</div>
        </div>
        <div style="flex:0 0 130px;text-align:right">${n2(sg.value)}</div>
        <div style="flex:0 0 280px;display:flex;align-items:center;gap:10px">
          <input type="range" data-nw-seg="${sg.key}" min="0" max="100" step="5" value="100" aria-label="Percent of ${esc(sg.short)} to sell" oninput="nwAtSetPortfolio('${sg.key}',this.value)" style="flex:1;min-width:0;accent-color:var(--blue)">
          <span data-nw-pct="${sg.key}" style="min-width:62px;text-align:right;font-weight:700"></span>
        </div>
      </div>`).join('');
  const propRows = model.props.map((p, i) => `
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:10px 0;border-top:1px solid var(--border)">
      <div style="flex:1 1 240px;min-width:0">
        <div style="font-weight:600">${esc(p.name)} <span style="color:var(--text3);font-weight:400">· ${label(p.owner)}</span></div>
        <div style="font-size:10px;color:var(--text3)">${p.ppor ? 'Main residence · CGT-exempt' : p.taxable ? 'Investment property' : 'Investment property · no purchase price/date, CGT not estimated'}</div>
      </div>
      <div style="flex:0 0 130px;text-align:right"><div>${n2(p.value)}</div><div style="font-size:10px;color:var(--text3)">equity ${n2(p.value - p.loan)}</div></div>
      <div style="flex:0 0 280px;display:flex;justify-content:flex-end">
        <div role="group" aria-label="Hold or sell ${esc(p.name)}" style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">${segBtn(i, 0)}${segBtn(i, 1)}</div>
      </div>
    </div>`).join('');

  const quickBtn = 'background:none;border:1px solid var(--border);border-radius:5px;color:var(--text2);font:inherit;font-size:11px;padding:3px 10px;cursor:pointer';
  const controls = `
    <div id="nw-at-controls" style="border:1px solid var(--border);border-radius:8px;padding:10px 16px;margin-bottom:4px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px">
        <div style="font-size:11px;font-weight:700;color:var(--text2)">What would you sell?</div>
        <div style="display:flex;gap:8px"><button type="button" style="${quickBtn}" onclick="nwAtAll(1)">Sell everything</button><button type="button" style="${quickBtn}" onclick="nwAtAll(0)">Hold everything</button></div>
      </div>
      ${segRows}
      ${propRows}
    </div>`;

  const header = `
    <div data-hud-header style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px">
      <div style="min-width:0">
        <div style="font-size:15px;font-weight:700;color:var(--text)">After-tax net worth</div>
        <div id="nw-at-headline" style="margin-top:4px"></div>
      </div>
      <button class="btn btn-g" style="padding:3px 10px;font-size:11px;flex:0 0 auto" onclick="closeHudPopup('nw-after-tax')">✕</button>
    </div>`;

  const disclaimer = `
    <div style="margin-top:14px;color:var(--text3);font-size:10px;line-height:1.5">
      Estimate of the capital gains tax if the holdings you've selected were sold today. Uses the 50% discount for assets held over 12 months, offsets losses against short-term gains first, and includes gains/losses already realised this financial year plus any carried-forward losses — so the tax shown is the extra tax the sale would add. Taxed at marginal rates (income tax + Medicare levy) on top of each person's estimated income, the same base-income estimate the CGT simulator auto-fills, so tax on a combination isn't the sum of each asset's tax: when you sell several things together, the total is exact but its split is attributed in order — shares &amp; ETFs first, then crypto, then property — each showing the extra tax it adds. A partial sale of shares or crypto assumes every parcel is sold in equal proportion. Main residence treated as exempt; super isn't reduced. Doesn't include the proposed CGT reform cut-off, brokerage on shares, or property selling costs unless you've set Est. Selling Costs % on the property, or other tax circumstances. Property selling costs (from each property's Est. Selling Costs %) are deducted in the after-tax figure. Estimate only — not tax advice.
    </div>`;

  // ── live pieces ──
  const describe = r => {
    const parts = [];
    const active = r.segs.filter(sg => sg.f > 0);
    if(active.length){
      if(r.segs.every(sg => Math.round(sg.f * 100) === 100)) parts.push(r.segs.length > 1 ? 'the whole portfolio' : 'all ' + r.segs[0].short);
      else active.forEach(sg => { const pct = Math.round(sg.f * 100); parts.push(pct === 100 ? 'all ' + sg.short : pct + '% of ' + sg.short); });
    }
    if(r.soldProps.length){
      const word = nProps === 1 ? 'property' : 'properties';
      parts.push(r.soldProps.length === nProps ? (nProps === 1 ? 'the property' : `all ${nProps} properties`) : `${r.soldProps.length} of ${nProps} ${word}`);
    }
    return parts.length ? 'Selling ' + parts.join(' + ') : 'Holding everything';
  };

  const headlineHtml = r => {
    const pct = model.netWorth ? (Math.abs(r.delta) / Math.abs(model.netWorth) * 100).toFixed(1) : '0.0';
    const d = Math.abs(r.delta) < 0.005 ? '<span style="color:var(--text3)">no change vs net worth today</span>'
      : `<span style="color:var(--red)">−${n2(Math.abs(r.delta))} (−${pct}%)</span> <span style="color:var(--text3)">vs net worth today</span>`;
    return `<span style="font-size:20px;font-weight:700;color:var(--text)">${n2(r.afterTaxNW)}</span> <span style="margin-left:8px">${d}</span>
      <div style="margin-top:2px;color:var(--text3);font-size:11px">${describe(r)}</div>`;
  };

  const resultsHtml = r => {
    const bridge = tbl(
      line('Net worth today', n2(model.netWorth)) +
      r.segs.map(sg => line(`Less: est. CGT on ${sg.short}`, minus(sg.tax), {color: sg.tax > 0.004 ? 'var(--red)' : ''})).join('') +
      (hasTaxableProp ? line('Less: est. CGT on investment property', minus(r.propTax), {color: r.propTax > 0.004 ? 'var(--red)' : ''}) : '') +
      (nProps ? line('Less: selling costs on property sales', minus(r.sold.sellCosts), {color: r.sold.sellCosts > 0 ? 'var(--red)' : ''}) : '') +
      line('After-tax net worth', n2(r.afterTaxNW), {bold: true, top: true}));

    const diff = r.afterTaxNW - everything.afterTaxNW;
    const vsAll = Math.abs(diff) < 0.005 ? '' :
      `<div style="margin-top:8px;color:var(--text2)">Compared with selling everything: <b style="color:${gcol(diff)}">${diff >= 0 ? '+' : '−'}${n2(Math.abs(diff))}</b> after tax <span style="color:var(--text3)">(selling everything leaves ${n2(everything.afterTaxNW)})</span></div>`;

    const cashBlock = r.sold.count ? `
      ${title(`Cash in hand from the ${r.sold.count} ${r.sold.count === 1 ? 'property' : 'properties'} sold`)}
      ${tbl(
        line('Sale value', n2(r.sold.value)) +
        line('Less: selling costs', minus(r.sold.sellCosts)) +
        line('Less: loan payouts', minus(r.sold.loan)) +
        line('Less: est. CGT', minus(r.propTax)) +
        line('Net cash from sales', n2(r.propNetCash), {bold: true, top: true, color: gcol(r.propNetCash)}) +
        line('Plus: offset balances (your own cash)', r.sold.offset > 0 ? '+' + n2(r.sold.offset) : '—') +
        line('Total cash after selling these properties', n2(r.propTotalCash), {bold: true, top: true, color: gcol(r.propTotalCash)}))}
      <div style="margin-top:6px;color:var(--text3);font-size:10px;line-height:1.5">Loans are repaid in full from the proceeds; offset balances stay yours and are added separately. CGT is the property figure above (properties sold alongside the portfolio) — each property card estimates it as if sold on its own, so the totals can differ. Main residence is treated as CGT-exempt.${anySellCosts ? '' : ' Selling costs aren\'t included — set Est. Selling Costs % on each property to include agent/legal fees.'}</div>` : '';

    const holdBlock = `
      ${title("After selling, you'd hold")}
      ${tbl(
        r.segs.map(sg => line(`${esc(sg.label)} kept (at market value)`, dash(sg.held))).join('') +
        (nProps ? line('Properties kept (equity' + (anyOffset ? ' + offset cash' : '') + ')', dash(r.held.equity + r.held.offset)) : '') +
        r.segs.map(sg => line(`Cash from ${esc(sg.short)} sold (after CGT)`, dash(sg.cash))).join('') +
        (nProps ? line('Cash from property sales' + (anyOffset ? ' (incl. offset balances)' : ''), dash(r.propTotalCash)) : '') +
        line('Super (not sold)', n2(model.superBal)) +
        line('Total = after-tax net worth', n2(r.afterTaxNW), {bold: true, top: true}))}`;

    const personRows = r.rows.length ? `
      ${title('Estimated tax by person (this selection)')}
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="${th};text-align:left">Person</th><th style="${th}">Short-term</th><th style="${th}">Long-term</th><th style="${th}">Losses</th><th style="${th}">Added taxable gain</th><th style="${th}" title="Last financial year's taxable income, built the same way as the Tax tab. The added gain is stacked on top of it.">Base income (last FY)</th><th style="${th}">Est. tax</th><th style="${th}" title="Est. tax ÷ added taxable gain">Rate on added gain</th></tr></thead>
        <tbody>${r.rows.map(x => `<tr style="border-top:1px solid var(--border)">
          <td style="padding:8px 14px">${label(x.person)}</td>
          <td style="${cell}">${n2(x.short)}</td><td style="${cell}">${n2(x.long)}</td><td style="${cell}">${x.loss ? '−' + n2(x.loss) : '—'}</td>
          <td style="${cell}">${n2(x.added)}</td><td style="${cell};color:var(--text2)">${n2(x.base)}</td><td style="${cell};font-weight:700;color:var(--red)">${n2(x.tax)}</td><td style="${cell};color:var(--text2)">${x.added > 0 ? (x.tax / x.added * 100).toFixed(1) + '%' : '—'}</td></tr>`).join('')}
        </tbody></table></div>
        <div style="margin-top:6px;color:var(--text3);font-size:10px;line-height:1.5">The added gain is stacked on top of each person's base income (last financial year's taxable income, built the same way as the Tax tab: salary less sacrifice, dividends + franking, net rental, and that year's net capital gain). Only the slice that lands above $190,000 is taxed at 45% + 2% Medicare; the part below is taxed at the lower brackets, so the rate on the added gain is usually below the top rate.</div>`
      : `${title('Estimated tax by person (this selection)')}<div style="color:var(--text3)">${r.segs.some(sg => sg.f > 0) || r.soldProps.length ? 'No gains found in this selection — nothing to deduct.' : 'Nothing selected to sell — no tax.'}</div>`;

    const propTable = hasTaxableProp ? `
      ${title('Investment properties included')}
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="${th};text-align:left">Property</th><th style="${th}">Value</th><th style="${th}">Cost base</th><th style="${th}">Selling costs</th><th style="${th}">Gain</th><th style="${th}">&gt; 12 months</th><th style="${th}">Action</th></tr></thead>
        <tbody>${model.props.map((p, i) => !p.taxable ? '' : `<tr style="border-top:1px solid var(--border);${sel.sold[i] ? '' : 'opacity:.45'}">
          <td style="padding:8px 14px">${esc(p.name)} <span style="color:var(--text3)">· ${label(p.owner)}</span></td>
          <td style="${cell}">${n2(p.value)}</td><td style="${cell}">${n2(p.costBase)}</td><td style="${cell}">${p.sellCosts ? n2(p.sellCosts) : '—'}</td>
          <td style="${cell}">${gl(p.gain)}</td><td style="${cell}">${p.long ? 'Yes (50% discount)' : 'No'}</td>
          <td style="${cell};font-weight:700">${sel.sold[i] ? 'Sell' : 'Hold'}</td></tr>`).join('')}
        </tbody></table></div>` : '';

    const flags = [];
    if(r.segs.some(sg => sg.f > 0) && est.unpriced.length) flags.push(`No price for ${est.unpriced.map(esc).join(', ')} — excluded from the estimate.`);
    const noData = r.soldProps.filter(p => !p.ppor && !p.taxable).map(p => esc(p.name));
    if(noData.length) flags.push(`${noData.join(', ')} excluded from the tax estimate — no purchase price/date recorded (needed for a cost base). Its cash above is before CGT.`);

    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr));gap:0 40px;align-items:start">
        <div>${title('From net worth to after-tax net worth')}${bridge}${vsAll}${cashBlock}</div>
        <div>${holdBlock}</div>
      </div>
      ${personRows}
      ${propTable}
      ${flags.length ? `<div style="margin-top:12px;color:var(--amber);font-size:11px">${flags.map(f => '⚠ ' + f).join('<br>')}</div>` : ''}`;
  };

  const paintControls = () => {
    document.querySelectorAll('#nw-at-controls [data-nw-seg]').forEach(sl => {
      const key = sl.dataset.nwSeg, pct = Math.round((sel.f[key] || 0) * 100);
      if(+sl.value !== pct) sl.value = pct;
      const lab = document.querySelector(`#nw-at-controls [data-nw-pct="${key}"]`);
      if(lab) lab.textContent = pct === 0 ? 'Hold' : pct === 100 ? 'Sell all' : 'Sell ' + pct + '%';
    });
    document.querySelectorAll('#nw-at-controls [data-nw-i]').forEach(b => {
      const i = +b.dataset.nwI, isSellBtn = b.dataset.nwSell === '1';
      const active = !!sel.sold[i] === isSellBtn;
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
      b.style.background = active ? (isSellBtn ? 'var(--amber)' : 'var(--blue)') : 'transparent';
      b.style.color = active ? '#0a1319' : 'var(--text3)';
      b.style.fontWeight = active ? '700' : '400';
    });
  };

  const render = () => {
    const r = nwAfterTaxScenario(model, sel);
    const h = document.getElementById('nw-at-headline');
    const out = document.getElementById('nw-at-results');
    if(!h || !out) return; // popup was closed
    h.innerHTML = headlineHtml(r);
    out.innerHTML = resultsHtml(r);
    paintControls();
  };

  const panel = openHudPopup('nw-after-tax', header + controls + '<div id="nw-at-results"></div>' + disclaimer,
    { minWidth: '560px', width: '1000px', fontSize: '12px' });
  if(!panel) return; // clicking again just closes it
  nwAtActive = { model, sel, render };
  render();
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
    <div class="cards" id="nw-cards" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
      <div class="card" role="button" tabindex="0" title="Click for after-tax net worth" style="cursor:pointer;${nwTint(NW_COLORS.networth)}" onclick="nwShowAfterTax()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();nwShowAfterTax();}"><div class="card-label">Net Worth</div><div class="card-value neu">${n2(netWorth,0)}</div><div class="card-sub">Portfolio + Property + Cash + Super − Loan</div><div class="card-sub" style="color:#8fe6d2">Click for after-tax view ›</div></div>
      <div class="card" style="${nwTint(NW_COLORS.portfolio)}"><div class="card-label">Portfolio</div><div class="card-value neu">${n2(portfolioVal,0)}</div><div class="card-sub">Market value</div></div>
      <div class="card" style="${nwTint(NW_COLORS.property)}"><div class="card-label">Property Value</div><div class="card-value neu">${n2(propertyVal,0)}</div><div class="card-sub">Current value, gross</div></div>
      <div class="card" style="${nwTint(NW_COLORS.cash)}"><div class="card-label">Offset Cash</div><div class="card-value neu">${n2(offsetCash,0)}</div><div class="card-sub">Offset account balances</div></div>
      <div class="card" style="${nwTint(NW_COLORS.super)}"><div class="card-label">Super</div><div class="card-value neu">${n2(superBal,0)}</div><div class="card-sub">All accounts</div></div>
      <div class="card" style="${nwTint(NW_COLORS.loan)}"><div class="card-label">Loan</div><div class="card-value neu">${n2(loanBal,0)}</div><div class="card-sub">Total loan balance</div></div>
    </div>

    <div class="tw" style="margin-bottom:18px">
      <div class="th"><span class="tt">Composition</span></div>
      <div style="padding:16px 20px">${barHtml}</div>
    </div>

    <div class="tw">
      <div class="th"><span class="tt">FIRE Projection</span><span style="font-size:10px;color:var(--text3)">4% rule · estimates only</span></div>
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
          <div class="card" style="${nwTint('var(--asset-teal)')}"><div class="card-label">FIRE Number</div><div class="card-value neu">${n2(fireNumber,0)}</div><div class="card-sub">25× annual spend</div></div>
          <div class="card" style="${nwTint('var(--cat-super)')}"><div class="card-label">Time to FIRE</div><div class="card-value ${reached?'pos':'neu'}">${fireLabel}</div><div class="card-sub">Liquid balance + contributions</div></div>
          <div class="card" style="${nwTint('var(--cat-portfolio)')}"><div class="card-label">Liquid Starting Balance</div><div class="card-value neu">${n2(liquidStart,0)}</div><div class="card-sub">Portfolio only — Super locked until retired at 60+</div></div>
          <div class="card" style="${nwTint(propertyCF>=0?'var(--cat-income)':'var(--debt-red)')}"><div class="card-label">Net Rental Income</div><div class="card-value ${propertyCF>=0?'pos':'neg'}">${propertyCF>=0?'+':''}${n2(propertyCF,0)}/yr</div><div class="card-sub">Sum of each rental's Net Annual Income</div></div>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:14px">Property equity (${n2(propertyEq)}) and offset cash (${n2(offsetCash)}) aren't counted in the liquid balance above — it can't be drawn down like an investment. Instead, its Net Rental Income (same figure shown per-property in the Property tab — rent minus expenses minus interest, excluding your own home) ${propertyCF>=0?'is currently boosting':'is currently reducing'} your yearly contribution by ${n2(Math.abs(propertyCF))}.</div>
        <div style="height:220px"><canvas id="nw-fire-chart"></canvas></div>
        <div style="font-size:11px;color:var(--text3);margin-top:8px">Rough compound-growth estimate only — ignores tax, fees, sequence-of-returns risk, and inflation on the spend figure. Not financial advice.</div>
      </div>
    </div>

    <div class="tw" style="margin-top:18px">
      <div class="th"><span class="tt">Target-Based Planning</span><span style="font-size:10px;color:var(--text3)">Solves for the savings rate your target ages require</span></div>
      <div style="padding:16px 20px">
        ${!hasFI ? `<div style="color:var(--text3);font-size:12px">Enter your current age and a target FI age above to see the savings rate required to get there.</div>` :
          !validFI ? `<div style="color:var(--red);font-size:12px">Target FI age must be after your current age.</div>` : `
          <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:14px">
            <div class="card" style="${nwTint('var(--cat-super)')}"><div class="card-label">Years to FI</div><div class="card-value neu">${yearsToFI}</div><div class="card-sub">Age ${currentAge} → ${fiAge}</div></div>
            <div class="card" style="${nwTint('var(--asset-forest)')}"><div class="card-label">Required Monthly Savings</div><div class="card-value neu">${n2(Math.max(0,requiredMonthlyFromYou),0)}</div><div class="card-sub">On top of net rental income</div></div>
            <div class="card" style="${nwTint(monthlyGap>=0?'var(--asset-green)':'var(--debt-red)')}"><div class="card-label">Your Current Rate</div><div class="card-value ${monthlyGap>=0?'pos':'neg'}">${n2(monthlyContrib,0)}</div><div class="card-sub">${monthlyGap>=0?'+':''}${n2(monthlyGap)}/mo vs required</div></div>
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
      <div class="th"><span class="tt">Annual Snapshots (30 June)</span><span style="font-size:10px;color:var(--text3)">Holdings, Super &amp; Property — stored per FY, exportable as CSV</span></div>
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
          { label:'Projected liquid balance', data:[liquidStart, ...balances], borderColor:'#2fc4a4', backgroundColor:'rgba(47,196,164,.10)', borderWidth:2, fill:true, tension:0.25, pointRadius:0 },
          { label:'FIRE number', data:Array(years.length+1).fill(fireNumber), borderColor:'#e0b25c', borderDash:[6,4], borderWidth:1.5, pointRadius:0 },
        ],
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins:{ legend:{ labels:{ color:'#a8b0bc', font:{size:10.5}, boxWidth:8, boxHeight:8, usePointStyle:true } } },
        scales:{
          x:{ ticks:{ color:'#79828f', maxTicksLimit:10 }, grid:{ color:'rgba(255,255,255,.04)' } },
          y:{ ticks:{ color:'#79828f', callback:v=>'$'+(v/1000).toFixed(0)+'k' }, grid:{ color:'rgba(255,255,255,.04)' } },
        },
      },
    });
  }
}