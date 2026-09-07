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

function nwPropertyEquity(){
  if(typeof properties === 'undefined' || typeof propMetrics !== 'function') return 0;
  return properties.filter(p => !p.sold).reduce((s,p) => s + propMetrics(p).equity, 0);
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
  if(typeof spendingData === 'undefined' || !spendingData.length) return null;
  const fys = [...new Set(spendingData.map(d=>d.fy))].sort((a,b)=>b-a);
  const fy = fys[0];
  if(fy == null) return null;
  const SP_MONEY_IN = new Set(['__REFUND__','__OTHER_INCOME__']);
  const SP_EXCLUDE = new Set(['__TRANSFERS__']);
  const total = spendingData.filter(d => d.fy===fy && d.amount<0 && !SP_MONEY_IN.has(d.category) && !SP_EXCLUDE.has(d.category))
    .reduce((s,d) => s + (-d.amount), 0);
  return total > 0 ? total : null;
}

function nwFireInputs(){
  const g = parseFloat(localStorage.getItem('pt_fire_growth_pct'));
  const c = parseFloat(localStorage.getItem('pt_fire_monthly_contrib'));
  const s = parseFloat(localStorage.getItem('pt_fire_annual_spend'));
  return {
    growthPct: isFinite(g) ? g : 7,
    monthlyContrib: isFinite(c) ? c : 0,
    annualSpend: isFinite(s) ? s : (nwLatestAnnualSpend() || 60000),
  };
}
function nwSaveFireInputs(){
  const g = parseFloat($('nw-fire-growth').value);
  const c = parseFloat($('nw-fire-contrib').value);
  const s = parseFloat($('nw-fire-spend').value);
  if(isFinite(g)) localStorage.setItem('pt_fire_growth_pct', g);
  if(isFinite(c)) localStorage.setItem('pt_fire_monthly_contrib', c);
  if(isFinite(s)) localStorage.setItem('pt_fire_annual_spend', s);
  renderNetWorth();
}

let _nwFireChart = null;
function renderNetWorth(){
  const panel = document.getElementById('panel-networth');
  if(!panel) return;

  const portfolioVal = nwPortfolioValue();
  const propertyEq = nwPropertyEquity();
  const superBal = nwSuperBalance();
  const netWorth = portfolioVal + propertyEq + superBal;
  const {growthPct, monthlyContrib, annualSpend} = nwFireInputs();
  const fireNumber = annualSpend * 25; // 4% rule

  // Composition bar — simple flex segments, no chart library needed.
  const segs = [
    {label:'Portfolio', val:portfolioVal, color:'var(--violet)'},
    {label:'Property equity', val:propertyEq, color:'var(--cyan)'},
    {label:'Super', val:superBal, color:'var(--amber)'},
  ].filter(s => s.val > 0);
  const barHtml = netWorth > 0 ? `
    <div style="display:flex;height:14px;border-radius:7px;overflow:hidden;margin:10px 0 8px">
      ${segs.map(s=>`<div style="width:${(s.val/netWorth*100).toFixed(2)}%;background:${s.color}"></div>`).join('')}
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--text2)">
      ${segs.map(s=>`<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.color};margin-right:5px"></span>${s.label} · ${n2(s.val)} (${(s.val/netWorth*100).toFixed(1)}%)</span>`).join('')}
    </div>` : `<div style="color:var(--text3);font-size:12px">No portfolio, property, or super data yet.</div>`;

  // ── FIRE projection ──────────────────────────────────────────────
  // Starting balance is liquid capital only (Portfolio + Super) —
  // property equity is deliberately excluded, since it can't be drawn
  // down like an investment balance. Its real effect on FIRE timing
  // comes through as cash flow instead: positive (rent covers costs)
  // speeds things up, negative (negatively geared) slows them down.
  const liquidStart = portfolioVal + superBal;
  const propertyCF = nwPropertyCashFlow();
  const effectiveAnnualContrib = monthlyContrib*12 + propertyCF;

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

  panel.innerHTML = `
    <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
      <div class="card"><div class="card-label">Net Worth</div><div class="card-value neu">${n2(netWorth)}</div><div class="card-sub">Portfolio + Property + Super</div></div>
      <div class="card"><div class="card-label">Portfolio</div><div class="card-value neu">${n2(portfolioVal)}</div><div class="card-sub">Market value</div></div>
      <div class="card"><div class="card-label">Property Equity</div><div class="card-value neu">${n2(propertyEq)}</div><div class="card-sub">Value − debt</div></div>
      <div class="card"><div class="card-label">Super</div><div class="card-value neu">${n2(superBal)}</div><div class="card-sub">All accounts</div></div>
    </div>

    <div class="tw" style="margin-bottom:18px">
      <div class="th"><span class="tt">Composition</span></div>
      <div style="padding:16px 20px">${barHtml}</div>
    </div>

    <div class="tw">
      <div class="th"><span class="tt">🔥 FIRE Projection</span><span style="font-size:10px;color:var(--text3)">4% rule · estimates only</span></div>
      <div style="padding:16px 20px">
        <div class="fg" style="margin-bottom:14px">
          <div class="fgi"><span class="fl">Annual spend (FIRE basis)</span><input class="fi" id="nw-fire-spend" type="number" step="1000" value="${annualSpend}" onchange="nwSaveFireInputs()"></div>
          <div class="fgi"><span class="fl">Assumed annual growth %</span><input class="fi" id="nw-fire-growth" type="number" step="0.5" value="${growthPct}" onchange="nwSaveFireInputs()"></div>
          <div class="fgi"><span class="fl">Monthly contribution</span><input class="fi" id="nw-fire-contrib" type="number" step="100" value="${monthlyContrib}" onchange="nwSaveFireInputs()"></div>
        </div>
        <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:14px">
          <div class="card"><div class="card-label">FIRE Number</div><div class="card-value neu">${n2(fireNumber)}</div><div class="card-sub">25× annual spend</div></div>
          <div class="card"><div class="card-label">Time to FIRE</div><div class="card-value ${reached?'pos':'neu'}">${fireLabel}</div><div class="card-sub">Liquid balance + contributions</div></div>
          <div class="card"><div class="card-label">Liquid Starting Balance</div><div class="card-value neu">${n2(liquidStart)}</div><div class="card-sub">Portfolio + Super only</div></div>
          <div class="card"><div class="card-label">Net Rental Income</div><div class="card-value ${propertyCF>=0?'pos':'neg'}">${propertyCF>=0?'+':''}${n2(propertyCF)}/yr</div><div class="card-sub">Sum of each rental's Net Annual Income</div></div>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:14px">Property equity (${n2(propertyEq)}) isn't counted in the liquid balance above — it can't be drawn down like an investment. Instead, its Net Rental Income (same figure shown per-property in the Property tab — rent minus expenses minus interest, excluding your own home) ${propertyCF>=0?'is currently boosting':'is currently reducing'} your yearly contribution by ${n2(Math.abs(propertyCF))}.</div>
        <div style="height:220px"><canvas id="nw-fire-chart"></canvas></div>
        <div style="font-size:11px;color:var(--text3);margin-top:8px">Rough compound-growth estimate only — ignores tax, fees, sequence-of-returns risk, and inflation on the spend figure. Not financial advice.</div>
      </div>
    </div>
  `;

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