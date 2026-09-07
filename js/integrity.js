// ── integrity.js ─────────────────────────────────────────────────────
// Read-only diagnostic scan across trades/holdings/dividends/prices.
// Never modifies stored data — only reports what it finds so you can
// go fix it in the relevant tab yourself.

function runIntegrityCheck(){
  const out = $('integrity-results');
  if(!out) return;

  const issues = { dup: [], negUnits: [], orphanDiv: [], missingPrice: [] };

  // ── Duplicate trades — same date+symbol+type+units+price appearing
  // more than once. Groups by a composite key rather than reusing
  // isTradeDuplicate() (that helper checks "is this NEW row already
  // present", not "find existing dupes within the saved set").
  const seen = {};
  (typeof trades !== 'undefined' ? trades : []).forEach(t => {
    const key = [t.date, t.symbol, t.type, (+t.units).toFixed(4), (+t.price).toFixed(4)].join('|');
    (seen[key] = seen[key] || []).push(t);
  });
  Object.values(seen).filter(g => g.length > 1).forEach(g => {
    issues.dup.push(`${g.length}× ${g[0].symbol} — ${g[0].type} ${g[0].units} @ ${n2(g[0].price)} on ${g[0].date}`);
  });

  // ── Negative-unit holdings — sold more than was ever bought, almost
  // always a missing buy trade or a mis-imported sell.
  if(typeof calcH === 'function'){
    calcH().filter(h => h.units < -0.000001).forEach(h => {
      issues.negUnits.push(`${h.symbol} — ${h.units.toFixed(4)} units`);
    });
  }

  // ── Orphaned dividends — symbol never appears in any trade at all
  // (not just "no longer held"), which usually means a typo on import.
  const tradedSymbols = new Set((typeof trades !== 'undefined' ? trades : []).map(t => t.symbol));
  const seenDivSymbols = new Set();
  (typeof dividends !== 'undefined' ? dividends : []).forEach(d => {
    if(!tradedSymbols.has(d.symbol) && !seenDivSymbols.has(d.symbol)){
      seenDivSymbols.add(d.symbol);
      issues.orphanDiv.push(`${d.symbol} — has dividends but no trades`);
    }
  });

  // ── Missing prices — currently held (non-zero units) symbols with no
  // stored price, so their value can't be marked to market anywhere.
  if(typeof calcH === 'function' && typeof prices !== 'undefined'){
    calcH().filter(h => h.units > 0.000001).forEach(h => {
      const sym = typeof priceSymbol === 'function' ? priceSymbol(h.symbol) : h.symbol;
      if(prices[sym] == null) issues.missingPrice.push(h.symbol);
    });
  }

  const total = issues.dup.length + issues.negUnits.length + issues.orphanDiv.length + issues.missingPrice.length;

  if(total === 0){
    out.innerHTML = `<div style="color:var(--green);font-size:13px;font-weight:600">✅ No issues found</div>`;
    return;
  }

  const section = (title, items, hint) => !items.length ? '' : `
    <div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:4px">${title} (${items.length})</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:6px">${hint}</div>
      <ul style="margin:0;padding-left:18px;font-family:var(--mono);font-size:11px;color:var(--text2)">
        ${items.slice(0,20).map(i=>`<li>${i}</li>`).join('')}
        ${items.length>20?`<li style="color:var(--text3)">…and ${items.length-20} more</li>`:''}
      </ul>
    </div>`;

  out.innerHTML =
    `<div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:10px">⚠ ${total} issue${total===1?'':'s'} found</div>` +
    section('Duplicate trades', issues.dup, 'Same date, symbol, type, units, and price appears more than once — check the Trades tab.') +
    section('Negative-unit holdings', issues.negUnits, 'Sold more units than were ever bought — usually a missing buy or a bad import.') +
    section('Orphaned dividends', issues.orphanDiv, 'Dividend recorded for a symbol with zero trades — check for a typo.') +
    section('Missing prices', issues.missingPrice, 'Currently held with no stored price — won\'t be marked to market anywhere in the app.');
}
