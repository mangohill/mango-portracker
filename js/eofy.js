// ── eofy.js ──────────────────────────────────────────────────────────
// One-click EOFY pack: pulls together the Capital Gains summary, dividend
// + franking credit totals, spending summary, and a portfolio value
// snapshot for a given financial year into a single printable page.
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
    const share = person == null ? 1 : (own === person ? 1 : (own === 'joint' ? 0.5 : 0));
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
  const dates = Object.keys(pfSnapshots).filter(d => d <= target).sort();
  if(!dates.length) return null;
  const last = dates[dates.length-1];
  const snap = pfSnapshots[last];
  return { date: last, value: snap.all };
}

function generateEofyPack(fy){
  const persons = typeof getAllPersons === 'function' ? getAllPersons() : ['lumia','chilli'];
  const cgtAll = typeof computeCGTSummary === 'function' ? computeCGTSummary().result : {};

  const money = v => v==null ? '—' : '$'+Number(v).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});
  const label = k => typeof getPersonLabel === 'function' ? getPersonLabel(k) : k;

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
  const snap = eofyPortfolioSnapshot(fy);
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
</style></head><body>
  <div class="printbar"><button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
  <h1>EOFY Pack — FY${fy}</h1>
  <div class="sub">${fy-1}–${String(fy).slice(2)} financial year · Generated ${today}</div>

  <h2>Capital Gains Tax</h2>
  ${cgtRows.length ? `<table><thead><tr><th>Person</th><th style="text-align:right">Short-term gain</th><th style="text-align:right">Long-term gain</th><th style="text-align:right">Post-discount</th><th style="text-align:right">Losses</th><th style="text-align:right">Net capital gain</th><th style="text-align:right">Loss carried fwd</th></tr></thead><tbody>${cgtRows.join('')}</tbody></table>`
    : `<div class="empty">No disposals recorded for FY${fy}.</div>`}
  <div class="note">Net capital gain = net short-term gain + long-term gain after the 50% CGT discount, less available losses. Figures are estimates — confirm against your own records before lodging.</div>

  <h2>Dividends &amp; Franking Credits</h2>
  ${divRows.length ? `<table><thead><tr><th>Person</th><th style="text-align:right">Dividends received</th><th style="text-align:right">Franking credits</th><th style="text-align:right">Grossed-up income</th></tr></thead><tbody>${divRows.join('')}<tr style="font-weight:700"><td>Total</td><td style="text-align:right">${money(divTotal.amount)}</td><td style="text-align:right">${money(divTotal.franking)}</td><td style="text-align:right">${money(divTotal.amount+divTotal.franking)}</td></tr></tbody></table>`
    : `<div class="empty">No dividends, distributions, DRP, or interest recorded for FY${fy}.</div>`}

  <h2>Spending Summary</h2>
  ${spend ? `<table><thead><tr><th>Metric</th><th style="text-align:right">Amount</th></tr></thead><tbody>
      <tr><td>Total categorised spend</td><td style="text-align:right">${money(spend.totalOut)}</td></tr>
      <tr><td>Money in (refunds, other income)</td><td style="text-align:right">${money(spend.totalIn)}</td></tr>
      <tr style="font-weight:700"><td>Net</td><td style="text-align:right">${money(spend.net)}</td></tr>
    </tbody></table>
    ${spend.topCats.length ? `<div class="note" style="margin-bottom:4px">Top categories:</div><table><tbody>${spend.topCats.map(([c,v])=>`<tr><td>${c}</td><td style="text-align:right">${money(v)}</td></tr>`).join('')}</tbody></table>` : ''}`
    : `<div class="empty">No spending data recorded for FY${fy}.</div>`}

  <h2>Portfolio Snapshot</h2>
  ${snap ? `<table><tbody><tr><td>Market value as at ${snap.date}</td><td style="text-align:right;font-weight:700">${money(snap.value)}</td></tr></tbody></table><div class="note">Nearest recorded snapshot on or before 30 June FY${fy}.</div>`
    : `<div class="empty">No price snapshot available for this period.</div>`}

  <div class="disclaimer">This pack is generated from data you've entered into Portfolio Tracker and is provided for convenience only. All figures — capital gains, franking credits, and spending totals — are estimates and have not been reviewed by a registered tax agent. Verify all figures against your own broker/ATO records before lodging a tax return.</div>
</body></html>`;

  const w = window.open('', '_blank');
  if(!w){ if(typeof notify==='function') notify('Pop-up blocked — allow pop-ups to generate the EOFY pack', 'err'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
