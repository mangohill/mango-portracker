// ── analytics.js ─────────────────────────────────────────────

function exportXLSX(){
  try {
    const wb   = XLSX.utils.book_new();
    const date = new Date().toISOString().slice(0,10);
    const fmt2 = n => (n==null||n==='') ? '' : +Number(n).toFixed(2);
    const fmt4 = n => (n==null||n==='') ? '' : +Number(n).toFixed(4);

    const colW = ws => { ws['!cols'] = (ws['!ref']
      ? XLSX.utils.sheet_to_json(ws,{header:1})[0].map(()=>({wch:18}))
      : []); };
    const hdrStyle = {font:{bold:true}};

    function makeSheet(headers, rows){
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = headers.map(h => ({wch: Math.max(h.length+2, 14)}));
      return ws;
    }

    // ── TRADES (all, chronological) ──────────────────────────────────
    const tradeSorted = [...trades].sort((a,b)=>a.date.localeCompare(b.date));
    const TRADE_HDR = ['Date','Side','Symbol','Asset Type','Units','Price (AUD)','Gross (AUD)','Fees (AUD)','Net (AUD)','Source','Notes','Subtype','CA Label','From Symbol'];
    const tradeRows = tradeSorted.map(t => {
      const g   = +t.units * +t.price;
      const net = (t.type==='buy'||t.type==='drp') ? g+(+t.fees||0) : g-(+t.fees||0);
      return [t.date, t.type.toUpperCase(), csvSafe(t.symbol), t.assetType,
              fmt4(t.units), fmt4(t.price), fmt2(g), fmt2(t.fees||0), fmt2(net),
              t.source||'', csvSafe(t.notes||''),
              t.subtype||'', t.caLabel||'', csvSafe(t.fromSymbol||'')];
    });
    const wsAll = makeSheet(TRADE_HDR, tradeRows);
    wsAll['!cols'] = [12,8,12,14,14,14,14,12,14,12,24,16,18,14].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, wsAll, 'All Trades');

    // ── TRADES BY ASSET TYPE ──────────────────────────────────────────
    const assetTypes = [...new Set(tradeSorted.filter(t=>t.type!=='corporate_action').map(t=>t.assetType))];
    for(const at of assetTypes){
      const rows = tradeSorted.filter(t=>t.assetType===at && t.type!=='corporate_action').map(t=>{
        const g = +t.units * +t.price;
        const net = (t.type==='buy'||t.type==='drp') ? g+(+t.fees||0) : g-(+t.fees||0);
        return [t.date, t.type.toUpperCase(), csvSafe(t.symbol),
                fmt4(t.units), fmt4(t.price), fmt2(g), fmt2(t.fees||0), fmt2(net),
                t.source||'', csvSafe(t.notes||'')];
      });
      if(!rows.length) continue;
      const HDR = ['Date','Side','Symbol','Units','Price (AUD)','Gross (AUD)','Fees (AUD)','Net (AUD)','Source','Notes'];
      const ws = makeSheet(HDR, rows);
      ws['!cols'] = [12,8,12,14,14,14,12,14,12,24].map(w=>({wch:w}));
      const label = {stock:'Shares',etf:'ETFs',lic:'LICs',reit:'REITs',crypto:'Crypto',
                     bond:'Bonds',managed:'Managed Funds',super:'Super',commodity:'Commodity'}[at] || at;
      XLSX.utils.book_append_sheet(wb, ws, label.slice(0,31));
    }

    // ── CORPORATE ACTIONS ─────────────────────────────────────────────
    const caRows = tradeSorted.filter(t=>t.type==='corporate_action');
    if(caRows.length){
      const CA_HDR = ['Date','Symbol','Subtype','CA Label','From Symbol','Units','Price','Notes'];
      const ws = makeSheet(CA_HDR, caRows.map(t=>[
        t.date, csvSafe(t.symbol), t.subtype||'', t.caLabel||'', csvSafe(t.fromSymbol||''),
        fmt4(t.units), fmt4(t.price||0), csvSafe(t.notes||'')
      ]));
      ws['!cols'] = [12,12,16,20,14,14,14,30].map(w=>({wch:w}));
      XLSX.utils.book_append_sheet(wb, ws, 'Corporate Actions');
    }

    // ── HOLDINGS SNAPSHOT ─────────────────────────────────────────────
    const holdings = calcH();
    let totalCost=0, totalMV=0;
    holdings.forEach(h=>{
      totalCost += h.costBasis;
      const p = prices[priceSymbol(h.symbol)];
      if(p) totalMV += p * h.units;
    });
    const HDR_H = ['Symbol','Asset Type','Units','Avg Cost','Cost Basis','Current Price','Mkt Value','P&L ($)','P&L (%)','Alloc %','Source'];
    const holdRows = holdings
      .slice().sort((a,b)=>a.symbol.localeCompare(b.symbol))
      .map(h=>{
        const avg = h.units>0 ? h.costBasis/h.units : 0;
        const cur = prices[priceSymbol(h.symbol)] ?? '';
        const mv  = cur!=='' ? +(cur*h.units).toFixed(2) : '';
        const pl  = mv!=='' ? +(mv-h.costBasis).toFixed(2) : '';
        const pp  = mv!=='' && h.costBasis>0 ? +((mv-h.costBasis)/h.costBasis*100).toFixed(2) : '';
        const al  = totalMV>0 && mv!=='' ? +((mv/totalMV)*100).toFixed(2) : '';
        return [h.symbol, h.assetType, fmt4(h.units), fmt4(avg),
                fmt2(h.costBasis), cur||'', mv||'', pl||'',
                pp!==''?pp+'%':'', al!==''?al+'%':'', h.source||''];
      });
    // Add totals row
    holdRows.push(['','','','','TOTAL','',totalMV?fmt2(totalMV):'',
                   totalMV?fmt2(totalMV-totalCost):'',
                   totalMV&&totalCost?+((totalMV-totalCost)/totalCost*100).toFixed(2)+'%':'',
                   '','']);
    const wsH = makeSheet(HDR_H, holdRows);
    wsH['!cols'] = [12,14,14,14,14,14,14,12,10,10,14].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, wsH, 'Holdings');

    // ── DIVIDENDS (chronological) ──────────────────────────────────────
    if(dividends.length){
      const divSorted = [...dividends].sort((a,b)=>a.date.localeCompare(b.date));
      const DIV_HDR = ['Date','FY','Symbol','Type','Amount (AUD)','Notes'];
      const divRows = divSorted.map(d=>[
        d.date,
        dateToFY ? 'FY'+dateToFY(d.date) : '',
        csvSafe(d.symbol), d.type, fmt2(d.amount), csvSafe(d.notes||'')
      ]);
      // Summary by symbol
      const bySymbol = {};
      dividends.forEach(d=>{ bySymbol[d.symbol]=(bySymbol[d.symbol]||0)+(+d.amount); });
      const total = dividends.reduce((s,d)=>s+(+d.amount),0);
      divRows.push([],[' — SUMMARY BY SYMBOL —','','','','']);
      divRows.push(['Symbol','','','','Total (AUD)','']);
      Object.entries(bySymbol).sort((a,b)=>b[1]-a[1]).forEach(([sym,amt])=>{
        divRows.push([csvSafe(sym),'','','',fmt2(amt),'']);
      });
      divRows.push(['TOTAL','','','',fmt2(total),'']);
      const wsDiv = makeSheet(DIV_HDR, divRows);
      wsDiv['!cols'] = [12,8,12,16,16,30].map(w=>({wch:w}));
      XLSX.utils.book_append_sheet(wb, wsDiv, 'Dividends');
    }

    // ── PROPERTIES ────────────────────────────────────────────────────
    if(properties.length){
      const PROP_HDR = ['Name','Type','Purchase Date','Purchase Price','Purchase Costs',
                        'Current Value','Total Initial Loan','Total Loan Balance','Wtd Avg Rate %',
                        'Splits (JSON)',
                        'Weekly Rent','Annual Expenses','Manager','Notes'];
      const propRows = properties.map(p=>{
        const spl = normaliseSplits(p);
        const totBal  = spl.reduce((s,sp)=>s+(+sp.balance||0),0);
        const totInit = spl.reduce((s,sp)=>s+(+sp.initial||0),0);
        const wRate   = totBal>0 ? spl.reduce((s,sp)=>s+((+sp.balance||0)/totBal)*(+sp.rate||0),0) : 0;
        return [
          csvSafe(p.name), p.propType||'', p.purchaseDate||'',
          +p.purchasePrice, +(p.purchaseCosts||0), +p.currentValue,
          +totInit.toFixed(2), +totBal.toFixed(2), +wRate.toFixed(4),
          JSON.stringify(spl),
          +(p.weeklyRent||0), +(p.annualExpenses||0),
          p.hasManager||'no', csvSafe(p.notes||'')
        ];
      });
      const wsProp = makeSheet(PROP_HDR, propRows);
      wsProp['!cols'] = [24,12,14,16,16,14,16,16,12,50,12,16,8,30].map(w=>({wch:w}));
      XLSX.utils.book_append_sheet(wb, wsProp, 'Properties');
    }

    // ── SPENDING ──────────────────────────────────────────────────────
    if(spendingData.length){
      const SP_HDR = ['Date','FY','Amount (AUD)','Direction','Category','Merchant','Details'];
      const spRows = [...spendingData]
        .sort((a,b)=>a.date.localeCompare(b.date))
        .map(s=>[
          s.date, 'FY'+s.fy, s.amount,
          s.amount<0?'Debit':'Credit',
          s.category.startsWith('__')?
            ({'__TRANSFERS__':'Internal Transfer','__REFUND__':'Refund','__OTHER_INCOME__':'Other Income'}[s.category]||s.category)
            :s.category,
          csvSafe(s.merchant), csvSafe(s.details)
        ]);
      const wsSp = makeSheet(SP_HDR, spRows);
      wsSp['!cols'] = [12,8,14,10,28,24,40].map(w=>({wch:w}));
      XLSX.utils.book_append_sheet(wb, wsSp, 'Spending');
    }

    // ── SETTINGS ──────────────────────────────────────────────────────
    // ── SUPER ───────────────────────────────────────────────────────
    const SU_HDR = ['Name','Current Balance','Colour','FY Data (JSON)','Contributions (JSON)'];
    const suXlsRows = superAccounts.map(a=>[
      a.name||'', +a.balance||0, a.color||'',
      JSON.stringify(a.fyData||{}), JSON.stringify(a.contrib||{})
    ]);
    const wsSu = makeSheet(SU_HDR, suXlsRows);
    wsSu['!cols'] = [30,16,10,60].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, wsSu, 'Super');

    const wsSet = XLSX.utils.aoa_to_sheet([
      ['key','value'],
      ['cf_worker_url',  localStorage.getItem('cf_worker_url')||''],
      ['cf_worker_code', WORKER_CODE],
      ['export_date',    date],
      ['app_version',    'Portfolio Tracker v3'],
    ]);
    wsSet['!cols'] = [{wch:20},{wch:100}];
    XLSX.utils.book_append_sheet(wb, wsSet, 'Settings');

    XLSX.writeFile(wb, `portfolio_export_${date}.xlsx`);
    notify('✓ Exported ' + wb.SheetNames.length + ' sheets', 'ok');
  } catch(err){
    notify('Export failed: ' + err.message, 'err');
    console.error(err);
  }
}

