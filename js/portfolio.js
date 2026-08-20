// ── portfolio.js ─────────────────────────────────────────────

function priceSymbol(sym){
  return sym ? sym.replace(/:.*$/,'').toUpperCase() : sym;
}

// Maps broker suffix codes to readable names
const BROKER_SUFFIX = {
    'AU':'Betashares',
    'BS':'Betashares',
    'CMC':'CMC',
    'SW':'Selfwealth',
    'SWF':'Selfwealth',
    'CHESS':'CHESS',
    'NAB':'NAB',
    'ANZ':'ANZ',
    'COMM':'CommSec',
    'CS':'CommSec'
  };

// Betashares suffixes get a compact "SYMBOL:SUFFIX" label instead of the
// verbose "SYMBOL (Betashares)" — it eats far less table width. Other
// brokers keep the full "(Broker Name)" format.
const COMPACT_SUFFIXES = new Set(['AU','BS']);

// Returns display label e.g. "DHHF:AU" -> "DHHF:AU", "DHHF:CMC" -> "DHHF (CMC)", "DHHF" -> "DHHF"
function plainSymbol(sym){
  // Plain text version of displaySymbol — no HTML spans
  sym = (sym||'').trim();
  if(!sym) return sym;
  const m = sym.match(/^([^:]+):(.+)$/);
  if(!m) return sym.toUpperCase();
  const base   = m[1].toUpperCase();
  const suffix = m[2].toUpperCase();
  if(COMPACT_SUFFIXES.has(suffix)) return base + ':' + suffix;
  const broker = BROKER_SUFFIX[suffix] || suffix;
  return base + ' (' + broker + ')';
}

function displaySymbol(sym){ sym = escHtml(sym||'');
  if(!sym) return sym;
  const m = sym.match(/^([^:]+):(.+)$/);
  if(!m) return sym.toUpperCase();
  const base   = m[1].toUpperCase();
  const suffix = m[2].toUpperCase();
  if(COMPACT_SUFFIXES.has(suffix)) return base + ':' + suffix;
  const broker = BROKER_SUFFIX[suffix] || suffix;
  return base + ' <span style="font-size:10px;color:var(--text3);font-weight:normal">(' + broker + ')</span>';
}

// Plain text version (no HTML) for exports/search

function calcH(asOfDate){
  const map={};
  // Sort trades by date so corporate actions apply in correct order
  const sorted = [...trades]
    .filter(t=> !asOfDate || t.date<=asOfDate)
    .sort((a,b)=>{
    const dateD = a.date.localeCompare(b.date);
    if(dateD!==0) return dateD;
    // Same date: ensure _from subtypes always process before _to
    const aIsFrom = (a.subtype||'').endsWith('_from') ? -1 : 0;
    const bIsFrom = (b.subtype||'').endsWith('_from') ? -1 : 0;
    return aIsFrom - bIsFrom;
  });
  for(const t of sorted){
    const s=t.symbol;
    if(!map[s]) map[s]={symbol:s,assetType:t.assetType,units:0,costBasis:0,source:t.source};

    if(t.type==='corporate_action'){
      const sub = t.subtype||'';
      if(sub==='merger_from'||sub==='split_from'||sub==='rename_from'||sub==='spinoff_from'){
        // From-side: remove all units, cost basis transfers to to-side record
        map[s]._caTransfer = map[s].costBasis; // stash for to-side
        map[s].units = 0;
        map[s].costBasis = 0;
      } else if(sub==='merger_to'||sub==='split_to'||sub==='rename_to'||sub==='spinoff_to'){
        // To-side: receive transferred cost basis from the from-symbol
        const fromSym = t.fromSymbol||'';
        // Look up from-entry — also check if it already had _caTransfer stashed
        const fromEntry = fromSym ? (map[fromSym] || null) : null;
        const allocPct = t.allocPct!=null ? +t.allocPct/100 : 1;
        let costToAdd;
        if(t.overrideCostBasis){
          costToAdd = +t.overrideCostBasis;
        } else if(sub==='spinoff_to'){
          costToAdd = fromEntry ? (fromEntry._caTransfer||0)*allocPct : +t.units * +t.price;
        } else if(fromEntry && fromEntry._caTransfer != null){
          // Normal path: from-side was processed first, cost was stashed
          costToAdd = fromEntry._caTransfer||0;
        } else if(fromEntry){
          // From-entry exists but no stash — use its current cost basis
          costToAdd = fromEntry.costBasis||0;
          fromEntry.costBasis = 0;
          fromEntry.units = 0;
        } else if(sub==='split_to' || sub==='rename_to' || sub==='merger_to'){
          // fromSymbol missing — try same symbol (handles stock splits)
          const selfEntry = map[s];
          if(selfEntry && selfEntry._caTransfer != null){
            costToAdd = selfEntry._caTransfer;
          } else {
            costToAdd = +t.units * +t.price;
          }
        } else {
          costToAdd = +t.units * +t.price;
        }
        map[s].units += +t.units;
        map[s].costBasis += costToAdd;
        // If spinoff, reduce from-side cost by the portion allocated away
        if(sub==='spinoff_to' && fromEntry){
          const fromFull = map[fromSym];
          fromFull.costBasis = (fromFull._caTransfer||0) * (1-allocPct);
          fromFull.units = +t.fromUnits||fromFull.units; // restore from-units if provided
          delete fromFull._caTransfer;
        }
      }
    } else if(t.type==='buy' || t.type==='drp'){
      map[s].units+=+t.units;
      map[s].costBasis+=(+t.units * +t.price)+(+t.fees||0);
    } else {
      const ratio=map[s].units>0?(+t.units/map[s].units):0;
      map[s].costBasis-=map[s].costBasis*ratio;
      map[s].units-=+t.units;
    }
    map[s].source=t.source; map[s].assetType=t.assetType;
  }
  return Object.values(map).filter(h=>h.units>0.000001);
}

// ── RENDER HOLDINGS ──────────────────────────────────────────────────
// ── SORTABLE TABLES ──────────────────────────────────────────────────
const SORT_STATE = {};

function getSort(tableId){
  return SORT_STATE[tableId] || {col:null, dir:1};
}

function toggleSort(tableId, col, renderFnName){
  const s = getSort(tableId);
  SORT_STATE[tableId] = {col, dir: s.col===col ? s.dir*-1 : 1};
  if(window[renderFnName]) window[renderFnName]();
}

function sortArrow(tableId, col){
  const s = getSort(tableId);
  if(s.col !== col) return '<span style="opacity:0.25;font-size:10px;margin-left:3px">⇅</span>';
  return s.dir===1
    ? '<span style="color:var(--gold);font-size:10px;margin-left:3px">▲</span>'
    : '<span style="color:var(--gold);font-size:10px;margin-left:3px">▼</span>';
}

function sortTh(tableId, col, label, renderFnName, extraStyle, pri){
  const sty = 'cursor:pointer;user-select:none' + (extraStyle ? ';'+extraStyle : '');
  const priAttr = pri!=null ? ' data-pri="'+pri+'"' : '';
  return '<th style="' + sty + '"' + priAttr + ' onclick="toggleSort(\'' + tableId + '\',\'' + col + '\',\'' + renderFnName + '\')">'
    + label + sortArrow(tableId, col) + '</th>';
}

// Sorts an array of objects by col/dir.
// Special case: col===typeCol groups by type alpha, then by symbolCol A-Z within group.
function sortRows(rows, col, dir, typeCol, symbolCol){
  return rows.slice().sort((a,b)=>{
    let av=a[col], bv=b[col];
    if(col===typeCol){
      const td = (av||'').localeCompare(bv||'') * dir;
      return td !== 0 ? td : (a[symbolCol]||'').localeCompare(b[symbolCol]||'');
    }
    const an = av===null||av===''||av==null;
    const bn = bv===null||bv===''||bv==null;
    if(an && bn) return 0;
    if(an) return 1;
    if(bn) return -1;
    if(typeof av==='number'||(!isNaN(+av))){
      return (+av - +bv) * dir;
    }
    return av.toString().localeCompare(bv.toString()) * dir;
  });
}


