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
  // spendingData lazy-loads only when the Spending tab has been opened this
  // session (see initSpending() in spending.js) — landing on Net Worth first
  // would otherwise silently skip real spending history in favour of the
  // 60,000 fallback below, even though it's sitting in storage.
  if(typeof spendingData === 'undefined') return null;
  if(!spendingData.length && typeof loadSpending === 'function') loadSpending();
  if(!spendingData.length) return null;
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
function renderNetWorth(){
  const panel = document.getElementById('panel-networth');
  if(!panel) return;

  const portfolioVal = nwPortfolioValue();
  const propertyEq = nwPropertyEquity();
  const superBal = nwSuperBalance();
  const netWorth = portfolioVal + propertyEq + superBal;
  const {growthPct, monthlyContrib, annualSpend, currentAge, fiAge, reAge} = nwFireInputs();
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
        <div style="font-size:11px;color:var(--text3);margin-bottom:14px">Property equity (${n2(propertyEq)}) isn't counted in the liquid balance above — it can't be drawn down like an investment. Instead, its Net Rental Income (same figure shown per-property in the Property tab — rent minus expenses minus interest, excluding your own home) ${propertyCF>=0?'is currently boosting':'is currently reducing'} your yearly contribution by ${n2(Math.abs(propertyCF))}.</div>
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