function clearAll(){
  if(!confirm('Delete ALL data? This clears trades, dividends, properties, super, tax records, prices and spending. Cannot be undone.')) return;
  trades=[]; prices={}; dividends=[]; properties=[];
  superAccounts=[]; taxData={}; stockOwners={}; spendingData=[]; extraPersons=[];
  const keys = ['pt_trades','pt_prices','pt_divs','pt_props','pt_super','pt_tax',
                 'pt_stock_owners','pt_spending','pt_extra_persons','pt_drp_carry','pt_drp_settings','pt_drp_skipped','pt_expdiv_skipped'];
  keys.forEach(k => localStorage.removeItem(k));
  renderH(); renderT(); renderR(); renderHD();
  renderFYBar(); renderDividends(); renderDivCharts(); renderDivCards();
  renderProperties();
  try { renderSuperAccounts(); renderSuperCards(); renderSuperChart(); } catch(e){}
  try { renderTax(); } catch(e){}
  try { renderSpending(); } catch(e){}
  try { renderOwnershipGrid(); } catch(e){}
  notify('All data cleared.','ok');
}


// ── CHART INSTANCES (destroy before recreate) ─────────────────────────
const charts = {};
function mkChart(id, cfg){
  if(charts[id]) charts[id].destroy();
  const ctx = $(id);
  if(!ctx) return;
  charts[id] = new Chart(ctx, cfg);
  return charts[id];
}

