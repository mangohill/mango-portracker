// ── eofy.js ──────────────────────────────────────────────────────────
// One-click EOFY pack: pulls together the Capital Gains summary, dividend
// + franking credit totals, property rental income/expenses, spending
// summary, and a portfolio value snapshot for a given financial year into a
// single printable page.
// Opens in a new tab styled for print/PDF — use the browser's own
// "Print → Save as PDF" so no PDF-generation library is needed.
// Read-only: touches no stored data, only reads via the same functions
// the Tax/CGT/Dividends/Spending tabs already use.

function eofyDivFranking(fy, person){
  if(typeof dividends === 'undefined') return {amount:0, franking:0};
  const types = ['dividend','distribution','drp','interest'];
  let amount = 0, franking = 0;
  dividends.filter(d => dateToFY(d.date) === fy && types.includes(d.type)).forEach(d => {
    const own = typeof getSymbolOwner === 'function' ? getSymbolOwner(d.symbol) : 'joint';
    // 'joint' means split 50/50 between Lumia and Chilli specifically — the
    // pair the label refers to — NOT an equal split across everyone in
    // getAllPersons(). Custom/extra persons (Cg, Sg, ...) are always
    // individually owned and get 0 of a jointly-owned dividend. Without this
    // scoping, every extra person added also received a 0.5 share here,
    // so a joint dividend was attributed at well over 100% once more than
    // two people existed in the system. JOINT_PERSONS is defined once in
    // helpers.js (loaded before this file); fall back defensively if not.
    const jointPersons = typeof JOINT_PERSONS !== 'undefined' ? JOINT_PERSONS : ['lumia', 'chilli'];
    const share = person == null ? 1 : (own === person ? 1 : (own === 'joint' && jointPersons.includes(person) ? 0.5 : 0));
    const amt = (+d.amount || 0) * share;
    amount += amt;
    if(typeof frankingCredit === 'function') franking += frankingCredit(amt, d.frankingPct || 0);
  });
  return { amount, franking };
}

function eofySpendingSummary(fy){
  if(typeof spendingData === 'undefined') return null;
  const rows = spendingData.filter(d => d.fy === fy);
  if(!rows.length) return null;
  const SP_MONEY_IN = new Set(['__REFUND__', '__OTHER_INCOME__']);
  const SP_EXCLUDE = new Set(['__TRANSFERS__']);
  const totalOut = rows.filter(d => d.amount < 0 && !SP_MONEY_IN.has(d.category) && !SP_EXCLUDE.has(d.category))
    .reduce((s,d) => s + (-d.amount), 0);
  const totalIn = rows.filter(d => d.amount > 0 && !SP_EXCLUDE.has(d.category))
    .reduce((s,d) => s + d.amount, 0);
  const byCat = {};
  rows.filter(d => d.amount < 0 && !SP_MONEY_IN.has(d.category) && !SP_EXCLUDE.has(d.category))
    .forEach(d => { byCat[d.category] = (byCat[d.category]||0) + (-d.amount); });
  const topCats = Object.entries(byCat).sort((a,b) => b[1]-a[1]).slice(0,5);
  return { totalOut, totalIn, net: totalIn-totalOut, topCats };
}

function eofyPortfolioSnapshot(fy){
  if(typeof pfSnapshots === 'undefined') return null;
  const target = fy + '-06-30';

  // Prefer a true mark-to-market reconstruction: holdings held on the
  // nearest priced snapshot on/before 30 June, valued at the nearest
  // available quote per symbol. This avoids the stale/understated `all`
  // totals recorded on days when only some holdings had a price.
  const pricedDate = (typeof findPricedSnapshotOnOrBefore === 'function')
    ? findPricedSnapshotOnOrBefore(target) : null;
  if(pricedDate && typeof markToMarketAt === 'function' && typeof calcH === 'function'){
    const mtm = markToMarketAt(pricedDate, ()=>true);
    if(mtm && mtm.value != null){
      return { date: pricedDate, value: mtm.value, priced: mtm.priced, count: mtm.count,
               complete: mtm.complete, recomputed: true };
    }
  }

  // Fallback: the stored total for the latest snapshot on/before 30 June.
  const dates = Object.keys(pfSnapshots).filter(d => d <= target).sort();
  if(!dates.length) return null;
  const last = dates[dates.length-1];
  const snap = pfSnapshots[last];
  return { date: last, value: snap.all, recomputed: false };
}

