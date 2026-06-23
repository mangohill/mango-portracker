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

// Returns display label e.g. "DHHF:AU" -> "DHHF (Betashares)", "DHHF" -> "DHHF"
function plainSymbol(sym){
  // Plain text version of displaySymbol — no HTML spans
  sym = (sym||'').trim();
  if(!sym) return sym;
  const m = sym.match(/^([^:]+):(.+)$/);
  if(!m) return sym.toUpperCase();
  const base   = m[1].toUpperCase();
  const suffix = m[2].toUpperCase();
  const broker = BROKER_SUFFIX[suffix] || suffix;
  return base + ' (' + broker + ')';
}

function displaySymbol(sym){ sym = escHtml(sym||'');
  if(!sym) return sym;
  const m = sym.match(/^([^:]+):(.+)$/);
  if(!m) return sym.toUpperCase();
  const base   = m[1].toUpperCase();
  const suffix = m[2].toUpperCase();
  const broker = BROKER_SUFFIX[suffix] || suffix;
  return base + ' <span style="font-size:10px;color:var(--text3);font-weight:normal">(' + broker + ')</span>';
}

// Plain text version (no HTML) for exports/search

function calcH(){
  const map={};
  // Sort trades by date so corporate actions apply in correct order
  const sorted = [...trades].sort((a,b)=>{
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

function sortTh(tableId, col, label, renderFnName, extraStyle){
  const sty = 'cursor:pointer;user-select:none' + (extraStyle ? ';'+extraStyle : '');
  return '<th style="' + sty + '" onclick="toggleSort(\'' + tableId + '\',\'' + col + '\',\'' + renderFnName + '\')">'
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

  // Rebuild broker filter from actual holdings sources
  const _htBroker = $('ht-broker');
  const _htBrokerCur = _htBroker ? _htBroker.value : '';
  if(_htBroker){
    const _brokerSources = [...new Set(holdings.map(h=>h.source).filter(Boolean))].sort();
    const _brokerLabels = getAllBrokers().reduce((m,b)=>{m[b.value]=b.label;return m;},{});
    _htBroker.innerHTML = '<option value="">All Brokers</option>' +
      _brokerSources.map(s=>`<option value="${s}" ${s===_htBrokerCur?'selected':''}>${_brokerLabels[s]||s}</option>`).join('');
  }
  const brokerF_h = _htBrokerCur;

  const s = ($('hs').value||'').toLowerCase(), tf = $('ht').value;
  let f = holdings.filter(h=>{
    if(s && !h.symbol.toLowerCase().includes(s)) return false;
    if(tf && h.assetType !== tf) return false;
    if(ownerF_h && getSymbolOwner(h.symbol) !== ownerF_h) return false;
    if(portfolioView===1 && isCrypto(h)) return false;
    if(portfolioView===2 && isStock(h)) return false;
    if(brokerF_h && h.source !== brokerF_h) return false;
    return true;
  });
  $('he').style.display = f.length ? 'none' : '';

  // Apply sort
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
  const th=(col,label,sty)=>sortTh(TID,col,label,'renderH',sty);
  $('hb').closest('table').querySelector('thead tr').innerHTML =
    th('symbol','Symbol') +
    '<th>Owner</th>' +
    th('assetType','Type') +
    th('units','Units','text-align:right') +
    th('_avg','Avg Cost','text-align:right') +
    th('_cur','Cur Price','text-align:right') +
    th('_mv','Mkt Value','text-align:right') +
    th('costBasis','Cost Basis','text-align:right') +
    th('_pl','P&L $','text-align:right') +
    th('_pp','P&L %','text-align:right') +
    th('source','Source');

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

  // Labels
  const viewLabel = portfolioView===1 ? 'Stocks' : portfolioView===2 ? 'Crypto' : '';
  const mvLabel   = viewLabel ? viewLabel+' — Market Value' : 'Market Value';
  const cbLabel   = viewLabel ? viewLabel+' — Cost Basis'   : 'Cost Basis';
  const mvSub     = portfolioView===0 ? 'AUD · all assets ↻'
                  : portfolioView===1 ? 'Stocks only ↻'
                  : 'Crypto only ↻';

  if($('cl-mv')) $('cl-mv').textContent = mvLabel;
  if($('cl-cb')) $('cl-cb').textContent = cbLabel;
  if($('cs-mv')) $('cs-mv').textContent = mvSub;
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
}
function cyclePortfolioView(){
  portfolioView = (portfolioView + 1) % 3;
  renderH();
}
function renderT(){
  const s=($('ts').value||'').toLowerCase(), si=$('tsi').value, so=$('tso').value;
  let f=[...trades].filter(t=>
    (!s||(t.symbol||'').toLowerCase().includes(s))&&(!si||t.type===si)&&(!so||(t.source||'')=== so));

  // Sort — default newest first if no sort set
  const {col, dir} = getSort('tb');
  if(col){
    f = sortRows(f.map(t=>{
      const g=+t.units * +t.price;
      return {...t, _gross:g, _net:t.type==='buy'?g+(+t.fees||0):g-(+t.fees||0)};
    }), col, dir, 'assetType', 'symbol');
  } else {
    f = f.reverse(); // default: newest first
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

    const btnStyle = 'cursor:pointer;background:#1a2f4a;color:#3d9cf0;border:1px solid #3d9cf0;border-radius:4px;padding:3px 10px;font-size:11px;margin-right:4px';

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