// ── CHART DEFAULTS ────────────────────────────────────────────────────
Chart.defaults.color = '#87a598';
Chart.defaults.borderColor = '#1c2b23';
if(typeof Chart !== 'undefined' && Chart.defaults && Chart.defaults.font){
  Chart.defaults.font.family = "'IBM Plex Mono','Menlo','Consolas','Courier New',monospace";
  Chart.defaults.font.size = 11;
}

const PALETTE = ['#38c6ff','#29ffa0','#ffb000','#ff4d4d','#b98bff','#00e5c7','#ff8a5c','#ffe066','#5ee6b0','#4d8fd6'];

// ── DATE HELPERS ──────────────────────────────────────────────────────
function filterByPeriod(arr, period){
  const now = new Date();
  // Australian FY: 1 Jul - 30 Jun
  const fyYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear()-1;
  const cfyStart = new Date(fyYear, 6, 1);        // 1 Jul current FY
  const cfyEnd   = new Date(fyYear+1, 5, 30);     // 30 Jun current FY
  const pfyStart = new Date(fyYear-1, 6, 1);      // 1 Jul prev FY
  const pfyEnd   = new Date(fyYear, 5, 30);       // 30 Jun prev FY
  const fromVal  = $('an-from') ? $('an-from').value : '';
  const toVal    = $('an-to')   ? $('an-to').value   : '';
  return arr.filter(t => {
    const d = new Date(t.date);
    if(period==='ytd')    return d.getFullYear()===now.getFullYear();
    if(period==='1y')     return d >= new Date(now.getFullYear()-1, now.getMonth(), now.getDate());
    if(period==='6m')     return d >= new Date(now.getFullYear(), now.getMonth()-6, now.getDate());
    if(period==='3m')     return d >= new Date(now.getFullYear(), now.getMonth()-3, now.getDate());
    if(period==='cfy')    return d >= cfyStart && d <= cfyEnd;
    if(period==='pfy')    return d >= pfyStart && d <= pfyEnd;
    if(period==='custom') return (!fromVal || t.date >= fromVal) && (!toVal || t.date <= toVal);
    return true;
  });
}

// Same period definitions as filterByPeriod, but returns the actual date
// boundaries (not a filtered array) — used to build a CONTINUOUS month axis
// for the cost/value/P&L charts, spanning the whole selected period rather
// than only months that happened to contain a trade.
function periodBounds(period){
  const now = new Date();
  const fyYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear()-1;
  const cfyStart = new Date(fyYear, 6, 1);
  const pfyStart = new Date(fyYear-1, 6, 1);
  const pfyEnd   = new Date(fyYear, 5, 30);
  const fromVal  = $('an-from') ? $('an-from').value : '';
  const toVal    = $('an-to')   ? $('an-to').value   : '';
  let from = null, to = now;
  if(period==='ytd')    from = new Date(now.getFullYear(), 0, 1);
  else if(period==='1y')  from = new Date(now.getFullYear()-1, now.getMonth(), now.getDate());
  else if(period==='6m')  from = new Date(now.getFullYear(), now.getMonth()-6, now.getDate());
  else if(period==='3m')  from = new Date(now.getFullYear(), now.getMonth()-3, now.getDate());
  else if(period==='cfy') from = cfyStart;
  else if(period==='pfy'){ from = pfyStart; to = pfyEnd; }
  else if(period==='custom'){ from = fromVal ? new Date(fromVal) : null; to = toVal ? new Date(toVal) : now; }
  // 'all' → from stays null (caller falls back to earliest trade date)
  return { from: from ? localDateStr(from) : null, to: localDateStr(to) };
}

// ── ANALYTICS ─────────────────────────────────────────────────────────

// Looks up sym's actual price on/before dateStr using the same pfSnapshots
// history the Portfolio Change TWR/MWR calcs use — so "Portfolio Value" and
// "Cumulative P&L" over time reflect what the position was REALLY worth on
// each date, not today's price projected backwards. Falls back to today's
// live price (old behaviour), then cost, only when no historical point
// exists yet for that date (e.g. before the worker's backfill history starts).
let _anPriceDatesCache = null;
function historicalPriceOnOrBefore(sym, dateStr){
  if(typeof pfSnapshots === 'undefined') return null;
  if(!_anPriceDatesCache) _anPriceDatesCache = Object.keys(pfSnapshots).sort().reverse();
  for(const d of _anPriceDatesCache){
    if(d > dateStr) continue;
    const p = pfSnapshots[d] && pfSnapshots[d].prices && pfSnapshots[d].prices[sym];
    if(p!=null) return p;
  }
  return null;
}
function monthEndOrToday(monthStr){
  const [y,m] = monthStr.split('-').map(Number);
  const end = localDateStr(new Date(y, m, 0)); // day 0 of next month = last day of this month
  const today = localDateStr();
  return end < today ? end : today;
}