// Property rental summary for the EOFY pack. Mirrors the Tax tab's
// per-property expense inputs (Council Rates / Insurance / Repairs /
// Agent / Other / Depreciation) and its ownership and part-year logic, so
// the pack reconciles with the figures on the Tax tab. Rental loan interest
// is pro-rated for part-year ownership; investment-purpose loan interest is
// tracked separately because it's deductible against investment income,
// not against rent.
function eofyPropertySummary(fy){
  if(typeof properties === 'undefined' || !properties.length) return null;
  const rec = (typeof getTaxRecord === 'function') ? getTaxRecord(fy) : {props:{}};
  const persons = (typeof getAllPersons === 'function') ? getAllPersons() : ['lumia','chilli'];
  const jointPersons = typeof JOINT_PERSONS !== 'undefined' ? JOINT_PERSONS : ['lumia','chilli'];
  const fyStart = new Date((fy-1)+'-07-01');
  const fyEnd   = new Date(fy+'-06-30');
  const fyDays  = Math.round((fyEnd - fyStart)/86400000) + 1;

  function ownedFraction(p){
    const from = p.purchaseDate ? new Date(String(p.purchaseDate).slice(0,10)) : null;
    const to   = (p.sold && p.soldDate) ? new Date(String(p.soldDate).slice(0,10)) : null;
    const a = (from && from > fyStart) ? from : fyStart;
    const b = (to && to < fyEnd) ? to : fyEnd;
    const days = Math.round((b - a)/86400000) + 1;
    return Math.max(0, Math.min(1, days / fyDays));
  }

  const rows = [];
  const byPerson = {};
  persons.forEach(k => { byPerson[k] = { rent:0, exp:0, invInterest:0 }; });

  properties.forEach(p => {
    const own = ownedFraction(p);
    if(own <= 0) return;
    const pOwner = p.owner || 'joint';
    const share = pOwner === 'joint' ? 0.5 : 1;
    const pr = (rec.props && rec.props[p.id]) || {};

    let splits = [];
    if(typeof normaliseSplits === 'function'){ try { splits = normaliseSplits(p); } catch(e){ splits = []; } }
    let rentalInterest = 0, invInterest = 0;
    splits.forEach(sp => {
      const purpose = sp.purpose || 'rental';
      const annInt = Math.max(0, (+sp.balance||0)-(+sp.offset||0)) * ((+sp.rate||0)/100);
      if(purpose === 'investment') invInterest += annInt;
      else if(purpose === 'rental') rentalInterest += annInt;
    });

    const expenseBase = ['rates','insurance','repairs','agent','other','depr_bldg','depr_pe']
      .reduce((s,k)=>s+(+pr[k]||0),0);
    const isPpor = p.propType === 'ppor';
    // Property-level totals (no ownership share) so the entered expense
    // amounts are shown in full; the per-person summary below applies the
    // owner's share (joint = 50/50 across JOINT_PERSONS).
    const rent    = isPpor ? 0 : (p.weeklyRent||0)*52*own;
    const interest= isPpor ? 0 : rentalInterest*own;
    const expense = isPpor ? 0 : expenseBase + interest;

    rows.push({
      name: p.name||p.address||'Property', owner:pOwner, own, ppor:isPpor,
      rent,
      rates:+pr.rates||0, insurance:+pr.insurance||0, repairs:+pr.repairs||0,
      agent:+pr.agent||0, other:+pr.other||0,
      depr:(+pr.depr_bldg||0)+(+pr.depr_pe||0),
      interest, expense, net: rent - expense,
    });

    persons.forEach(person => {
      const isOwner = pOwner===person || (pOwner==='joint' && jointPersons.includes(person));
      if(!isOwner) return;
      if(!isPpor){
        byPerson[person].rent += rent*share;
        byPerson[person].exp  += expense*share;
      }
      // Investment-purpose loan interest is deductible against investment
      // income regardless of property type (same as the Tax tab).
      byPerson[person].invInterest += invInterest*share*own;
    });
  });

  if(!rows.length) return null;
  return { rows, byPerson };
}