function renderH(){
  const CRYPTO_TYPES = ['crypto'];
  const isCrypto = h => CRYPTO_TYPES.includes(h.assetType);
  const isStock  = h => !CRYPTO_TYPES.includes(h.assetType);

  const holdings = calcH();
  // Rebuild asset-type filter from actual holdings (auto-includes new types)
  const _allTypes = [...new Set(holdings.map(h=>h.assetType).filter(Boolean))].sort();
  const AT_NAMES = {asx_stock:'ASX Stock',etf:'ETF',lic:'LIC',reit:'REIT',
    managed:'Managed Fund',crypto:'Crypto',bond:'Bond',cash:'Cash',other:'Other'};
  for(const _fid of ['ht','hd-type']){
    const _fsel = $(_fid);
    if(!_fsel) continue;
    const _cur = _fsel.value;
    _fsel.innerHTML = '<option value="">All Types</option>' +
      _allTypes.map(t=>`<option value="${t}" ${t===_cur?'selected':''}>${AT_NAMES[t]||t}</option>`).join('');
  }
  // Rebuild ht-own owner filter
  const _htOwn = $('ht-own');
  const _htOwnCur = _htOwn ? _htOwn.value : '';
  if(_htOwn) _htOwn.innerHTML = '<option value="">All Owners</option>' +
    getAllPersons().concat(['joint']).map(p=>
      `<option value="${p}" ${p===_htOwnCur?'selected':''}>${getPersonLabel(p)}</option>`
    ).join('');
  const ownerF_h = _htOwnCur;

  // Rebuild ht-broker source/broker filter — built from brokers actually present in holdings
  const _htBroker = $('ht-broker');
  const _htBrokerCur = _htBroker ? _htBroker.value : '';
  if(_htBroker){
    const _brokersInUse = [...new Set(holdings.map(h=>h.source).filter(Boolean))].sort();
    const _brokerLabels = getAllBrokers();
    _htBroker.innerHTML = '<option value="">All Sources</option>' +
      _brokersInUse.map(b=>{
        const label = (_brokerLabels.find(x=>x.value===b)||{}).label || b;
        return `<option value="${b}" ${b===_htBrokerCur?'selected':''}>${label}</option>`;
      }).join('');
  }
  const brokerF_h = _htBrokerCur;

  const s = ($('hs').value||'').toLowerCase(), tf = $('ht').value;
  let f = holdings.filter(h=>{
    if(s && !h.symbol.toLowerCase().includes(s)) return false;
    if(tf && h.assetType !== tf) return false;
    if(ownerF_h && getSymbolOwner(h.symbol) !== ownerF_h) return false;
    if(brokerF_h && h.source !== brokerF_h) return false;
    if(portfolioView===1 && isCrypto(h)) return false;
    if(portfolioView===2 && !isCrypto(h)) return false;
    return true;
  });
  $('he').style.display = f.length ? 'none' : '';

  if($('hb-title')) $('hb-title').textContent =
    portfolioView===1 ? 'HOLDINGS — STOCKS ONLY' : portfolioView===2 ? 'HOLDINGS — CRYPTO ONLY' : 'HOLDINGS';

  // Apply sort — default to A→Z by symbol whenever nothing's been explicitly chosen
  // (fresh load, or after switchTab's per-tab sort reset)
  if(!getSort('hb').col) SORT_STATE['hb'] = {col:'symbol', dir:1};
  const {col, dir} = getSort('hb');
  if(col){
    f = sortRows(f.map(h=>{
      const cur=prices[priceSymbol(h.symbol)]??null;
      const mv=cur!=null?cur*h.units:null;
      const pl=mv!=null?mv-h.costBasis:null;
      const pp=pl!=null&&h.costBasis>0?(pl/h.costBasis)*100:null;
      return {...h,_cur:cur,_mv:mv,_pl:pl,_pp:pp,_avg:h.units>0?h.costBasis/h.units:0};
    }),col,dir,'assetType','symbol');
  } else {
    f = f.map(h=>{
      const cur=prices[priceSymbol(h.symbol)]??null;
      const mv=cur!=null?cur*h.units:null;
      const pl=mv!=null?mv-h.costBasis:null;
      return {...h,_cur:cur,_mv:mv,_pl:pl,
              _pp:pl!=null&&h.costBasis>0?(pl/h.costBasis)*100:null,
              _avg:h.units>0?h.costBasis/h.units:0};
    });
  }

  const TID='hb';
  const th=(col,label,sty,pri)=>sortTh(TID,col,label,'renderH',sty,pri);
  // data-pri controls which columns survive on narrow screens (lower = kept
  // longer). Symbol (index 0) and Source (last index) are always shown by
  // the responsive-table logic regardless of pri, so the numbers below just
  // rank the 9 columns in between: Units/Mkt Value/Cost Basis/P&L% stay
  // visible longest; Owner/Type/Avg Cost/Cur Price/P&L $ drop into the
  // tap-to-reveal detail row first.
  $('hb').closest('table').querySelector('thead tr').innerHTML =
    th('symbol','Symbol',null,0) +
    '<th data-pri="9">Owner</th>' +
    th('assetType','Type',null,8) +
    th('units','Units','text-align:right',1) +
    th('_avg','Avg Cost','text-align:right',10) +
    th('_cur','Cur Price','text-align:right',7) +
    th('_mv','Mkt Value','text-align:right',2) +
    th('costBasis','Cost Basis','text-align:right',3) +
    th('_pl','P&L $','text-align:right',6) +
    th('_pp','P&L %','text-align:right',4) +
    th('source','Source',null,5);

  $('hb').innerHTML = f.map(h=>{
    const cur=h._cur,mv=h._mv,pl=h._pl,pp=h._pp,avg=h._avg;
    const plC=pl==null?'':(pl>=0?'pos':'neg');
    return `<tr>
      <td><b>${displaySymbol(h.symbol)}</b></td><td><span style="font-size:10px;padding:1px 6px;border-radius:10px;background:${getPersonColour(getSymbolOwner(h.symbol))}22;color:${getPersonColour(getSymbolOwner(h.symbol))}">${getPersonLabel(getSymbolOwner(h.symbol))}</span></td><td>${bT(h.assetType)}</td>
      <td style="text-align:right">${nN(h.units,8)}</td>
      <td style="text-align:right">${n2(avg,dec(avg))}</td>
      <td style="text-align:right">${cur!=null?n2(cur,dec(cur)):'<span style="color:var(--text3)">—</span>'}</td>
      <td style="text-align:right">${mv!=null?n2(mv):'<span style="color:var(--text3)">—</span>'}</td>
      <td style="text-align:right">${n2(h.costBasis)}</td>
      <td style="text-align:right" class="${plC}">${pl!=null?(pl>=0?'+':'')+n2(pl):'<span style="color:var(--text3)">—</span>'}</td>
      <td style="text-align:right" class="${plC}">${pp!=null?(pp>=0?'+':'')+pp.toFixed(2)+'%':'<span style="color:var(--text3)">—</span>'}</td>
      <td style="color:var(--text3);font-size:11px">${h.source||''}</td>
    </tr>`;
  }).join('');

  // ── Table totals footer — only when Holdings filters are active ──────
  // Summary cards already cover the unfiltered view; this row mirrors the
  // table columns 1:1 (no colspan) so portrait responsive column-hiding
  // keeps totals under the matching headers. P&L $ hides with its column.
  const hasTableFilter = !!(s || tf || ownerF_h || brokerF_h);
  const hbFoot = $('hb-foot');
  if(hbFoot){
    if(hasTableFilter && f.length){
      let totMv=0, totCost=0, anyMv=false;
      f.forEach(h=>{ if(h._mv!=null){ totMv+=h._mv; anyMv=true; } totCost+=h.costBasis; });
      const totPl = anyMv ? totMv-totCost : null;
      const totPp = totPl!=null && totCost>0 ? (totPl/totCost)*100 : null;
      const plC = totPl==null?'':(totPl>=0?'pos':'neg');
      // One <td> per column — same order as thead/body (Symbol…Source)
      hbFoot.innerHTML = `<tr style="font-weight:700;border-top:2px solid var(--bo)">
        <td>TOTAL (${f.length})</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td style="text-align:right">${anyMv?n2(totMv):'—'}</td>
        <td style="text-align:right">${n2(totCost)}</td>
        <td style="text-align:right" class="${plC}">${totPl!=null?(totPl>=0?'+':'')+n2(totPl):'—'}</td>
        <td style="text-align:right" class="${plC}">${totPp!=null?(totPp>=0?'+':'')+totPp.toFixed(2)+'%':'—'}</td>
        <td></td>
      </tr>`;
    } else {
      hbFoot.innerHTML = '';
    }
  }

  // ── Summary cards — filtered by portfolioView ──────────────────
  const allH = holdings; // unfiltered by search/type, for card totals
  const filterFn = portfolioView===1 ? isStock : portfolioView===2 ? isCrypto : ()=>true;
  const viewH = allH.filter(filterFn).map(h=>{
    const cur = prices[priceSymbol(h.symbol)]??null;
    const mv  = cur!=null ? cur*h.units : null;
    const pl  = mv!=null  ? mv-h.costBasis : null;
    return {...h, _mv:mv, _pl:pl};
  });

  // Trades filtered for card count
  const viewTrades = portfolioView===0 ? trades
    : portfolioView===1 ? trades.filter(t=>!CRYPTO_TYPES.includes(t.assetType))
    : trades.filter(t=>CRYPTO_TYPES.includes(t.assetType));

  let tv=0, tc=0;
  viewH.forEach(h=>{ if(h._mv!=null) tv+=h._mv; tc+=h.costBasis; });
  const tpl = tv ? tv-tc : null;
  const tpp = tpl&&tc ? (tpl/tc*100) : null;

  // Labels — keep both card labels short and constant so they never wrap
  // onto a 2nd line at narrow widths (that's what was pushing the dollar
  // figures out of alignment with the other cards in the row). The
  // Stocks/Crypto view indicator lives in each card's sub-line instead.
  const viewLabel = portfolioView===1 ? 'Stocks' : portfolioView===2 ? 'Crypto' : '';
  const mvLabel   = 'Market Value';
  const cbLabel   = 'Cost Basis';
  const mvSub     = portfolioView===0 ? 'AUD · all assets ↻'
                  : portfolioView===1 ? 'Stocks only ↻'
                  : 'Crypto only ↻';
  const cbSub     = portfolioView===0 ? 'Total invested' : viewLabel+' only';

  if($('cl-mv')) $('cl-mv').textContent = mvLabel;
  if($('cl-cb')) $('cl-cb').textContent = cbLabel;
  if($('cs-mv')) $('cs-mv').textContent = mvSub;
  if($('cs-cb')) $('cs-cb').textContent = cbSub;
  if($('cs-pos')) $('cs-pos').textContent = viewLabel ? viewLabel+' positions' : 'Open';

  // Highlight cards wrapper to show active filter
  const cardsEl = $('portfolio-cards');
  if(cardsEl){
    cardsEl.style.outline = portfolioView===0 ? '' : '2px solid var(--blue)';
    cardsEl.style.borderRadius = portfolioView===0 ? '' : '7px';
  }

  if($('cv')) $('cv').textContent = tv ? n2(tv) : '—';
  if($('cc')) $('cc').textContent = n2(tc);
  if($('cp')){
    $('cp').textContent = tpl!=null ? (tpl>=0?'+':'')+n2(tpl) : '—';
    $('cp').className = 'card-value '+(tpl==null?'neu':tpl>=0?'pos':'neg');
  }
  if($('cpp')) $('cpp').textContent = tpp!=null ? (tpp>=0?'+':'')+tpp.toFixed(2)+'%' : '—';
  if($('cpos')) $('cpos').textContent = viewH.length;
  if($('ctrd')) $('ctrd').textContent = viewTrades.length;

  // cpt sub — price loaded count (always all)
  const priceCount = allH.filter(h=>prices[priceSymbol(h.symbol)]!=null).length;
  const noPriceCount = allH.filter(h=>prices[priceSymbol(h.symbol)]==null).length;
  if($('cpt')) $('cpt').textContent = noPriceCount>0
    ? noPriceCount+' price'+(noPriceCount>1?'s':'')+' missing'
    : 'All prices loaded';

  snapshotPortfolioValue(allH);
  // Single scope for Portfolio Change: portfolio view + optional table filters.
  // Same mark-to-market engine is used for holistic and filtered views.
  const changeScopeFn = h=>{
    if(portfolioView===1 && isCrypto(h)) return false;
    if(portfolioView===2 && isStock(h)) return false;
    if(s && !h.symbol.toLowerCase().includes(s)) return false;
    if(tf && h.assetType !== tf) return false;
    if(ownerF_h && getSymbolOwner(h.symbol) !== ownerF_h) return false;
    if(brokerF_h && h.source !== brokerF_h) return false;
    return true;
  };
  renderPortfolioChange(changeScopeFn, hasTableFilter);
  if(typeof refreshResponsiveTables === 'function') refreshResponsiveTables();
}