function renderAnalytics(){
  invalidatePriceCaches(); // pfSnapshots may have changed since last render — savePfSnapshots() already invalidates this on every actual mutation; this is a harmless redundant safety net
  const period  = $('an-period').value;
  const groupBy = $('an-group').value;
  const chartType = $('an-chart').value;

  // Show/hide custom range inputs
  const customDiv = $('an-custom-range');
  if(customDiv) customDiv.style.display = period==='custom' ? 'flex' : 'none';

  // Period label for card subtitles
  const now = new Date();
  const fyYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear()-1;
  const periodLabels = {
    'all':'All time', '1y':'Last 12 months',
    'cfy':`FY${fyYear}/${String(fyYear+1).slice(2)}`,
    'pfy':`FY${fyYear-1}/${String(fyYear).slice(2)}`,
    'ytd':'Year to date', '6m':'Last 6 months', '3m':'Last 3 months',
    'custom': ($('an-from')?.value||'') + ' – ' + ($('an-to')?.value||''),
  };
  const pLabel = periodLabels[period] || period;

  const filtered = filterByPeriod(trades, period).sort((a,b)=>a.date.localeCompare(b.date));
  const holdings = calcH();

  // --- Summary cards ---
  const totalCost = holdings.reduce((s,h)=>s+h.costBasis,0);
  const totalVal  = holdings.reduce((s,h)=>s+(prices[priceSymbol(h.symbol)]?prices[priceSymbol(h.symbol)]*h.units:0),0);
  const totalPnl  = totalVal - totalCost;
  const pnlPct    = totalCost>0?(totalPnl/totalCost)*100:0;
  const totalDiv  = dividends.reduce((s,d)=>s+(+d.amount||0),0);
  const totalFees = trades.reduce((s,t)=>s+(+t.fees||0),0);
  const totalBuys = trades.filter(t=>t.type==='buy').reduce((s,t)=>s+(+t.units * +t.price),0);
  const totalSells= trades.filter(t=>t.type==='sell').reduce((s,t)=>s+(+t.units * +t.price),0);

  // Filter dividends and sells by period too
  const filtDivs  = filterByPeriod(dividends, period);
  const filtTrades = filterByPeriod(trades, period);
  const filtDiv   = filtDivs.reduce((s,d)=>s+(+d.amount||0),0);
  const filtFees  = filtTrades.reduce((s,t)=>s+(+t.fees||0),0);
  const filtSells = filtTrades.filter(t=>t.type==='sell').reduce((s,t)=>s+(+t.units * +t.price),0);
  const filtBuys  = filtTrades.filter(t=>t.type==='buy').reduce((s,t)=>s+(+t.units * +t.price),0);

  $('an-cards').innerHTML = [
    {l:'Total Return',    v:n2(totalPnl+filtDiv),  s:(totalPnl+filtDiv>=0?'pos':'neg'), sub:`P&L + Divs · ${pLabel}`},
    {l:'Unrealised P&L',  v:n2(totalPnl),          s:clr(totalPnl),                    sub:nP(pnlPct)+' · all time'},
    {l:'Dividend Income', v:n2(filtDiv),            s:'pos',
      sub:`Cash · ${filtDivs.length} payments · ${pLabel} · Grossed-up: ${n2(grossUpTotal(filtDivs))}`},

    {l:'Total Invested',  v:n2(totalCost),          s:'neu',                            sub:'Cost basis · all time'},
    {l:'Total Fees Paid', v:n2(filtFees),           s:'neg',                            sub:`Brokerage · ${pLabel}`},
    {l:'Realised (Sells)',v:n2(filtSells),          s:'neu',                            sub:`Gross sells · ${pLabel}`},
  ].map(c=>`<div class="card"><div class="card-label">${c.l}</div><div class="card-value ${c.s}">${c.v}</div><div class="card-sub">${c.sub}</div></div>`).join('');

  // --- Main chart ---
  renderMainChart(filtered, groupBy, chartType, holdings, period);

  // --- Allocation pie ---
  renderAllocChart(holdings);

  // --- Annual bar ---
  renderAnnualChart();

  // --- Best/worst ---
  renderPerformers(holdings);
}

function toggleAnGroup(g){
  if(anHiddenGroups.has(g)) anHiddenGroups.delete(g);
  else anHiddenGroups.add(g);
  renderAnalytics();
}