function generateEofyPack(fy){
  const persons = typeof getAllPersons === 'function' ? getAllPersons() : ['lumia','chilli'];
  const cgtAll = typeof computeCGTSummary === 'function' ? computeCGTSummary().result : {};

  const money = v => v==null ? '—' : (Number(v) < 0 ? '-$' : '$') + Math.abs(Number(v)).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});
  const esc = v => typeof escHtml === 'function' ? escHtml(v) : String(v);
  const label = k => esc(typeof getPersonLabel === 'function' ? getPersonLabel(k) : k);

  const cgtRows = persons.map(p => {
    const r = (cgtAll[p]||{})[fy];
    if(!r) return null;
    return `<tr>
      <td>${label(p)}</td>
      <td style="text-align:right">${money(r.netShort)}</td>
      <td style="text-align:right">${money(r.longGain)}</td>
      <td style="text-align:right">${money(r.discountedLong)}</td>
      <td style="text-align:right">${money(r.losses)}</td>
      <td style="text-align:right;font-weight:700">${money(r.netCapitalGain)}</td>
      <td style="text-align:right">${money(r.lossCarryOut)}</td>
    </tr>`;
  }).filter(Boolean);

  const divRows = persons.map(p => {
    const d = eofyDivFranking(fy, p);
    if(!d.amount && !d.franking) return null;
    return `<tr><td>${label(p)}</td><td style="text-align:right">${money(d.amount)}</td><td style="text-align:right">${money(d.franking)}</td><td style="text-align:right;font-weight:700">${money(d.amount+d.franking)}</td></tr>`;
  }).filter(Boolean);
  const divTotal = eofyDivFranking(fy, null);

  const spend = eofySpendingSummary(fy);
  const prop  = eofyPropertySummary(fy);
  const snap  = eofyPortfolioSnapshot(fy);
  const today = new Date().toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'});

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EOFY Pack — FY${fy}</title>
<style>
  @page{ margin:18mm; }
  *{box-sizing:border-box;}
  body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111;max-width:800px;margin:0 auto;padding:24px;font-size:13px;line-height:1.5;}
  h1{font-size:22px;margin-bottom:2px;}
  .sub{color:#666;font-size:12px;margin-bottom:24px;}
  h2{font-size:15px;border-bottom:2px solid #111;padding-bottom:6px;margin:28px 0 12px;}
  table{width:100%;border-collapse:collapse;margin-bottom:6px;}
  th{text-align:left;font-size:11px;color:#666;border-bottom:1px solid #ccc;padding:5px 6px;}
  td{padding:5px 6px;border-bottom:1px solid #eee;font-size:12px;}
  .note{color:#777;font-size:11px;margin-top:6px;}
  .disclaimer{margin-top:36px;padding-top:12px;border-top:1px solid #ccc;color:#777;font-size:10.5px;}
  .printbar{position:sticky;top:0;background:#fff;padding:10px 0;text-align:right;border-bottom:1px solid #ddd;margin-bottom:10px;}
  .printbar button{font-size:13px;padding:8px 16px;border-radius:6px;border:1px solid #111;background:#111;color:#fff;cursor:pointer;}
  @media print{ .printbar{display:none;} }
  .empty{color:#999;font-style:italic;}
  .wide th,.wide td{font-size:10px;padding:4px 4px;}
  .wide th{font-size:9.5px;}
</style></head><body>
  <div class="printbar"><button onclick="window.print()">Print / Save as PDF</button></div>
  <h1>EOFY Pack — FY${fy}</h1>
  <div class="sub">${fy-1}–${String(fy).slice(2)} financial year · Generated ${today}</div>

  <h2>Capital Gains Tax</h2>
  ${cgtRows.length ? `<table><thead><tr><th>Person</th><th style="text-align:right">Short-term gain</th><th style="text-align:right">Long-term gain</th><th style="text-align:right">Post-discount</th><th style="text-align:right">Losses</th><th style="text-align:right">Net capital gain</th><th style="text-align:right">Loss carried fwd</th></tr></thead><tbody>${cgtRows.join('')}</tbody></table>`
    : `<div class="empty">No disposals recorded for FY${fy}.</div>`}
  <div class="note">Net capital gain = net short-term gain + long-term gain after the 50% CGT discount, less available losses. Figures are estimates — confirm against your own records before lodging.</div>

  <h2>Dividends &amp; Franking Credits</h2>
  ${divRows.length ? `<table><thead><tr><th>Person</th><th style="text-align:right">Dividends received</th><th style="text-align:right">Franking credits</th><th style="text-align:right">Grossed-up income</th></tr></thead><tbody>${divRows.join('')}<tr style="font-weight:700"><td>Total</td><td style="text-align:right">${money(divTotal.amount)}</td><td style="text-align:right">${money(divTotal.franking)}</td><td style="text-align:right">${money(divTotal.amount+divTotal.franking)}</td></tr></tbody></table>`
    : `<div class="empty">No dividends, distributions, DRP, or interest recorded for FY${fy}.</div>`}

  <h2>Property — Rental Income &amp; Expenses</h2>
  ${prop ? `
    <table class="wide"><thead><tr><th>Property</th><th>Owner</th><th style="text-align:right">Rent</th><th style="text-align:right">Rates</th><th style="text-align:right">Insurance</th><th style="text-align:right">Repairs</th><th style="text-align:right">Agent</th><th style="text-align:right">Other</th><th style="text-align:right">Depreciation</th><th style="text-align:right">Loan interest</th><th style="text-align:right">Total expenses</th><th style="text-align:right">Net</th></tr></thead><tbody>
      ${prop.rows.map(r => `<tr>
        <td>${esc(r.name)}${r.ppor?' <span class="note">(PPOR — excluded)</span>':''}${r.own<0.999?' <span class="note">('+Math.round(r.own*100)+'% of year)</span>':''}</td>
        <td>${label(r.owner)}${r.owner==='joint'?' <span class="note">(50% each)</span>':''}</td>
        <td style="text-align:right">${r.ppor?'—':money(r.rent)}</td>
        <td style="text-align:right">${r.ppor?'—':money(r.rates)}</td>
        <td style="text-align:right">${r.ppor?'—':money(r.insurance)}</td>
        <td style="text-align:right">${r.ppor?'—':money(r.repairs)}</td>
        <td style="text-align:right">${r.ppor?'—':money(r.agent)}</td>
        <td style="text-align:right">${r.ppor?'—':money(r.other)}</td>
        <td style="text-align:right">${r.ppor?'—':money(r.depr)}</td>
        <td style="text-align:right">${r.ppor?'—':money(r.interest)}</td>
        <td style="text-align:right">${r.ppor?'—':money(r.expense)}</td>
        <td style="text-align:right;font-weight:700">${r.ppor?'—':money(r.net)}</td>
      </tr>`).join('')}
    </tbody></table>
    <div class="note">Property totals are shown in full; joint-owned properties are split 50/50 in the person summary. Expenses are the amounts entered on the Tax tab for FY${fy}. Rent and rental loan interest are pro-rated for part-year ownership; a negative net is a rental loss. Investment-loan interest (e.g. redraw used to buy shares) is deductible against investment income and is shown in the person summary below.</div>
    <table><thead><tr><th>Person</th><th style="text-align:right">Rental income</th><th style="text-align:right">Deductions</th><th style="text-align:right">Net rental</th><th style="text-align:right">Investment interest</th></tr></thead><tbody>
      ${prop.rows.length && Object.entries(prop.byPerson).filter(([,v])=>v.rent||v.exp||v.invInterest).map(([k,v]) => `<tr><td>${label(k)}</td><td style="text-align:right">${money(v.rent)}</td><td style="text-align:right">${money(v.exp)}</td><td style="text-align:right;font-weight:700">${money(v.rent-v.exp)}</td><td style="text-align:right">${money(v.invInterest)}</td></tr>`).join('')}
    </tbody></table>` : `<div class="empty">No property rental data recorded for FY${fy}.</div>`}

  <h2>Spending Summary</h2>
  ${spend ? `<table><thead><tr><th>Metric</th><th style="text-align:right">Amount</th></tr></thead><tbody>
      <tr><td>Total categorised spend</td><td style="text-align:right">${money(spend.totalOut)}</td></tr>
      <tr><td>Money in (refunds, other income)</td><td style="text-align:right">${money(spend.totalIn)}</td></tr>
      <tr style="font-weight:700"><td>Net</td><td style="text-align:right">${money(spend.net)}</td></tr>
    </tbody></table>
    ${spend.topCats.length ? `<div class="note" style="margin-bottom:4px">Top categories:</div><table><tbody>${spend.topCats.map(([c,v])=>`<tr><td>${esc(c)}</td><td style="text-align:right">${money(v)}</td></tr>`).join('')}</tbody></table>` : ''}`
    : `<div class="empty">No spending data recorded for FY${fy}.</div>`}

  <h2>Portfolio Snapshot</h2>
  ${snap ? `<table><tbody><tr><td>Market value as at ${snap.date}${snap.recomputed?' (reconstructed)':''}</td><td style="text-align:right;font-weight:700">${money(snap.value)}</td></tr></tbody></table>
    <div class="note">${snap.recomputed
      ? `Reconstructed from the holdings held on ${snap.date}, priced at the nearest available quote per symbol${snap.count?` (${snap.priced} of ${snap.count} positions priced)`:''}${snap.complete===false?' — incomplete price coverage, treat as an estimate':''}.`
      : `Nearest recorded snapshot total on or before 30 June FY${fy}.`}</div>`
    : `<div class="empty">No price snapshot available for this period.</div>`}

  <div class="disclaimer">This pack is generated from data you've entered into Portfolio Tracker and is provided for convenience only. All figures — capital gains, dividends and franking credits, property rental income/expenses, and spending totals — are estimates and have not been reviewed by a registered tax agent. Verify all figures against your own broker/ATO records before lodging a tax return.</div>
</body></html>`;

  const w = window.open('', '_blank');
  if(!w){ if(typeof notify==='function') notify('Pop-up blocked — allow pop-ups to generate the EOFY pack', 'err'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}