// ── PORTFOLIO CHANGE (1D/5D/1M/6M/1Y/5Y/ALL) ───────────────────────────
// Records today's total market value (split by All/Stocks/Crypto) once per
// render. Overwriting the same day's entry repeatedly is fine — we only
// ever care about the latest value recorded for "today". Skipped entirely
// if no prices are loaded yet, so we never pollute history with a $0 day.
function snapshotPortfolioValue(allH){
  const today = localDateStr();
  const valFor = filterFn => {
    let tv = 0, any = false;
    allH.filter(filterFn).forEach(h=>{
      const cur = prices[priceSymbol(h.symbol)];
      if(cur!=null){ tv += cur*h.units; any = true; }
    });
    return any ? +tv.toFixed(2) : null;
  };
  const all    = valFor(()=>true);
  const stocks = valFor(h=>h.assetType!=='crypto');
  const crypto = valFor(h=>h.assetType==='crypto');
  if(all==null && stocks==null && crypto==null) return; // no prices yet — don't record
  // Per-symbol prices for mark-to-market Portfolio Change (stocks + crypto)
  const pricesMap = {};
  const heldSyms = new Set();
  allH.forEach(h=>{
    const sym = priceSymbol(h.symbol);
    if(!sym) return;
    heldSyms.add(sym);
    if(prices[sym]!=null) pricesMap[sym] = prices[sym];
  });
  const prev = pfSnapshots[today] || {};
  // Keep prior prices for held symbols still missing today (e.g. crypto fetch
  // failed once, or monthly NAV). Avoids wiping crypto out of the day map.
  if(prev.prices){
    for(const [sym,p] of Object.entries(prev.prices)){
      if(heldSyms.has(sym) && pricesMap[sym]==null && p!=null) pricesMap[sym] = p;
    }
  }
  // Also inherit from the previous calendar day when today is sparse
  if(Object.keys(pricesMap).length < heldSyms.size){
    const yesterday = new Date(today+'T00:00:00');
    yesterday.setDate(yesterday.getDate()-1);
    const prevDay = findPricedSnapshotOnOrBefore(localDateStr(yesterday));
    const prevDayPrices = prevDay && pfSnapshots[prevDay] && pfSnapshots[prevDay].prices;
    if(prevDayPrices){
      for(const [sym,p] of Object.entries(prevDayPrices)){
        if(heldSyms.has(sym) && pricesMap[sym]==null && p!=null) pricesMap[sym] = p;
      }
    }
  }
  pfSnapshots[today] = {
    all, stocks, crypto,
    prices: Object.keys(pricesMap).length ? pricesMap : (prev.prices||undefined)
  };
  savePfSnapshots();
}

// Merge a remote device's pfSnapshots into ours, day by day — used by Cloud
// Sync pull. Deliberately NOT a wholesale overwrite: each device only ever
// records prices for the days it was actually open, so overwriting would
// wipe out this device's own history for any day the remote copy lacks.
// Per date: keep both devices' per-symbol prices (union), preferring this
// device's own reading if both recorded the same symbol that day; keep
// whichever side has non-null aggregate totals.
function mergePfSnapshots(remoteSnaps){
  if(!remoteSnaps || typeof remoteSnaps!=='object') return false;
  let changed = false;
  for(const [date, remote] of Object.entries(remoteSnaps)){
    if(!remote || typeof remote!=='object') continue;
    const local = pfSnapshots[date];
    if(!local){
      pfSnapshots[date] = remote;
      changed = true;
      continue;
    }
    const mergedPrices = { ...(remote.prices||{}), ...(local.prices||{}) };
    const merged = {
      all:    local.all    != null ? local.all    : remote.all,
      stocks: local.stocks != null ? local.stocks : remote.stocks,
      crypto: local.crypto != null ? local.crypto : remote.crypto,
      prices: Object.keys(mergedPrices).length ? mergedPrices : undefined,
    };
    // Only mark changed if the merge actually added something new
    if(JSON.stringify(merged) !== JSON.stringify(local)){
      pfSnapshots[date] = merged;
      changed = true;
    }
  }
  if(changed) savePfSnapshots();
  return changed;
}