function renderMainChart(filtered, groupBy, chartType, holdings, period){
  // Only bail out entirely when there's no trade history at all — a narrow
  // period (e.g. "Last 3 months") with zero trades IN it can still have
  // real, price-driven value to show for positions bought earlier.
  if(!trades.length){ mkChart('an-main-chart',{type:'line',data:{labels:[],datasets:[]}}); return; }

  const titles = {cost:'COST BASIS OVER TIME', value:'PORTFOLIO VALUE OVER TIME (ACTUAL HISTORICAL PRICES)', pnl:'CUMULATIVE P&L (INCL. DIVIDENDS)', trades:'TRADE ACTIVITY (GROSS AUD)', alloc:'CURRENT ALLOCATION'};
  $('an-chart-title').textContent = titles[chartType]||'';

  if(chartType==='alloc'){
    const pillsEl = $('an-legend-pills');
    if(pillsEl) pillsEl.style.display = 'none'; // no group-toggle concept for a point-in-time pie
    // Pie for current allocation
    const h = holdings.filter(x=>prices[priceSymbol(x.symbol)]);
    const labels = h.map(x=>x.symbol);
    const data   = h.map(x=>+(prices[priceSymbol(x.symbol)]*x.units).toFixed(2));
    mkChart('an-main-chart',{
      type:'doughnut',
      data:{ labels, datasets:[{data, backgroundColor:PALETTE, borderColor:'#0e1512', borderWidth:2}] },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ position:'right', labels:{color:'#8899aa',font:{size:11}} } } }
    });
    return;
  }

  if(chartType==='trades'){
    const pillsEl = $('an-legend-pills');
    if(pillsEl) pillsEl.style.display = 'none'; // buy/sell bars aren't grouped by symbol/type
    // Bar chart: monthly buy vs sell volume
    const monthly = {};
    filtered.forEach(t=>{
      const key = t.date.slice(0,7);
      if(!monthly[key]) monthly[key]={buy:0,sell:0};
      monthly[key][t.type] += +t.units * +t.price;
    });
    const labels = Object.keys(monthly).sort();
    mkChart('an-main-chart',{
      type:'bar',
      data:{ labels, datasets:[
        {label:'Buy',  data:labels.map(k=>+monthly[k].buy.toFixed(2)),  backgroundColor:'rgba(41,255,160,0.6)', borderColor:'#29ffa0', borderWidth:1},
        {label:'Sell', data:labels.map(k=>+monthly[k].sell.toFixed(2)), backgroundColor:'rgba(255,77,77,0.6)',  borderColor:'#ff4d4d', borderWidth:1},
      ]},
      options:{ responsive:true, maintainAspectRatio:false, scales:{
        x:{ticks:{color:'#4a5568'}},
        y:{ticks:{color:'#4a5568', callback:v=>'$'+v.toLocaleString()}}
      }, plugins:{legend:{labels:{color:'#8899aa'}}} }
    });
    return;
  }

  // Line charts: cost/value/pnl over time
  // Groups shown = currently held + anything traded in the selected period,
  // so a position bought before the period (and untouched during it) still
  // appears instead of silently vanishing from the chart and legend.
  const heldSet   = groupBy==='bytype' ? new Set(holdings.map(h=>h.assetType))
                   : groupBy==='bysymbol'? new Set(holdings.map(h=>h.symbol)) : null;
  const tradedSet = groupBy==='bytype' ? new Set(filtered.map(t=>t.assetType))
                   : groupBy==='bysymbol'? new Set(filtered.map(t=>t.symbol)) : null;
  const groups = groupBy==='combined' ? ['All']
    : [...new Set([...(heldSet||[]), ...(tradedSet||[])])];

  // Month buckets span the FULL selected period continuously, not just
  // months that happened to contain a trade — otherwise a held-but-untraded
  // position shows as a single flat point instead of its real trajectory.
  const { from: periodFrom, to: periodTo } = periodBounds(period);
  const earliestTradeDate = trades.length ? trades.map(t=>t.date).sort()[0] : null;
  const axisFromRaw = periodFrom && earliestTradeDate ? (periodFrom > earliestTradeDate ? periodFrom : earliestTradeDate)
                     : (periodFrom || earliestTradeDate);
  let allDates = [];
  if(axisFromRaw){
    let cur = new Date(+axisFromRaw.slice(0,4), +axisFromRaw.slice(5,7)-1, 1);
    const end = new Date(+periodTo.slice(0,4), +periodTo.slice(5,7)-1, 1);
    while(cur <= end){
      allDates.push(`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`);
      cur.setMonth(cur.getMonth()+1);
    }
  }
  if(!allDates.length){ mkChart('an-main-chart',{type:'line',data:{labels:[],datasets:[]}}); return; }

  const datasets = groups.map((g,i)=>{
    // Always compute from the FULL trade history (not the period-filtered
    // list) so cost/value/P&L carried INTO the period reflects the real
    // accumulated position, rather than incorrectly resetting to zero at
    // the start of whatever period is selected.
    const groupTrades = groupBy==='combined' ? trades :
                        groupBy==='bytype'   ? trades.filter(t=>t.assetType===g) :
                                               trades.filter(t=>t.symbol===g);

    const data = allDates.map(month=>{
      const monthTrades = groupTrades.filter(t=>t.date.slice(0,7)<=month);
      // Calculate cost basis up to this month
      const costMap = {};
      for(const t of monthTrades){
        const s=t.symbol;
        if(!costMap[s]) costMap[s]={units:0,cost:0};
        if(t.type==='buy'||t.type==='drp'){
          costMap[s].units+=+t.units; costMap[s].cost+=(+t.units * +t.price)+(+t.fees||0);
        } else if(t.type==='corporate_action'){
          const sub = t.subtype||'';
          if(sub==='merger_from'||sub==='rename_from'||sub==='split_from'||sub==='spinoff_from'){
            // Stash cost, zero out from-symbol
            costMap[s]._caStash = costMap[s].cost;
            costMap[s].units    = 0;
            costMap[s].cost     = 0;
          } else if(sub==='merger_to'||sub==='rename_to'||sub==='spinoff_to'){
            // Transfer cost from from-symbol
            const fromSym = t.fromSymbol||'';
            const fromEntry = fromSym && costMap[fromSym];
            const allocPct = t.allocPct!=null ? +t.allocPct/100 : 1;
            const transferCost = fromEntry ? (fromEntry._caStash||fromEntry.cost||0)*allocPct : 0;
            if(fromEntry && sub==='spinoff_to') fromEntry.cost = (fromEntry._caStash||0)*(1-allocPct);
            if(!costMap[s]) costMap[s]={units:0,cost:0};
            costMap[s].units += +t.units;
            costMap[s].cost  += t.overrideCostBasis ? +t.overrideCostBasis : transferCost;
          } else if(sub==='split_to'){
            // Split: same symbol, just update units
            costMap[s].units = +t.units; // to-side has the new unit count
          }
        } else if(t.type==='sell'){
          const r=costMap[s].units>0?+t.units/costMap[s].units:0;
          costMap[s].cost-=costMap[s].cost*r;
          costMap[s].units-=+t.units;
        }
      }
      const totalCost = Object.values(costMap).reduce((s,h)=>s+h.cost,0);
      if(chartType==='cost') return +totalCost.toFixed(2);

      // Real historical mark-to-market: the actual price on/before this
      // month's end date (from the worker's price history), not today's
      // live price projected backwards onto every past month. Falls back
      // to today's live price, then cost, only when no historical point
      // exists yet for that date.
      const lookupDate = monthEndOrToday(month);
      let val=0;
      for(const [sym,h] of Object.entries(costMap)){
        const psym = priceSymbol(sym);
        const hist = historicalPriceOnOrBefore(psym, lookupDate);
        const p = hist!=null ? hist : prices[psym];
        val += p!=null ? p*h.units : h.cost;
      }
      if(chartType==='value') return +val.toFixed(2);

      // Cumulative P&L includes dividend income received to date (cash
      // dividends only — DRP is excluded since it's already reflected
      // above via the extra reinvested units, not double-counted here).
      // A capital-only P&L understates real performance for income assets.
      const groupSyms = new Set(Object.keys(costMap));
      const divsToDate = dividends
        .filter(d => d.type!=='drp' && d.date<=lookupDate && groupSyms.has(d.symbol))
        .reduce((s,d)=>s+(+d.amount||0), 0);
      return +(val - totalCost + divsToDate).toFixed(2); // pnl (total return, incl. dividends)
    });

    return {
      label: g, data,
      borderColor: PALETTE[i%PALETTE.length],
      backgroundColor: PALETTE[i%PALETTE.length]+'22',
      borderWidth: 2, fill: groupBy==='combined', tension: 0.3,
      pointRadius: allDates.length>24?0:3,
    };
  });

  const yLabel = chartType==='pnl'?'P&L (AUD)':'AUD';
  // ── Build toggleable legend pills ──────────────────────────
  const pillsEl = $('an-legend-pills');
  if(pillsEl && groupBy !== 'combined'){
    pillsEl.style.display = 'flex';
    pillsEl.innerHTML = groups.map((g,i) => {
      const col   = PALETTE[i % PALETTE.length];
      const active = !anHiddenGroups.has(g);
      return `<button onclick="toggleAnGroup('${g.replace(/'/g,"\\'")}')"
        style="display:flex;align-items:center;gap:5px;padding:3px 10px;
               border-radius:20px;border:1px solid ${active?col:'#333'};
               background:${active?col+'22':'transparent'};
               color:${active?col:'var(--text3)'};
               font-size:11px;font-family:var(--mono);cursor:pointer;
               opacity:${active?'1':'0.45'};transition:all .15s">
        <span style="width:8px;height:8px;border-radius:50%;background:${active?col:'#555'};flex-shrink:0"></span>
        ${g}</button>`;
    }).join('');
  } else if(pillsEl){
    pillsEl.style.display = 'none';
  }

  // Filter datasets based on hidden groups
  const visibleDatasets = datasets.map((ds, i) => ({
    ...ds,
    hidden: anHiddenGroups.has(groups[i]),
  }));

  mkChart('an-main-chart',{
    type:'line',
    data:{ labels:allDates, datasets:visibleDatasets },
    options:{ responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      scales:{
        x:{ ticks:{color:'#4a5568', maxTicksLimit:12} },
        y:{ ticks:{color:'#4a5568', callback:v=>'$'+v.toLocaleString()}, grid:{color:'#1c2b23'} }
      },
      plugins:{ legend:{display:false},
        tooltip:{ callbacks:{ label:ctx=>' '+ctx.dataset.label+': $'+ctx.parsed.y.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}) } }
      }
    }
  });
}

function renderAllocChart(holdings){
  const byType = {};
  holdings.forEach(h=>{
    const val = prices[priceSymbol(h.symbol)] ? prices[priceSymbol(h.symbol)]*h.units : h.costBasis;
    byType[h.assetType] = (byType[h.assetType]||0)+val;
  });
  const labels = Object.keys(byType);
  const data   = labels.map(k=>+byType[k].toFixed(2));
  const colors = {crypto:'#ffb000', stock:'#38c6ff', etf:'#b47bff'};
  mkChart('an-alloc-chart',{
    type:'doughnut',
    data:{ labels, datasets:[{data, backgroundColor:labels.map(l=>colors[l]||PALETTE[0]), borderColor:'#0e1512', borderWidth:2}] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'bottom', labels:{color:'#8899aa',font:{size:11}}},
        tooltip:{ callbacks:{ label:ctx=>' '+ctx.label+': $'+ctx.parsed.toLocaleString('en-AU',{minimumFractionDigits:2}) } }
      }
    }
  });
}

function renderAnnualChart(){
  const years = [...new Set(trades.map(t=>t.date.slice(0,4)))].sort();
  if(!years.length) return;
  const invested = years.map(y=>{
    return +trades.filter(t=>t.date.slice(0,4)<=y&&t.type==='buy')
      .reduce((s,t)=>s+(+t.units * +t.price)+(+t.fees||0),0).toFixed(2);
  });
  const divByYear = years.map(y=>
    +dividends.filter(d=>d.date.slice(0,4)===y).reduce((s,d)=>s+(+d.amount||0),0).toFixed(2)
  );
  mkChart('an-annual-chart',{
    type:'bar',
    data:{ labels:years, datasets:[
      {label:'Cumulative Invested', data:invested, backgroundColor:'rgba(56,198,255,0.5)', borderColor:'#38c6ff', borderWidth:1, yAxisID:'y'},
      {label:'Dividends (year)',    data:divByYear, backgroundColor:'rgba(41,255,160,0.7)', borderColor:'#29ffa0', borderWidth:1, yAxisID:'y'},
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ticks:{color:'#4a5568'}},
        y:{ticks:{color:'#4a5568', callback:v=>'$'+v.toLocaleString()}, grid:{color:'#1c2b23'}}
      },
      plugins:{legend:{labels:{color:'#8899aa'}}}
    }
  });
}