const PF_CHANGE_RANGES = [
  {key:'1d',  label:'1D',  days:1},
  {key:'5d',  label:'5D',  days:5},
  {key:'1m',  label:'1M',  months:1},
  {key:'6m',  label:'6M',  months:6},
  {key:'1y',  label:'1Y',  years:1},
  {key:'5y',  label:'5Y',  years:5},
  {key:'all', label:'ALL'},
];

// ── Portfolio Change display modes ─────────────────────────────────────
// Click the "PORTFOLIO CHANGE" header to cycle through these. All three
// answer "how has this scope done over each window", but define "return"
// differently:
//  · Value Δ        — value now vs. value you HAD on that date. Distorted
//                      by contribution timing: a big DCA burst makes % look
//                      huge even when prices barely moved.
//  · Time-Weighted   — chains sub-period returns between every available
//                      snapshot, netting out contributions/withdrawals each
//                      leg. "How did the strategy/asset perform" — immune
//                      to when or how much cash you added.
//  · Money-Weighted  — solves the single discount rate that reconciles
//                      every buy/sell in the window plus the ending value
//                      (period IRR, actual day-count weighted — NOT
//                      annualised, so it stays comparable to the other two
//                      modes). "How did my money perform" — rewards good
//                      timing of contributions.
const PF_CHANGE_MODES = [
  { key:'value', label:'Value Change', hint:"Value now vs. value you held on that date — can look extreme after a big contribution, even if the price barely moved" },
  { key:'twr',   label:'Time-Weighted', hint:'% ignores when/how much you added, so it answers "how did the asset/strategy perform". $ below is your actual profit (value change minus your net contributions)' },
  { key:'mwr',   label:'Money-Weighted', hint:'% rewards good timing of contributions, so it answers "how did my money perform". $ below is your actual profit (value change minus your net contributions)' },
];
let pfChangeMode = 0;
function cyclePfChangeMode(){
  pfChangeMode = (pfChangeMode + 1) % PF_CHANGE_MODES.length;
  if(typeof renderH === 'function') renderH();
}

// ── Unified mark-to-market engine ─────────────────────────────────────
// Both holistic and filtered Portfolio Change use the same definition:
//   value on date D = Σ (units as of D × price on D) for holdings in scope
// Strict completeness applies only to daily-priced symbols. Unlisted /
// monthly-priced holdings (MAIF, MAAT, …) are included in value when a
// price is known, but never force the whole portfolio to "Incomplete".

// Symbols without daily market quotes (manual / monthly NAV etc.)
const NON_DAILY_PRICE_SYMS = new Set(['MAIF','MAAT']);
function isDailyPricedSym(sym){
  return !NON_DAILY_PRICE_SYMS.has(priceSymbol(sym));
}

// Latest snapshot date ≤ targetStr that has a non-empty per-symbol prices map
function findPricedSnapshotOnOrBefore(targetStr){
  let found = null;
  for(const d of Object.keys(pfSnapshots)){
    const pr = pfSnapshots[d] && pfSnapshots[d].prices;
    if(!pr || !Object.keys(pr).length) continue;
    if(d<=targetStr && (!found || d>found)) found = d;
  }
  return found;
}

// Latest date ≤ targetStr where mark-to-market is complete for this scope.
// Skips e.g. ASX-only worker days when the scope is crypto-only.
function findCompleteSnapshotOnOrBefore(targetStr, scopeFn){
  const dates = Object.keys(pfSnapshots).filter(d=>{
    const pr = pfSnapshots[d] && pfSnapshots[d].prices;
    return pr && Object.keys(pr).length && d <= targetStr;
  }).sort().reverse();
  for(const d of dates){
    const m = markToMarketAt(d, scopeFn);
    if(m.complete && m.value!=null && m.count>0) return d;
  }
  return null;
}

// Earliest date ≥ targetStr where mark-to-market is complete for this scope.
// Used to anchor the "ALL" window start on a date this scope can actually
// be valued on, rather than the first date ANY symbol happened to be priced.
function findCompleteSnapshotOnOrAfter(targetStr, scopeFn){
  const dates = Object.keys(pfSnapshots).filter(d=>{
    const pr = pfSnapshots[d] && pfSnapshots[d].prices;
    return pr && Object.keys(pr).length && d >= targetStr;
  }).sort();
  for(const d of dates){
    const m = markToMarketAt(d, scopeFn);
    if(m.complete && m.value!=null && m.count>0) return d;
  }
  return null;
}

// Live mark-to-market for current holdings in scope
function markToMarketLive(scopeFn){
  const holdings = calcH().filter(scopeFn);
  if(!holdings.length) return { value:null, complete:true, count:0, priced:0 };
  let tv = 0, priced = 0, dailyNeeded = 0, dailyPriced = 0;
  holdings.forEach(h=>{
    const sym = priceSymbol(h.symbol);
    const p = prices[sym];
    if(p!=null){ tv += p * h.units; priced++; }
    if(isDailyPricedSym(sym)){
      dailyNeeded++;
      if(p!=null) dailyPriced++;
    }
  });
  return {
    value: priced ? +tv.toFixed(2) : null,
    // Only daily-priced symbols block completeness
    complete: dailyNeeded === 0 || dailyPriced === dailyNeeded,
    count: holdings.length,
    priced
  };
}

// Historical mark-to-market: holdings as of dateStr × that day's stored prices.
// Non-daily symbols fall back to live/manual price when missing from the snapshot
// (e.g. MAIF only updates monthly — carry the last known NAV).
function markToMarketAt(dateStr, scopeFn){
  const snap = pfSnapshots[dateStr];
  if(!snap || !snap.prices || !Object.keys(snap.prices).length){
    return { value:null, complete:false, count:0, priced:0 };
  }
  const holdings = calcH(dateStr).filter(scopeFn);
  if(!holdings.length) return { value:null, complete:true, count:0, priced:0 };
  let tv = 0, priced = 0, dailyNeeded = 0, dailyPriced = 0;
  holdings.forEach(h=>{
    const sym = priceSymbol(h.symbol);
    let p = snap.prices[sym];
    if(p==null && !isDailyPricedSym(sym) && prices[sym]!=null){
      p = prices[sym]; // carry forward manual / monthly NAV
    }
    if(p!=null){ tv += p * h.units; priced++; }
    if(isDailyPricedSym(sym)){
      dailyNeeded++;
      if(snap.prices[sym]!=null) dailyPriced++; // must be real snapshot price, not fallback
    }
  });
  return {
    value: priced ? +tv.toFixed(2) : null,
    complete: dailyNeeded === 0 || dailyPriced === dailyNeeded,
    count: holdings.length,
    priced
  };
}

// Period rows for any scope (full portfolio, stocks/crypto view, or table filters).
// allTime = { amt, pct } for the ALL column (cost vs live market) — may be null.
function calcPortfolioChangeUnified(scopeFn, allTime){
  const todayStr = localDateStr();
  const live = markToMarketLive(scopeFn);
  const curVal = (live.complete && live.value!=null) ? live.value : null;

  // Anchor on latest day that is complete for THIS scope (not merely any prices)
  const anchorStr = findCompleteSnapshotOnOrBefore(todayStr, scopeFn) || todayStr;
  const anchor = new Date(anchorStr + 'T00:00:00');

  const rows = PF_CHANGE_RANGES.map(r=>{
    if(r.key==='all'){
      if(!allTime || allTime.pct==null) return { label:r.label, pct:null, amt:null };
      return { label:r.label, pct:allTime.pct, amt:allTime.amt };
    }
    if(curVal==null) return { label:r.label, pct:null, amt:null, reason:'incomplete' };

    const target = new Date(anchor);
    if(r.days)   target.setDate(target.getDate() - r.days);
    if(r.months) target.setMonth(target.getMonth() - r.months);
    if(r.years)  target.setFullYear(target.getFullYear() - r.years);
    const snapDate = findCompleteSnapshotOnOrBefore(localDateStr(target), scopeFn);
    if(!snapDate) return { label:r.label, pct:null, amt:null, reason:'no-snapshot' };

    const past = markToMarketAt(snapDate, scopeFn);
    if(!past.complete || past.value==null) return { label:r.label, pct:null, amt:null, reason:'incomplete' };
    if(past.count===0) return { label:r.label, pct:null, amt:null, reason:'empty' };

    return {
      label: r.label,
      pct: past.value>0 ? ((curVal - past.value) / past.value * 100) : null,
      amt: curVal - past.value,
      from: snapDate
    };
  });
  return { asOf:todayStr, rows, live };
}

// Buy/sell trades for exactly the symbols currently in scope — the same
// symbol key calcH() aggregates by, so this always lines up with whatever
// the value/TWR/MWR calcs are using (respects broker/owner/text filters).
// DRP reinvestments (type:'drp') are deliberately excluded: they're not
// external cash, they're already reflected in the higher unit count.
function scopedCashFlowTrades(scopeFn){
  const symbols = new Set(calcH().filter(scopeFn).map(h=>h.symbol));
  return trades.filter(t => (t.type==='buy' || t.type==='sell') && symbols.has(t.symbol));
}

function windowStartTarget(rangeKey, anchorStr){
  if(rangeKey==='all'){
    const dates = Object.keys(pfSnapshots).filter(d=>{
      const pr = pfSnapshots[d] && pfSnapshots[d].prices;
      return pr && Object.keys(pr).length;
    }).sort();
    return dates.length ? dates[0] : null;
  }
  const r = PF_CHANGE_RANGES.find(x=>x.key===rangeKey);
  const target = new Date(anchorStr + 'T00:00:00');
  if(r.days)   target.setDate(target.getDate() - r.days);
  if(r.months) target.setMonth(target.getMonth() - r.months);
  if(r.years)  target.setFullYear(target.getFullYear() - r.years);
  return localDateStr(target);
}

// $ profit attributable to performance alone, for a given window — the
// same underlying accounting identity for both TWR and MWR, since it's
// just arithmetic (End = Start + NetContributions + Gain), not a modeled
// rate: Gain = End − Start − NetContributions. Buys count as a positive
// contribution, sells as a negative one (a withdrawal), matching the sign
// convention the % calcs already use.
function investmentGainDollars(scopeFn, startDate, todayStr, startVal, endVal){
  if(startVal==null || endVal==null) return null;
  let netContrib = 0;
  scopedCashFlowTrades(scopeFn).forEach(t=>{
    if(t.date<=startDate || t.date>todayStr) return;
    const gross = (+t.units||0) * (+t.price||0);
    netContrib += t.type==='buy' ? (gross + (+t.fees||0)) : -(gross - (+t.fees||0));
  });
  return endVal - startVal - netContrib;
}

// ── Time-weighted return ────────────────────────────────────────────
// Chains a sub-period return between every complete snapshot in the
// window — each leg's ending value has that leg's net contributions/
// withdrawals stripped out before computing the leg's return — then
// geometrically links the legs. Accuracy scales with snapshot density:
// daily for the last ~13 months, sparser further back (worker backfill
// tiers), so recent windows (1D–6M) are exact and 1Y/5Y/ALL are a close
// approximation built from real historical prices.
function calcPortfolioChangeTWR(scopeFn){
  const todayStr = localDateStr();
  const holdings = calcH().filter(scopeFn);
  if(!holdings.length) return { asOf: todayStr, rows: [] };

  const anchorStr = findCompleteSnapshotOnOrBefore(todayStr, scopeFn) || todayStr;
  const cfByDate = {};
  scopedCashFlowTrades(scopeFn).forEach(t=>{
    const gross = (+t.units||0) * (+t.price||0);
    const cf = t.type==='buy' ? (gross + (+t.fees||0)) : -(gross - (+t.fees||0));
    cfByDate[t.date] = (cfByDate[t.date]||0) + cf;
  });

  // Legs must be built from dates where THIS SCOPE specifically has a
  // complete price, not "any symbol priced that day" — pfSnapshots dates
  // are dominated by whichever symbols happen to be priced on a given day,
  // so comparing scope-value across two arbitrary consecutive dates from
  // that global list almost always lands on a day this scope ISN'T priced
  // on, marking nearly every leg incomplete and silently skipping it. Using
  // only this scope's own complete dates guarantees every adjacent pair
  // in `legs` is a real, valid leg.
  const allDates = Object.keys(pfSnapshots).filter(d=>{
    const pr = pfSnapshots[d] && pfSnapshots[d].prices;
    return pr && Object.keys(pr).length;
  }).sort();
  const scopeDates = allDates.filter(d => {
    const m = markToMarketAt(d, scopeFn);
    return m.complete && m.value!=null;
  });

  const rows = PF_CHANGE_RANGES.map(r=>{
    const targetStart = windowStartTarget(r.key, anchorStr);
    if(!targetStart) return { label:r.label, pct:null, reason:'no-snapshot' };
    const startDate = r.key==='all'
      ? findCompleteSnapshotOnOrAfter(targetStart, scopeFn)
      : findCompleteSnapshotOnOrBefore(targetStart, scopeFn);
    if(!startDate) return { label:r.label, pct:null, reason:'no-snapshot' };

    const legs = scopeDates.filter(d => d>=startDate && d<=anchorStr);
    if(!legs.length || legs[0]!==startDate) legs.unshift(startDate);

    let chain = 1;
    for(let i=0;i<legs.length-1;i++){
      const dA=legs[i], dB=legs[i+1];
      const vA = markToMarketAt(dA, scopeFn), vB = markToMarketAt(dB, scopeFn);
      if(!vA.complete || !vB.complete || vA.value==null || vB.value==null || vA.value<=0) continue;
      let cf = 0;
      for(const [d,amt] of Object.entries(cfByDate)) if(d>dA && d<=dB) cf += amt;
      chain *= (1 + (vB.value - cf - vA.value) / vA.value);
    }
    // Final leg from the last available snapshot to today's live value
    const lastLeg = legs[legs.length-1];
    const vLast = markToMarketAt(lastLeg, scopeFn), vNow = markToMarketLive(scopeFn);
    if(vLast.complete && vNow.complete && vLast.value>0 && vNow.value!=null){
      let cf = 0;
      for(const [d,amt] of Object.entries(cfByDate)) if(d>lastLeg && d<=todayStr) cf += amt;
      chain *= (1 + (vNow.value - cf - vLast.value) / vLast.value);
    } else if(lastLeg!==anchorStr){
      return { label:r.label, pct:null, reason:'incomplete' };
    }
    const startM = markToMarketAt(startDate, scopeFn);
    const amt = investmentGainDollars(scopeFn, startDate, todayStr, startM.value, vNow.value);
    return { label:r.label, pct:(chain-1)*100, amt, from:startDate };
  });
  return { asOf: todayStr, rows };
}

// ── Money-weighted return (period IRR) ──────────────────────────────
// Solves, for the window, the single rate p that reconciles: −(value you
// had at window start) + every buy(−)/sell(+) in the window + (value now)
// = 0, using actual calendar day-count weighting. This is the window's
// holding-period IRR — deliberately NOT annualised, so it stays directly
// comparable to Value Δ and TWR alongside it rather than exploding for
// short windows the way an annualised rate would.
function xirrPeriodic(cashflows, T){
  if(T<=0) return null;
  const npv = p => cashflows.reduce((s,cf)=> s + cf.amt/Math.pow(1+p, cf.t/T), 0);
  let p = 0.1, converged = false;
  for(let i=0;i<60;i++){
    const f = npv(p), h = 1e-6;
    const fp = (npv(p+h)-npv(p-h))/(2*h);
    if(!isFinite(fp) || Math.abs(fp)<1e-12) break;
    const next = p - f/fp;
    if(!isFinite(next) || next<=-0.999999) break;
    if(Math.abs(next-p) < 1e-9){ p = next; converged = true; break; }
    p = next;
  }
  const total = cashflows.reduce((s,c)=>s+Math.abs(c.amt),0) || 1;
  if(converged && Math.abs(npv(p)) < total*0.01) return p;
  // Newton didn't settle cleanly — bisect over a wide, bounded range
  let lo=-0.999, hi=50, flo=npv(lo), fhi=npv(hi);
  if(flo*fhi>0) return null; // no sign change within range — can't solve
  let mid = lo;
  for(let i=0;i<200;i++){
    mid = (lo+hi)/2; const fm = npv(mid);
    if(Math.abs(fm) < total*0.0001) return mid;
    if(flo*fm<0){ hi=mid; fhi=fm; } else { lo=mid; flo=fm; }
  }
  return mid;
}