function renderPerformers(holdings){
  // ── Build filter pills (all unique asset types in holdings) ────
  const types   = [...new Set(holdings.map(h=>h.assetType))].sort();
  const pillsEl = $('an-perf-filter');
  if(pillsEl){
    const AT_LABEL = {
      asx_stock:'Stock', etf:'ETF', lic:'LIC', reit:'REIT',
      crypto:'Crypto', bond:'Bond', managed:'Managed', commodity:'Commodity',
      super:'Super', all:'All',
    };
    const allTypes = ['all', ...types];
    pillsEl.innerHTML = allTypes.map(t => {
      const active = anPerfFilter === t;
      return `<button onclick="anPerfFilter='${t}';renderAnalytics()"
        style="padding:3px 12px;border-radius:20px;font-size:11px;
               font-family:var(--mono);cursor:pointer;
               border:1px solid ${active?'var(--blue)':'var(--border)'};
               background:${active?'rgba(59,130,246,0.15)':'transparent'};
               color:${active?'var(--blue)':'var(--text3)'};
               transition:all .15s">
        ${AT_LABEL[t]||t}</button>`;
    }).join('');
  }

  // ── Filter holdings by selected asset type ─────────────────────
  const filtered = anPerfFilter === 'all'
    ? holdings
    : holdings.filter(h => h.assetType === anPerfFilter);

  const withPnl = filtered.map(h=>{
    const cur = prices[priceSymbol(h.symbol)]??null;
    const mkt = cur!=null?cur*h.units:null;
    const pnl = mkt!=null?mkt-h.costBasis:null;
    const pct = pnl!=null&&h.costBasis>0?(pnl/h.costBasis)*100:null;
    return {...h, pnl, pct};
  }).filter(h=>h.pnl!=null);

  const mkTh  = (tid, col, label) => sortTh(tid, col, label, 'renderAnalytics');
  const mkRow = h => `<tr>
    <td><b>${displaySymbol(h.symbol)}</b></td><td>${bT(h.assetType)}</td>
    <td class="${clr(h.pnl)}">${n2(h.pnl)}</td>
    <td class="${clr(h.pct)}">${nP(h.pct)}</td>
  </tr>`;

  const topHdr = `<tr>${mkTh('an-top','symbol','Symbol')}${mkTh('an-top','assetType','Type')}${mkTh('an-top','pnl','P&L $')}${mkTh('an-top','pct','P&L %')}</tr>`;
  const botHdr = `<tr>${mkTh('an-bot','symbol','Symbol')}${mkTh('an-bot','assetType','Type')}${mkTh('an-bot','pnl','P&L $')}${mkTh('an-bot','pct','P&L %')}</tr>`;

  $('an-top-body').closest('table').querySelector('thead').innerHTML = topHdr;
  $('an-bot-body').closest('table').querySelector('thead').innerHTML = botHdr;

  // Top performers (profitable, sorted by % desc)
  const topSort = getSort('an-top');
  const topRows = topSort.col
    ? sortRows(withPnl, topSort.col, topSort.dir, 'assetType', 'symbol')
    : withPnl.slice().sort((a,b)=>b.pct-a.pct);
  const top5 = topRows.filter(h=>h.pct>0).slice(0,5);
  $('an-top-body').innerHTML = top5.length
    ? top5.map(mkRow).join('')
    : `<tr><td colspan="4" style="color:var(--text3);text-align:center;padding:12px">No profitable positions${anPerfFilter!=='all'?' in '+anPerfFilter:''}</td></tr>`;

  // Worst performers (losing, sorted by % asc)
  const botSort = getSort('an-bot');
  const botRows = botSort.col
    ? sortRows(withPnl, botSort.col, botSort.dir, 'assetType', 'symbol')
    : withPnl.slice().sort((a,b)=>a.pct-b.pct);
  const bot5 = botRows.filter(h=>h.pct<0).slice(0,5);
  $('an-bot-body').innerHTML = bot5.length
    ? bot5.map(mkRow).join('')
    : `<tr><td colspan="4" style="color:var(--text3);text-align:center;padding:12px">No losing positions${anPerfFilter!=='all'?' in '+anPerfFilter:''}</td></tr>`;
}



function hdSort(key){ hdSortKey=key; $('hd-sort').value=key; renderHD(); }

function renderHD(){
  // Sync dropdown -> SORT_STATE on entry, then header clicks update SORT_STATE
  const dropVal = ($('hd-sort')?.value) || 'symbol';
  const search  = ($('hd-search').value||'').toLowerCase();
  const typeF   = $('hd-type').value;
  const showF   = $('hd-show').value;

  // Rebuild hd-own from actual owners
  const _hdOwn = $('hd-own');
  const _hdOwnCur = _hdOwn ? _hdOwn.value : '';
  if(_hdOwn) _hdOwn.innerHTML = '<option value="">All Owners</option>' +
    getAllPersons().concat(['joint']).map(p=>`<option value="${p}" ${p===_hdOwnCur?'selected':''}>${getPersonLabel(p)}</option>`).join('');
  const ownerF_hd = _hdOwnCur;

  // Rebuild hd-source broker/source filter — built from sources actually present in holdings
  const _hdSource = $('hd-source');
  const _hdSourceCur = _hdSource ? _hdSource.value : '';
  if(_hdSource){
    const _sourcesInUse = [...new Set(calcH().map(h=>h.source).filter(Boolean))].sort();
    const _sourceLabels = getAllBrokers();
    _hdSource.innerHTML = '<option value="">All Sources</option>' +
      _sourcesInUse.map(b=>{
        const label = (_sourceLabels.find(x=>x.value===b)||{}).label || b;
        return `<option value="${b}" ${b===_hdSourceCur?'selected':''}>${label}</option>`;
      }).join('');
  }
  const sourceF_hd = _hdSourceCur;

  // Map dropdown value to sort col/dir for initial load
  if(!SORT_STATE['hd-body'] || !SORT_STATE['hd-body'].col){
    const dropMap = {
      'symbol':      {col:'symbol', dir:1},
      'symbol_desc': {col:'symbol', dir:-1},
      'value_desc':  {col:'mkt',  dir:-1},
      'value_asc':   {col:'mkt',  dir:1},
      'pnl_desc':    {col:'pnl',  dir:-1},
      'pnl_asc':     {col:'pnl',  dir:1},
      'pnlpct_desc': {col:'pct',  dir:-1},
      'pnlpct_asc':  {col:'pct',  dir:1},
      'cost_desc':   {col:'costBasis', dir:-1},
      'cost_asc':    {col:'costBasis', dir:1},
      'units_desc':  {col:'units', dir:-1},
      'alloc_desc':  {col:'alloc', dir:-1},
    };
    SORT_STATE['hd-body'] = dropMap[dropVal] || {col:'symbol', dir:1};
  }

  const holdings = calcH();
  const totalVal = holdings.reduce((s,h)=>s+(prices[priceSymbol(h.symbol)]?prices[priceSymbol(h.symbol)]*h.units:0),0);

  let rows = holdings.map(h=>{
    const avg  = h.units>0?h.costBasis/h.units:0;
    const cur  = prices[priceSymbol(h.symbol)]??null;
    const mkt  = cur!=null?+(cur*h.units).toFixed(4):null;
    const pnl  = mkt!=null?+(mkt-h.costBasis).toFixed(4):null;
    const pct  = pnl!=null&&h.costBasis>0?+(pnl/h.costBasis*100).toFixed(2):null;
    const alloc= totalVal>0&&mkt!=null?+(mkt/totalVal*100).toFixed(2):null;
    const ntrades = trades.filter(t=>t.symbol===h.symbol).length;
    return {...h, avg, cur, mkt, pnl, pct, alloc, ntrades};
  });

  // Filter
  rows = rows.filter(h=>{
    if(search && !h.symbol.toLowerCase().includes(search)) return false;
    if(typeF && h.assetType!==typeF) return false;
    if(ownerF_hd && getSymbolOwner(h.symbol) !== ownerF_hd) return false;
    if(sourceF_hd && h.source !== sourceF_hd) return false;
    if(showF==='profit' && (h.pnl==null||h.pnl<=0)) return false;
    if(showF==='loss'   && (h.pnl==null||h.pnl>=0)) return false;
    if(showF==='noPrice'&& h.cur!=null) return false;
    return true;
  });

  // Sort via SORT_STATE
  const {col, dir} = getSort('hd-body');
  if(col) rows = sortRows(rows, col, dir, 'assetType', 'symbol');

  // Totals
  const totCost = rows.reduce((s,h)=>s+h.costBasis,0);
  const totMkt  = rows.reduce((s,h)=>s+(h.mkt??0),0);
  const totPnl  = rows.some(h=>h.pnl!=null) ? rows.reduce((s,h)=>s+(h.pnl??0),0) : null;
  const totPct  = totPnl!=null&&totCost>0?totPnl/totCost*100:null;
  const totAlloc= rows.reduce((s,h)=>s+(h.alloc??0),0);

  // Sortable headers
  const TID='hd-body';
  const th=(c,label,sty)=>sortTh(TID,c,label,'renderHD',sty);
  $('hd-body').closest('table').querySelector('thead tr').innerHTML =
    th('symbol','Symbol') +
    '<th>Owner</th>' +
    th('assetType','Type') +
    th('units','Units','text-align:right') +
    th('avg','Avg Cost','text-align:right') +
    th('cur','Cur Price','text-align:right') +
    th('mkt','Mkt Value','text-align:right') +
    th('costBasis','Cost Basis','text-align:right') +
    th('pnl','P&L $','text-align:right') +
    th('pct','P&L %','text-align:right') +
    th('alloc','Alloc %','text-align:right') +
    th('ntrades','# Trades','text-align:right') +
    th('source','Source');

  $('hd-body').innerHTML = rows.map(h=>`<tr>
    <td><b>${displaySymbol(h.symbol)}</b></td>
    <td style="white-space:nowrap">
      <span style="display:inline-flex;align-items:center;gap:4px;
        font-size:10px;padding:2px 6px;border-radius:12px;
        background:${getPersonColour(getSymbolOwner(h.symbol))}33;
        color:${getPersonColour(getSymbolOwner(h.symbol))}">
        <select class="owner-select" data-owner-sym="${escHtml(h.symbol)}"
          style="background:transparent;border:none;color:inherit;font-size:10px;
                 padding:0;cursor:pointer;font-family:var(--mono);max-width:80px"
          onchange="changeSymbolOwner('${escHtml(h.symbol)}',this.value)">
          ${buildOwnerOptions(getSymbolOwner(h.symbol))}
        </select>
      </span>
    </td>
    <td>${bT(h.assetType)}</td>
    <td style="text-align:right">${nN(h.units,8)}</td>
    <td style="text-align:right">${n2(h.avg,dec(h.avg))}</td>
    <td style="text-align:right">${h.cur!=null?n2(h.cur,dec(h.cur)):'<span style="color:var(--text3)">—</span>'}</td>
    <td style="text-align:right">${h.mkt!=null?n2(h.mkt):'<span style="color:var(--text3)">—</span>'}</td>
    <td style="text-align:right">${n2(h.costBasis)}</td>
    <td style="text-align:right" class="${clr(h.pnl)}">${h.pnl!=null?(h.pnl>=0?'+':'')+n2(h.pnl):'<span style="color:var(--text3)">—</span>'}</td>
    <td style="text-align:right" class="${clr(h.pct)}">${h.pct!=null?(h.pct>=0?'+':'')+h.pct.toFixed(2)+'%':'<span style="color:var(--text3)">—</span>'}</td>
    <td style="text-align:right">${h.alloc!=null?h.alloc.toFixed(2)+'%':'—'}</td>
    <td style="text-align:right;color:var(--text3)">${h.ntrades}</td>
    <td style="color:var(--text3);font-size:10px">${h.source||''}</td>
  </tr>`).join('');

  $('hd-foot').innerHTML=`<tr style="font-weight:700;border-top:2px solid var(--bo)">
    <td>TOTAL (${rows.length})</td><td colspan="5"></td>
    <td style="text-align:right">${n2(totMkt)}</td>
    <td style="text-align:right">${n2(totCost)}</td>
    <td style="text-align:right" class="${clr(totPnl)}">${n2(totPnl)}</td>
    <td style="text-align:right" class="${clr(totPct)}">${nP(totPct)}</td>
    <td style="text-align:right">${(totAlloc||0).toFixed(2)}%</td>
    <td colspan="2"></td>
  </tr>`;
}