function calcPortfolioChangeMWR(scopeFn){
  const todayStr = localDateStr();
  const holdings = calcH().filter(scopeFn);
  if(!holdings.length) return { asOf: todayStr, rows: [] };

  const anchorStr = findCompleteSnapshotOnOrBefore(todayStr, scopeFn) || todayStr;
  const vNow = markToMarketLive(scopeFn);
  const cfTrades = scopedCashFlowTrades(scopeFn);

  const rows = PF_CHANGE_RANGES.map(r=>{
    const targetStart = windowStartTarget(r.key, anchorStr);
    if(!targetStart || !vNow.complete || vNow.value==null) return { label:r.label, pct:null, reason:'no-snapshot' };
    const startDate = r.key==='all'
      ? findCompleteSnapshotOnOrAfter(targetStart, scopeFn)
      : findCompleteSnapshotOnOrBefore(targetStart, scopeFn);
    if(!startDate) return { label:r.label, pct:null, reason:'no-snapshot' };

    const startM = markToMarketAt(startDate, scopeFn);
    if(!startM.complete || startM.value==null) return { label:r.label, pct:null, reason:'incomplete' };

    const T = Math.max(1, (new Date(todayStr) - new Date(startDate)) / 86400000);
    const cashflows = [{ t:0, amt:-startM.value }];
    cfTrades.forEach(t=>{
      if(t.date<=startDate || t.date>todayStr) return;
      const gross = (+t.units||0) * (+t.price||0);
      const amt = t.type==='buy' ? -(gross+(+t.fees||0)) : (gross-(+t.fees||0));
      const days = Math.max(0, (new Date(t.date) - new Date(startDate)) / 86400000);
      cashflows.push({ t:days, amt });
    });
    cashflows.push({ t:T, amt:vNow.value });

    const p = xirrPeriodic(cashflows, T);
    if(p==null) return { label:r.label, pct:null, reason:'no-converge' };
    const amt = investmentGainDollars(scopeFn, startDate, todayStr, startM.value, vNow.value);
    return { label:r.label, pct:p*100, amt, from:startDate };
  });
  return { asOf: todayStr, rows };
}

function renderPortfolioChange(scopeFn, isFiltered){
  const wrap = $('pf-change-wrap');
  if(!wrap) return;

  const scoped = calcH().filter(scopeFn);
  if(!scoped.length){ wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  const mode = PF_CHANGE_MODES[pfChangeMode];
  const badge = $('pf-change-mode-badge');
  if(badge){ badge.textContent = '· ' + mode.label; badge.title = mode.hint; }
  const th = $('pf-change-th');
  if(th) th.title = mode.hint + '  (tap to switch: ' + PF_CHANGE_MODES.map(m=>m.label).join(' → ') + ')';

  const sub = $('pf-change-sub');
  if(sub){
    const pricedDays = Object.keys(pfSnapshots).filter(d=>{
      const pr = pfSnapshots[d] && pfSnapshots[d].prices;
      return pr && Object.keys(pr).length;
    }).sort();
    const base = pricedDays.length
      ? `${pricedDays.length} day${pricedDays.length>1?'s':''} with per-symbol prices · since ${pricedDays[0]}`
      : 'recording per-symbol daily prices — history builds over time';
    const modeHint = mode.key==='value' ? 'Mark-to-market · ' + base + ' · ALL = cost vs market'
      : mode.key==='twr' ? 'Time-weighted (strategy return) · ' + base
      : "Money-weighted (your money's return, period IRR) · " + base;
    sub.textContent = (isFiltered ? 'Filtered · ' : '') + modeHint + ' · click header to switch';
  }

  let result;
  if(mode.key==='value'){
    let tv = 0, tc = 0, any = false;
    scoped.forEach(h=>{
      const p = prices[priceSymbol(h.symbol)];
      if(p!=null){ tv += p * h.units; any = true; }
      tc += h.costBasis;
    });
    const allTime = (any && tc>0) ? { amt: tv - tc, pct: (tv - tc) / tc * 100 } : null;
    result = calcPortfolioChangeUnified(scopeFn, allTime);
  } else if(mode.key==='twr'){
    result = calcPortfolioChangeTWR(scopeFn);
  } else {
    result = calcPortfolioChangeMWR(scopeFn);
  }

  $('pf-change-row').innerHTML = result.rows.map(r=>{
    if(r.pct==null){
      const hint = r.reason==='incomplete' ? 'Incomplete prices'
        : r.reason==='no-snapshot' ? 'No history yet'
        : r.reason==='no-converge' ? "Couldn't solve"
        : '';
      return `<div style="text-align:center">
        <div style="font-size:10px;color:var(--text3);letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">${r.label}</div>
        <div style="font-family:var(--mono);font-size:15px;font-weight:600;color:var(--text3)">—</div>
        ${hint ? `<div style="font-size:9px;color:var(--text3);margin-top:2px">${hint}</div>` : ''}
      </div>`;
    }
    const cls = r.pct>=0 ? 'pos' : 'neg';
    const amtLine = (r.amt!=null)
      ? `<div class="${cls}" style="font-size:9px;margin-top:2px">${r.amt>=0?'+':''}${n2(r.amt)}</div>`
      : '';
    return `<div style="text-align:center">
      <div style="font-size:10px;color:var(--text3);letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">${r.label}</div>
      <div class="${cls}" style="font-family:var(--mono);font-size:15px;font-weight:600">${r.pct>=0?'+':''}${r.pct.toFixed(2)}%</div>
      ${amtLine}
    </div>`;
  }).join('');
}


function cyclePortfolioView(){
  portfolioView = (portfolioView + 1) % 3;
  renderH();
}
function renderT(){
  const s=($('ts').value||'').toLowerCase(), si=$('tsi').value, so=$('tso').value;

  // Rebuild to-own owner filter
  const _toOwn = $('to-own');
  const _toOwnCur = _toOwn ? _toOwn.value : '';
  if(_toOwn) _toOwn.innerHTML = '<option value="">All Owners</option>' +
    getAllPersons().concat(['joint']).map(p=>
      `<option value="${p}" ${p===_toOwnCur?'selected':''}>${getPersonLabel(p)}</option>`
    ).join('');
  const ownerF_t = _toOwnCur;

  let f=[...trades].filter(t=>
    (!s||(t.symbol||'').toLowerCase().includes(s))&&(!si||t.type===si)&&(!so||(t.source||'')=== so)
    &&(!ownerF_t || getSymbolOwner(t.symbol) === ownerF_t));

  // Sort — default to most-recent-first by date whenever nothing's been explicitly chosen
  if(!getSort('tb').col) SORT_STATE['tb'] = {col:'date', dir:-1};
  const {col, dir} = getSort('tb');
  if(col){
    f = sortRows(f.map(t=>{
      const g=+t.units * +t.price;
      return {...t, _gross:g, _net:t.type==='buy'?g+(+t.fees||0):g-(+t.fees||0)};
    }), col, dir, 'assetType', 'symbol');
  }

  $('tc').textContent=f.length;
  $('te').style.display=f.length?'none':'';
  const idxMap={}; trades.forEach((t,i)=>idxMap[t.id]=i);
  window._editIds = {};

  // Update headers
  const TID='tb';
  const th=(col,label,sty)=>sortTh(TID,col,label,'renderT',sty);
  $('tb').closest('table').querySelector('thead tr').innerHTML =
    th('date','Date') +
    th('type','Side') +
    th('symbol','Symbol') +
    th('assetType','Type') +
    th('units','Units','text-align:right') +
    th('price','Price','text-align:right') +
    th('_gross','Gross','text-align:right') +
    th('fees','Fees','text-align:right') +
    th('_net','Net','text-align:right') +
    th('source','Source') +
    '<th></th>';

  $('tb').innerHTML = f.map((t,ri)=>{
    const g   = +t.units * +t.price;
    const net = (t.type==='buy'||t.type==='drp') ? g+(+t.fees||0) : g-(+t.fees||0);
    window._editIds[ri] = t.id;

    if(editingTradeId === t.id){
      const types = ['crypto','stock','etf','lic','reit','bond','commodity','managed','super'];
      const tl = {crypto:'Crypto',stock:'Stock',etf:'ETF',lic:'LIC',reit:'REIT',bond:'Bond',commodity:'Commodity',managed:'Managed Fund',super:'Super/Pension'};
      let html = '<tr style="background:var(--bg2);outline:2px solid var(--blue)">';
      html += '<td><input class="fi" type="date" id="et-date" value="' + t.date + '" style="width:118px;padding:3px 5px"></td>';
      html += '<td><select class="fi" id="et-side" style="padding:3px 5px">';
      html += '<option value="buy"'  + (t.type==='buy'  ? ' selected' : '') + '>Buy</option>';
      html += '<option value="sell"' + (t.type==='sell' ? ' selected' : '') + '>Sell</option>';
      html += '<option value="drp"'  + (t.type==='drp'  ? ' selected' : '') + '>DRP</option>';
      html += '</select></td>';
      html += '<td><input class="fi" type="text" id="et-sym" value="' + t.symbol + '" style="width:65px;padding:3px 5px" oninput="this.value=this.value.toUpperCase()"></td>';
      html += '<td><select class="fi" id="et-type" style="padding:3px 5px;font-size:11px">';
      html += types.map(v => '<option value="' + v + '"' + (v===t.assetType ? ' selected' : '') + '>' + tl[v] + '</option>').join('');
      html += '</select></td>';
      html += '<td><input class="fi" type="number" id="et-units" value="' + t.units + '" step="any" style="width:85px;padding:3px 5px"></td>';
      html += '<td><input class="fi" type="number" id="et-price" value="' + t.price + '" step="any" style="width:85px;padding:3px 5px"></td>';
      html += '<td <input class="fi" type="number" id="et-fees" value="' + (+t.fees||0) + '" step="any" style="width:75px;padding:3px 5px"></td>';

      html += '<td><select class="fi" id="et-source" style="padding:3px 5px;font-size:11px">';
      getAllBrokers().forEach(b=>{ html += '<option value="' + b.value + '"' + (t.source===b.value?' selected':'') + '>' + b.label + '</option>'; });
      html += '</select></td>';
      html += '<td><input class="fi" type="text" id="et-notes" value="' + escHtml(t.notes||'') + '" placeholder="Notes…" style="width:120px;padding:3px 5px"></td>';
      html += '<td colspan="2" style="white-space:nowrap;padding:6px 8px">';
      html += '<button class="btn btn-g" style="padding:4px 12px;font-size:11px" onclick="saveEditTrade()">&#10003; SAVE</button> ';
      html += '<button class="btn" style="padding:4px 8px;font-size:11px" onclick="cancelEditTrade()">&#10005;</button>';
      html += '</td></tr>';
      return html;
    }

    const btnStyle = 'cursor:pointer;background:#1a2f4a;color:#38c6ff;border:1px solid #38c6ff;border-radius:4px;padding:3px 10px;font-size:11px;margin-right:4px';

    // Corporate action row — special display
    if(t.type==='corporate_action'){
      const sub = t.subtype||'';
      const isFrom = sub.endsWith('_from');
      const arrow  = isFrom ? '→' : '←';
      const peer   = isFrom ? (t.fromSymbol||'') : (t.fromSymbol||'');
      const caTag  = `<span style="background:#2a1f6a;color:#a78bfa;border:1px solid #6d4fd4;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700">${escHtml(t.caLabel||'Corp Action')}</span>`;
      const sideTag= isFrom
        ? `<span style="color:var(--neg);font-weight:700">OUT</span>`
        : `<span style="color:var(--pos);font-weight:700">IN</span>`;
      return '<tr style="background:rgba(109,79,212,0.07)">'
        + '<td>' + t.date + '</td>'
        + '<td>' + sideTag + '</td>'
        + '<td><b>' + t.symbol + '</b>'+(t.fromSymbol&&t.fromSymbol!==t.symbol?'<span style="color:var(--text3);font-size:10px"> ('+t.fromSymbol+')</span>':'')+' </td>'
        + '<td>' + caTag + '</td>'
        + '<td style="text-align:right">' + nN(t.units,8) + '</td>'
        + '<td style="text-align:right;color:var(--text3)">' + (isFrom?'—':n2(t.price,dec(t.price))) + '</td>'
        + '<td colspan="3" style="color:var(--text3);font-size:11px">'
        +   (isFrom 
            ? 'Cost basis out → ' + (t.fromSymbol||t.symbol)
            : 'Cost basis in ← ' + (t.fromSymbol||'?')) + '</td>'
        + '<td style="color:var(--text3);font-size:10px">' + (t.source||'') + '</td>'
        + '<td style="white-space:nowrap;padding:4px 8px">'
        + '<button class="del-btn" onclick="delT(' + idxMap[t.id] + ')">&#10005;</button>'
        + '</td>'
        + '</tr>';
    }
    return '<tr>'
      + '<td>' + t.date + '</td>'
      + '<td>' + bS(t.type) + '</td>'
      + '<td><b>' + displaySymbol(t.symbol) + '</b></td>'
      + '<td>' + bT(t.assetType) + '</td>'
      + '<td style="text-align:right">' + nN(t.units,8) + '</td>'
      + '<td style="text-align:right">' + n2(t.price,dec(t.price)) + '</td>'
      + '<td style="text-align:right">' + n2(g) + '</td>'
      + '<td style="text-align:right;color:var(--text3)">' + n2(+t.fees||0) + '</td>'
      + '<td style="text-align:right">' + n2(net) + '</td>'
      + '<td style="color:var(--text3);font-size:10px">' + (t.source||'') + '</td>'
      + '<td style="white-space:nowrap;padding:4px 8px">'
      + '<button style="' + btnStyle + '" onclick="doEditTrade(' + ri + ')">&#9998; EDIT</button>'
      + '<button class="del-btn" onclick="delT(' + idxMap[t.id] + ')">&#10005;</button>'
      + '</td>'
      + '</tr>';
  }).join('');

  document.querySelectorAll('#tb .edit-trade-btn').forEach(btn => {
    btn.addEventListener('click', () => doEditTrade(+btn.dataset.ri));
  });

  // ── Filtered footer ──────────────────────────────────────────────
  const hasFilter = s || si || so;
  const tFoot = $('t-foot');
  if(tFoot){
    const realTrades = f.filter(t => t.type !== 'corporate_action');
    if(hasFilter && realTrades.length > 0){
      const buys      = realTrades.filter(t=>t.type==='buy'||t.type==='drp');
      const sells     = realTrades.filter(t=>t.type==='sell');
      const buyTotal  = buys .reduce((sum,t)=>sum+(+t.units * +t.price)+(+t.fees||0),0);
      const sellTotal = sells.reduce((sum,t)=>sum+(+t.units * +t.price)-(+t.fees||0),0);
      const feesTotal = realTrades.reduce((sum,t)=>sum+(+t.fees||0),0);
      const buyCnt    = buys.length;
      const sellCnt   = sells.length;
      const drpCnt    = realTrades.filter(t=>t.type==='drp').length;

      // Units + avg price — shown when filtering by symbol only (no side/source filter)
      const symbolOnly = s && !si && !so;
      const buyUnits  = buys .reduce((sum,t)=>sum+(+t.units),0);
      const sellUnits = sells.reduce((sum,t)=>sum+(+t.units),0);
      const netUnits  = +(buyUnits - sellUnits).toFixed(6);
      const avgPrice  = netUnits > 0.000001 ? (buyTotal - sellTotal) / netUnits : 0;
      const netTotal  = si==='sell' ? sellTotal : si==='buy'||si==='drp' ? buyTotal : buyTotal - sellTotal;

      tFoot.innerHTML = `<tr style="border-top:2px solid var(--bo);font-weight:700">
        <td colspan="4" style="color:var(--text2);font-size:12px;padding:8px 8px">
          ${realTrades.length} trade${realTrades.length!==1?'s':''}
          ${buyCnt?'<span style="color:var(--green);margin-left:8px">'+buyCnt+' buy</span>':''}
          ${sellCnt?'<span style="color:var(--red);margin-left:6px">'+sellCnt+' sell</span>':''}
          ${drpCnt?'<span style="color:#c4b5fd;margin-left:6px">'+drpCnt+' drp</span>':''}
        </td>
        ${symbolOnly ? `
          <td style="text-align:right;padding:8px 8px">
            <div style="font-family:var(--mono);font-size:10px;color:var(--text3);margin-bottom:2px">NET UNITS</div>
            <div style="font-size:13px">${nN(netUnits,4)}</div>
            ${sellUnits>0?`<div style="font-size:10px;color:var(--text3)">${nN(buyUnits,4)} in / ${nN(sellUnits,4)} out</div>`:''}
          </td>
          <td style="text-align:right;padding:8px 8px">
            <div style="font-family:var(--mono);font-size:10px;color:var(--text3);margin-bottom:2px">AVG PRICE</div>
            <div style="font-size:13px">${avgPrice>0?n2(avgPrice,dec(avgPrice)):'—'}</div>
          </td>
          <td></td>` :
          `<td colspan="3"></td>`}
        <td style="text-align:right;color:var(--text3);font-size:12px;padding:8px 8px">${n2(feesTotal)}</td>
        <td style="text-align:right;padding:8px 8px">
          <div style="font-family:var(--mono);font-size:10px;color:var(--text3);margin-bottom:2px">NET VALUE</div>
          <div style="color:var(--gold);font-size:13px">${n2(Math.abs(netTotal))}</div>
        </td>
        <td colspan="3"></td>
      </tr>`;
    } else {
      tFoot.innerHTML = '';
    }
  }
}

function doEditTrade(ri){
  editingTradeId = window._editIds[ri];
  renderT();
}

function cancelEditTrade(){
  editingTradeId = null;
  renderT();
}

function retypeAllTrades(symbol, newAssetType, doSave){
  let count = 0;
  trades.forEach(t => {
    if(t.symbol === symbol && t.assetType !== newAssetType){
      t.assetType = newAssetType;
      count++;
    }
  });
  if(doSave !== false){ save(); renderT(); renderH(); renderR(); }
  return count;
}

function retypeSymbolPrompt(){
  const existing = $('retype-panel');
  if(existing){ existing.remove(); return; }
  const symMap = {};
  trades.forEach(t=>{ if(t.symbol) symMap[t.symbol] = t.assetType; });
  const syms = Object.keys(symMap).sort();
  if(!syms.length){ notify('No trades to retype.','err'); return; }
  const TYPE_OPTS = [
    ['asx_stock','ASX Stock'],['etf','ETF'],['lic','LIC'],['reit','REIT'],
    ['managed','Managed Fund'],['crypto','Crypto'],['bond','Bond'],['cash','Cash'],['other','Other']
  ];
  const panel = document.createElement('div');
  panel.id = 'retype-panel';
  panel.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin:8px 0 4px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end';
  panel.innerHTML = `
    <div>
      <label class="fl">Symbol</label>
      <select class="fi" id="retype-sym" style="min-width:120px" onchange="retypeSyncType()">
        ${syms.map(s=>`<option value="${escHtml(s)}">${escHtml(s)} (${symMap[s]||'?'})</option>`).join('')}
      </select>
    </div>
    <div>
      <label class="fl">Change All Trades To</label>
      <select class="fi" id="retype-at" style="min-width:140px">
        ${TYPE_OPTS.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary" onclick="applyRetype()">Apply to All Trades</button>
      <button class="btn" onclick="document.getElementById('retype-panel').remove()">Cancel</button>
    </div>
    <div style="font-size:11px;color:var(--text3);width:100%">
      Updates every trade for the selected symbol to the new asset type — including buys, sells, DRP and corporate actions.
    </div>
  `;
  const th = document.querySelector('#panel-trades .th');
  if(th) th.after(panel);
  retypeSyncType();
}

function retypeSyncType(){
  const symMap = {};
  trades.forEach(t=>{ if(t.symbol) symMap[t.symbol] = t.assetType; });
  const sym = $('retype-sym')?.value;
  const atSel = $('retype-at');
  if(atSel && sym && symMap[sym]) atSel.value = symMap[sym];
}

function applyRetype(){
  const sym = ($('retype-sym')?.value||'').trim().toUpperCase();
  const newType = $('retype-at')?.value||'';
  if(!sym||!newType){ notify('Select a symbol and type.','err'); return; }
  const total = trades.filter(t=>t.symbol===sym).length;
  const changed = retypeAllTrades(sym, newType, true);
  document.getElementById('retype-panel')?.remove();
  renderT(); renderH(); renderR(); if(typeof renderAnalytics==='function') renderAnalytics();
  notify(`Updated ${total} trade${total!==1?'s':''} for ${sym} → ${newType} (${changed} type${changed!==1?'s':''} changed) ✓`);
}

function saveEditTrade(){
  const idx = trades.findIndex(t=>t.id===editingTradeId);
  if(idx<0){ notify('Trade not found.','err'); return; }
  const date  = $('et-date').value;
  const sym   = ($('et-sym').value||'').trim().toUpperCase();
  const type  = $('et-side').value;
  const asset = $('et-type').value;
  const units = parseFloat($('et-units').value);
  const price = parseFloat($('et-price').value);
  const fees  = parseFloat($('et-fees').value)||0;
  const source = ($('et-source')?.value || trades[idx]?.source || '');
  const notes  = ($('et-notes')?.value ?? trades[idx]?.notes ?? '').trim();
  if(!date||!sym||isNaN(units)||isNaN(price)){ notify('Fill all required fields.','err'); return; }
  if(units<=0){ notify('Units must be greater than zero.','err'); return; }
  if(price<0){ notify('Price cannot be negative.','err'); return; }
  const prevAsset = trades[idx].assetType;
  trades[idx] = {...trades[idx], date, symbol:sym, type, assetType:asset, units, price, fees, source, notes};
  // Offer bulk retype if assetType changed and other trades exist for this symbol
  if(asset !== prevAsset){
    const others = trades.filter((t,i)=> i!==idx && t.symbol===sym && t.assetType!==asset);
    if(others.length > 0){
      const doAll = confirm(
        `${others.length} other trade${others.length>1?'s':''} for ${sym} still use type "${prevAsset}".\n\nUpdate ALL ${sym} trades to "${asset}"?`
      );
      if(doAll) retypeAllTrades(sym, asset, false);
    }
  }
  editingTradeId = null;
  save(); renderT(); renderH(); renderR(); if(typeof renderAnalytics==='function') renderAnalytics();
  notify('Trade updated ✓');
}


// ── ADD/DELETE ───────────────────────────────────────────────────────
function setDate(){const d=$('fd');if(!d.value)d.value=new Date().toISOString().slice(0,10);}
function prevw(){
  const u=parseFloat($('fun').value)||0, p=parseFloat($('fpr').value)||0;
  const f=parseFloat($('ffe').value)||0, s=$('fsi').value;
  const g=u*p, net=s==='buy'?g+f:g-f;
  $('fpv').textContent=g>0?`Gross: ${n2(g)}  |  Net: ${n2(net)}`:'';
}
function addTrade(){
  const date=$('fd').value, side=$('fsi').value;
  const sym=$('fsy').value.trim().toUpperCase();
  const at=$('fat').value;
  const units=parseFloat($('fun').value);
  const price=parseFloat($('fpr').value);
  const fees=parseFloat($('ffe').value)||0;
  const source=$('fso').value;
  const notes=$('fno').value.trim();
  if(!date||!sym||isNaN(units)||isNaN(price)||units<=0||price<0){notify('Fill date, symbol, units and price.','err');return;}
  if(units<=0){notify('Units must be greater than zero.','err');return;}
  if((side==='buy'||side==='sell')&&price<0){notify('Price cannot be negative.','err');return;}
  const newTrade = {date,type:side,symbol:sym,assetType:at,units,price,fees,source,notes,id:uid()};
  if(isTradeDuplicate(newTrade)){
    if(!confirm('A trade with the same date, symbol, type, units and price already exists. Add anyway?')) return;
  }
  trades.push(newTrade);
  save(); clearForm(); renderR(); renderH(); renderT(); if(typeof renderAnalytics==='function') renderAnalytics();
  notify(`Added: ${side.toUpperCase()} ${nN(units,4)} ${sym} @ ${n2(price,dec(price))}`);
}
function clearForm(){['fsy','fun','fpr','fno'].forEach(id=>$(id).value='');$('ffe').value='0';$('fpv').textContent='';}
function delT(idx){
  if(idx < 0 || idx >= trades.length){ notify('Trade not found.','err'); return; }
  if(!confirm('Delete this trade?')) return;
  trades.splice(idx,1); save(); renderT(); renderH(); renderR();
  notify('Trade deleted.','ok');
}