// ── tax.js ─────────────────────────────────────────────

async function extractPDFText(file){
  const buf = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result);
    r.onerror = () => rej(new Error('FileReader failed'));
    r.readAsArrayBuffer(file);
  });

  const bytes = new Uint8Array(buf);
  if(bytes.length === 0) throw new Error('File is empty');
  const hdr = String.fromCharCode(...bytes.slice(0,5));
  if(!hdr.startsWith('%PDF')) throw new Error('Not a valid PDF file');

  let raw = '';
  for(let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);

  function inflateRaw(data){
    return new Promise(resolve => {
      try {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();
        const chunks = [];
        function pump(){
          reader.read().then(({done, value}) => {
            if(done){
              const total = chunks.reduce((n,c) => n+c.length, 0);
              const out = new Uint8Array(total);
              let off = 0;
              for(const c of chunks){ out.set(c, off); off += c.length; }
              let s = '';
              for(let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]);
              resolve(s);
            } else { chunks.push(value); pump(); }
          }).catch(() => resolve(null));
        }
        pump();
        writer.write(data).then(() => writer.close()).catch(() => resolve(null));
      } catch(e){ resolve(null); }
    });
  }

  const texts = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  let nStreams=0, nDecoded=0, nTexts=0;

  while((m = streamRe.exec(raw)) !== null){
    const streamStr = m[1];
    const sb = new Uint8Array(streamStr.length);
    for(let i = 0; i < streamStr.length; i++) sb[i] = streamStr.charCodeAt(i) & 0xff;

    const b0 = sb[0], b1 = sb.length > 1 ? sb[1] : 0;
    const isZlib = b0 === 0x78 && (b1 === 0x01 || b1 === 0x9c || b1 === 0xda || b1 === 0x5e);
    nStreams++;

    let decoded = null;
    if(isZlib && sb.length > 6){
      decoded = await inflateRaw(sb.slice(2, sb.length - 4));
      if(!decoded) decoded = await inflateRaw(sb.slice(2));
    } else if(sb.length > 10){
      decoded = await inflateRaw(sb);
      if(!decoded) decoded = await inflateRaw(sb.slice(0, sb.length - 4));
    }
    if(!decoded){
      const isPrint = [...sb.slice(0,40)].every(b => b===10||b===13||b===9||(b>=32&&b<127));
      if(isPrint) decoded = streamStr;
    }
    if(!decoded) continue;
    nDecoded++;

    const btRe = /BT\b([\s\S]*?)\bET\b/g;
    let bt;
    while((bt = btRe.exec(decoded)) !== null){
      const block = bt[1];
      const tjRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g;
      let tj;
      while((tj = tjRe.exec(block)) !== null){
        const t = decodePDFStr(tj[1]);
        if(t.trim()){ texts.push(t); nTexts++; }
      }
      const tjARe = /\[([^\]]*)\]\s*TJ/g;
      let tja;
      while((tja = tjARe.exec(block)) !== null){
        const strRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
        let s; let line = '';
        while((s = strRe.exec(tja[1])) !== null) line += decodePDFStr(s[1]);
        if(line.trim()){ texts.push(line); nTexts++; }
      }
    }
  }

  const result = texts.join(' ');
  return result;
}

function decodePDFStr(s){
  return s
    .replace(/\\(\d{3})/g, (_,o) => String.fromCharCode(parseInt(o,8)))
    .replace(/\\n/g,'\n').replace(/\\r/g,'\r').replace(/\\t/g,'\t')
    .replace(/\\\\/g,'\\').replace(/\\\(/g,'(').replace(/\\\)/g,')');
}


function saveTaxData(){ localStorage.setItem('pt_tax', JSON.stringify(taxData)); }
function getTaxFY(){
  const _d = new Date();
  const cur = _d.getMonth() >= 6 ? _d.getFullYear()+1 : _d.getFullYear();
  return taxFY || cur;
}
function taxKey(fy){ return 'FY'+fy; }
function getTaxRecord(fy){
  const k = taxKey(fy);
  const defaults = {
    lumia:  {salary:0, withheld:0, payg:0, hecs:0, privateHealth:false, sacrifice:0},
    chilli: {salary:0, withheld:0, payg:0, hecs:0, privateHealth:false, sacrifice:0},
    privateHealthFamily: false,
    dependants: 0,
    props:  {},
  };
  if(!taxData[k]){
    taxData[k] = defaults;
  } else {
    // Merge missing top-level keys (handles old localStorage data)
    for(const key of Object.keys(defaults)){
      if(taxData[k][key] === undefined || taxData[k][key] === null){
        taxData[k][key] = defaults[key];
      }
    }
    // Merge missing person fields
    for(const person of ['lumia','chilli']){
      if(!taxData[k][person]) taxData[k][person] = {...defaults[person]};
      else {
        for(const f of Object.keys(defaults[person])){
          if(taxData[k][person][f] === undefined) taxData[k][person][f] = defaults[person][f];
        }
      }
    }
  }
  return taxData[k];
}

// ATO FY2025/26 tax brackets (Stage 3 cuts)
function calcTax(taxable){
  if(taxable <= 0) return 0;
  let tax = 0;
  const brackets = [
    [18200,   0],
    [45000,   0.16],
    [135000,  0.30],
    [190000,  0.37],
    [Infinity, 0.45],
  ];
  let prev = 0;
  for(const [limit, rate] of brackets){
    if(taxable <= prev) break;
    const slice = Math.min(taxable, limit) - prev;
    tax += slice * rate;
    prev = limit;
  }
  // Medicare levy 2% (simplified — full levy above $26,000)
  if(taxable > 26000) tax += taxable * 0.02;
  return Math.round(tax * 100) / 100;
}

// Grossed-up dividend = cash / (1 - 0.30) * frankingPct/100

// HECS-HELP repayment rates FY2025/26
function calcHECS(income, hecsDebt){
  income = +income || 0;  // guard NaN
  if(!hecsDebt || hecsDebt <= 0) return 0;
  // HECS repayment thresholds FY2025/26
  const tiers = [
    [54435,  0.010], [62851,  0.020], [66621,  0.025], [70619,  0.030],
    [74856,  0.035], [79347,  0.040], [84068,  0.045], [89155,  0.050],
    [94503,  0.055], [100174, 0.060], [106185, 0.065], [112556, 0.070],
    [119310, 0.075], [126468, 0.080], [134048, 0.085], [142054, 0.090],
    [150529, 0.095], [Infinity, 0.100],
  ];
  const tier = tiers.find(([limit]) => income < limit);
  const rate = tier ? tier[1] : 0.10;
  if(income < 54435) return 0;
  const repayment = Math.round(income * rate);
  // ATO caps repayment at remaining debt balance
  return Math.min(repayment, hecsDebt);
}

// Medicare Levy Surcharge (MLS) — applies if NO private hospital cover
// Single threshold: $93,000 | Family threshold: $186,000
// Rate: 1.0% (<$108k), 1.25% (<$144k), 1.5% (>=$144k)
function calcMLS(income, familyIncome, hasPrivateHealth, dependants){
  // ATO Medicare Levy Surcharge FY2025/26
  if(hasPrivateHealth) return 0;

  const deps = Math.max(0, Math.round(+dependants||0));
  // Family threshold: $186,000 + $1,500 per child after the first
  const familyThreshold = 186000 + deps * 1500;  // ATO: $1,500 per dependent child
  const singleThreshold = 93000;

  const famIncome    = +familyIncome || +income;
  const familyTrig   = famIncome > familyThreshold;  // strictly greater
  const singleLiable = income > singleThreshold;

  if(!singleLiable && !familyTrig) return 0;

  // Rate tiers based on individual income
  let rate;
  if(income > 144000)      rate = 0.015;
  else if(income > 108000) rate = 0.0125;
  else                     rate = 0.010;  // includes family-triggered sub-threshold cases

  const rawMLS = income * rate;

  // Shading rule — singles only, income $93,001–$97,500:
  // MLS cannot exceed 10% of income above the single threshold
  if(!familyTrig && income <= 97500){
    const shadingCap = (income - singleThreshold) * 0.10;
    // Don't round shading result — small amounts near threshold can be < $1
    return Math.min(rawMLS, shadingCap);
  }

  return Math.round(rawMLS);
}



function grossUpDiv(amount, frankingPct){
  // Returns grossed-up dividend (cash + franking credit)
  if(!frankingPct || frankingPct <= 0) return +amount;
  const fc = +amount * (frankingPct / 100) * (30 / 70);
  return +(+amount + fc).toFixed(2);
}
function grossUpTotal(divArr){
  // Sum grossed-up amounts for an array of dividend objects
  return divArr.reduce((s,d)=>s+grossUpDiv(+d.amount||0, d.frankingPct||0),0);
}
function frankingCredit(amount, frankingPct){
  if(!frankingPct || frankingPct <= 0) return 0;
  const grossed = amount / (1 - 0.30) * (frankingPct / 100);
  return Math.round((grossed - amount * (frankingPct/100)) * 100) / 100;
}

function calcHECSRate(income){
  // ATO HECS-HELP repayment rates FY2025/26
  // https://www.ato.gov.au/individuals-and-families/study-and-training-support-loans
  const thresholds = [
    [54435,  0],       // below threshold — no repayment
    [62739,  0.010],
    [66153,  0.020],
    [70908,  0.025],
    [75424,  0.030],
    [80257,  0.035],
    [85352,  0.040],
    [90751,  0.045],
    [96549,  0.050],
    [102800, 0.055],
    [109309, 0.060],
    [116432, 0.065],
    [123766, 0.070],
    [131608, 0.075],
    [140028, 0.080],
    [148949, 0.085],
    [158560, 0.090],
    [168660, 0.095],
    [179467, 0.100],
    [Infinity, 0.100],
  ];
  for(const [limit, rate] of thresholds){
    if(income < limit) return rate;
  }
  return 0.100;
}


function renamePerson(key){
  if(key==='lumia'||key==='chilli'){ notify('Cannot rename built-in persons','err'); return; }
  const oldLabel = getPersonLabel(key);
  const newName = prompt('Rename "'+oldLabel+'" to:', oldLabel);
  if(!newName||!newName.trim()||newName.trim()===oldLabel) return;
  const newKey = newName.trim().toLowerCase().replace(/[^a-z0-9]/g,'_');
  if(getAllPersons().includes(newKey)&&newKey!==key){ notify('Name already exists','err'); return; }
  // Update stockOwners
  for(const sym of Object.keys(stockOwners)){
    if(stockOwners[sym]===key) stockOwners[sym]=newKey;
  }
  saveStockOwners();
  // Update extraPersons list
  const idx = extraPersons.indexOf(key);
  if(idx>=0) extraPersons[idx]=newKey;
  saveExtraPersons();
  renderOwnershipGrid();
  notify(oldLabel+' renamed to '+getPersonLabel(newKey)+' ✓');
}


function renderOwnershipGrid(){
  const grid = $('ownership-grid');
  const personsList = $('persons-list');
  if(!grid) return;

  // Show current persons as chips
  if(personsList){
    personsList.innerHTML = getAllPersons().map(p=>`
      <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;
        padding:3px 10px;border-radius:16px;
        background:${getPersonColour(p)}33;color:${getPersonColour(p)};
        font-family:var(--mono)">
        ${escHtml(getPersonLabel(p))}
        ${p!=='lumia'&&p!=='chilli'?`
          <button onclick="event.stopPropagation();renamePerson('${escHtml(p)}')"
            title="Rename" style="background:none;border:none;color:inherit;cursor:pointer;padding:0 2px;font-size:10px;opacity:0.7">✎</button>
          <button onclick="event.stopPropagation();removePerson('${escHtml(p)}')"
            title="Remove" style="background:none;border:none;color:inherit;cursor:pointer;padding:0 0 0 2px;font-size:12px">×</button>
        `:''}
      </span>`).join('');
  }

  // Show all holdings with owner select
  // Include current holdings AND all-time traded symbols (sold/worthless)
  const currentHoldings = calcH();
  const currentSyms = new Set(currentHoldings.map(h=>h.symbol));
  const allSyms = [...new Set(trades.map(t=>t.symbol).filter(Boolean))].sort();
  if(!allSyms.length){
    grid.innerHTML = '<div style="color:var(--text3);font-size:12px">No trades yet.</div>';
    return;
  }
  grid.innerHTML = allSyms.map(sym=>{
    const h = currentHoldings.find(x=>x.symbol===sym);
    const isCurrent = currentSyms.has(sym);
    const label = isCurrent
      ? escHtml(plainSymbol(sym))
      : escHtml(plainSymbol(sym)) + ' <span style="color:var(--text3);font-size:9px">(sold)</span>';
    const own = getSymbolOwner(sym);
    const col = getPersonColour(own);
    const drpS   = getDRPSettings()[sym] || { enabled:false, fractional:false };
    const drpOn  = drpS.enabled;
    const drpFrac= drpS.fractional;
    return `<div style="display:flex;flex-direction:column;gap:6px;
      padding:8px 12px;background:var(--surface);border-radius:6px;
      border:1px solid ${isCurrent?'var(--border)':'rgba(255,255,255,0.05)'};
      opacity:${isCurrent?'1':'0.65'}">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-family:var(--mono);font-size:12px;font-weight:600;
          flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">
          ${label}
        </span>
        <select style="background:${col}22;color:${col};border:1px solid ${col}55;
          border-radius:8px;padding:3px 8px;font-size:11px;font-family:var(--mono);cursor:pointer"
          onchange="changeSymbolOwnerSettings('${escHtml(sym)}',this.value)">
          ${buildOwnerOptions(own)}
          <option value="joint" ${own==='joint'?'selected':''}>Joint</option>
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:var(--text2);user-select:none"
          title="Enable Dividend Reinvestment Plan for this symbol">
          <input type="checkbox" ${drpOn?'checked':''} style="accent-color:var(--gold);width:14px;height:14px"
            onchange="setDRPFlag('${escHtml(sym)}','enabled',this.checked);renderOwnershipGrid()">
          <span style="color:${drpOn?'var(--gold)':'var(--text3)'};font-family:var(--mono)">DRP</span>
        </label>
        ${drpOn ? `
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:var(--text2);user-select:none"
          title="Allow fractional shares in DRP (some brokers support this)">
          <input type="checkbox" ${drpFrac?'checked':''} style="accent-color:var(--blue);width:14px;height:14px"
            onchange="setDRPFlag('${escHtml(sym)}','fractional',this.checked);renderOwnershipGrid()">
          <span style="color:${drpFrac?'var(--blue)':'var(--text3)'};font-family:var(--mono)">Fractional</span>
        </label>` : ''}
      </div>
    </div>`;
  }).join('');
}

function changeSymbolOwnerSettings(sym, newOwner){
  setSymbolOwner(sym, newOwner);
  renderOwnershipGrid();
  // Refresh any visible tabs
  if($('panel-holdings2')?.classList.contains('active')) renderHD();
  if($('panel-dividends')?.classList.contains('active')){ renderDividends(); renderDivCards(); }
  renderTax();
  notify(escHtml(plainSymbol(sym))+' → '+escHtml(getPersonLabel(newOwner))+' ✓');
}

function removePerson(key){
  if(key==='lumia'||key==='chilli'){ notify('Cannot remove built-in persons','err'); return; }
  if(!confirm('Remove '+getPersonLabel(key)+'? Their stocks will revert to Joint.')) return;
  extraPersons = extraPersons.filter(p=>p!==key);
  saveExtraPersons();
  // Reassign their stocks to joint
  for(const sym of Object.keys(stockOwners)){
    if(stockOwners[sym]===key) stockOwners[sym]='joint';
  }
  saveStockOwners();
  renderOwnershipGrid();
  renderTax();
  notify(getPersonLabel(key)+' removed ✓');
}


function renderTax(){
  const panel = document.getElementById('panel-tax');
  if(!panel) return;

  const fy = getTaxFY();
  const _d = new Date();
  const curFY = _d.getMonth() >= 6 ? _d.getFullYear()+1 : _d.getFullYear();
  const rec = getTaxRecord(fy);

  // ── FY selector ───────────────────────────────────────────────
  const fyOpts = Array.from({length:5},(_,i)=>curFY-i)
    .map(y=>`<option value="${y}" ${y===fy?'selected':''}>${y===curFY?'FY'+y+' (current)':'FY'+y}</option>`)
    .join('');

  // ── Compute CGT per person for this FY ────────────────────────
  const fyStart = new Date((fy-1)+'-07-01');
  const fyEnd   = new Date(fy+'-06-30');
  function inFY(d){ const dt=new Date(d); return dt>=fyStart&&dt<=fyEnd; }

  // Realised sells in this FY
  const sells = trades.filter(t=>t.type==='sell'&&inFY(t.date));

  // For each sell: find cost basis (match buys chronologically)
  function calcCGT(personSells){
    // personSells: each entry has a ._share property (1.0 = fully owned, 0.5 = joint)
    let shortGain=0, longGain=0, totalLoss=0;
    personSells.forEach(sell=>{
      const share = sell._share !== undefined ? sell._share : 1.0;
      // Find all buys of this symbol before sell date, sorted oldest first
      const buys = trades
        .filter(t=>(t.type==='buy'||t.type==='drp')&&t.symbol===sell.symbol&&t.date<sell.date)
        .sort((a,b)=>a.date.localeCompare(b.date));
      if(!buys.length) return;
      // FIFO cost basis for sold units
      let unitsToSell = +sell.units;
      let costBasis = 0;
      let heldOver12m = false;
      const sellDate = new Date(sell.date);
      for(const buy of buys){
        if(unitsToSell <= 0) break;
        const units = Math.min(+buy.units, unitsToSell);
        const avgCost = ((+buy.units * +buy.price) + (+buy.fees||0)) / +buy.units;
        costBasis += units * avgCost;
        unitsToSell -= units;
        // Check if held >12 months
        const buyDate = new Date(buy.date);
        const diff = (sellDate - buyDate) / (1000*60*60*24);
        if(diff >= 365) heldOver12m = true;
      }
      const proceeds = +sell.units * +sell.price - (+sell.fees||0);
      const gain = (proceeds - costBasis) * share;
      if(gain >= 0){
        // Apply 50% CGT discount if held >12 months
        const discounted = heldOver12m ? gain * 0.5 : gain;
        if(heldOver12m) longGain += discounted;
        else shortGain += gain;
      } else {
        totalLoss += Math.abs(gain);
      }
    });
    return { shortGain, longGain, totalLoss,
             netGain: Math.max(0, shortGain + longGain - totalLoss) };
  }

  // CGT attributed by stock ownership — each person only pays CGT on THEIR sells
  function personCGT(personKey) {
    const personSells = sells
      .filter(s => {
        const own = getSymbolOwner(s.symbol);
        return own === personKey || own === 'joint';
      })
      .map(s => ({
        ...s,
        _share: getSymbolOwner(s.symbol) === 'joint' ? 0.5 : 1.0
      }));
    return calcCGT(personSells);
  }
  // Shared CGT summary (for display totals) — sum of both persons' attributed gains
  const lumCGT = personCGT('lumia');
  const chiCGT = personCGT('chilli');
  const cgt = {
    netGain:    lumCGT.netGain + chiCGT.netGain,
    totalLoss:  lumCGT.totalLoss + chiCGT.totalLoss,
    shortGain:  lumCGT.shortGain + chiCGT.shortGain,
    longGain:   lumCGT.longGain + chiCGT.longGain,
  };

  // ── Dividends in FY — attributed by stock ownership ────────────
  // DRP dividends ARE assessable income (ATO: reinvestment doesn't change taxability)
  // Include all dividend types: dividend, distribution, drp, interest
  // Exclude: staking, airdrop (different tax treatment)
  const fyDivs = dividends.filter(d=>inFY(d.date)&&
    ['dividend','distribution','drp','interest'].includes(d.type));
  // Build per-person dividend totals based on stock ownership
  function personDivs(personKey){
    return fyDivs.filter(d=>{
      const own = getSymbolOwner(d.symbol);
      return own===personKey || own==='joint';
    });
  }
  function personDivShare(d, personKey){
    const own = getSymbolOwner(d.symbol);
    return own==='joint' ? 0.5 : 1.0;
  }
  const totalDiv   = fyDivs.reduce((s,d)=>s+(+d.amount||0),0);
  const totalFrank = fyDivs.reduce((s,d)=>s+frankingCredit(+d.amount||0, d.frankingPct||0),0);

  // ── Property P&L per person ───────────────────────────────────
  function propPnL(owner){
    let netRent=0, netExpenses=0, investInterest=0;
    properties.forEach(p=>{
      const pOwner = p.owner || 'joint';
      const isOwner = pOwner===owner || pOwner==='joint';
      if(!isOwner) return;
      const share = pOwner==='joint' ? 0.5 : 1;

      // Always scan splits for investment-purpose interest — even on PPOR.
      // Investment loan interest (e.g. redraw used to buy shares) is deductible
      // against investment income regardless of property type.
      let rentalInterest = 0, invInterest = 0;
      (normaliseSplits(p)).forEach(sp => {
        const purpose = sp.purpose || 'rental';
        const bal = +sp.balance||0, off = +sp.offset||0, rate = +sp.rate||0;
        const annInt = Math.max(0, bal - off) * (rate/100);
        if(purpose === 'investment') invInterest  += annInt;
        else if(purpose === 'rental') rentalInterest += annInt;
        // personal: not deductible — skip
      });
      investInterest += invInterest * share;

      // PPOR: no rental income, no rental deductions — stop here.
      if(p.propType === 'ppor') return;

      const annualRent = (p.weeklyRent||0)*52*share;
      const pRec = rec.props[p.id] || {};
      const expenses = share*(
        (+pRec.rates||0)+(+pRec.insurance||0)+(+pRec.repairs||0)+
        (+pRec.agent||0)+(+pRec.other||0)+(+pRec.depr_bldg||0)+(+pRec.depr_pe||0)
      ) + rentalInterest * share;

      netRent     += annualRent;
      netExpenses += expenses;
    });
    return { netRent, netExpenses, investInterest,
             netPropLoss: Math.max(0, netExpenses-netRent),
             netPropGain: Math.max(0, netRent-netExpenses) };
  }

  // ── Tax calc per person ───────────────────────────────────────
  function personTax(personKey, propPnLResult, cgtResult){
    const p = rec[personKey] || {};
    const salary      = +p.salary      || 0;
    const withheld    = +p.withheld    || 0;
    const payg        = +p.payg        || 0;
    const hecsDebt    = +p.hecs        || 0;
    const sacrifice   = +p.sacrifice   || 0;  // pre-tax salary sacrifice to super
    const hasPrivH    = !!(p.privateHealth || rec.privateHealthFamily);
    const { netPropLoss, netPropGain, netRent, netExpenses } = propPnLResult;
    const myCGT    = cgtResult.netGain;  // already attributed to this person only
    // Dividends attributed by actual stock ownership (not 50/50)
    const _myDivs  = fyDivs.filter(d=>{
      const own = getSymbolOwner(d.symbol);
      return own===personKey || own==='joint';
    });
    const myDiv    = _myDivs.reduce((s,d)=>{
      const share = getSymbolOwner(d.symbol)==='joint' ? 0.5 : 1.0;
      return s+(+d.amount||0)*share;
    },0);
    const myFrank  = _myDivs.reduce((s,d)=>{
      const share = getSymbolOwner(d.symbol)==='joint' ? 0.5 : 1.0;
      return s+frankingCredit((+d.amount||0)*share, d.frankingPct||0);
    },0);
    // Salary sacrifice reduces taxable income
    // Investment interest (e.g. loan used to buy shares) deducted from dividend income
    const investInterestDeduction = propPnLResult.investInterest || 0;
    const taxableIncome = (salary - sacrifice) + myDiv + myFrank - investInterestDeduction + netPropGain - netPropLoss + myCGT;
    const grossTax  = calcTax(Math.max(0, taxableIncome));
    // Medicare levy (2% — already baked into calcTax, extracted here for display)
    const medicareLevy = Math.max(0, taxableIncome) > 26000
      ? Math.round(Math.max(0, taxableIncome) * 0.02 * 100) / 100 : 0;
    const hecsRep   = calcHECS(Math.max(0, taxableIncome), hecsDebt);
    // Division 293: extra 15% tax on concessional contributions if income > $250,000
    // Concessional contributions = employer SG (est. 12% of salary) + salary sacrifice
    // SG rate: FY-aware (11.5% to Jun 2025, 12% from Jul 2025)
    const sgRate       = fy >= 2026 ? 0.120 : 0.115;
    // Use manual empSG if entered, else estimate from salary × sgRate
    const empSGManual  = +p.empSG || 0;
    const empSuper     = empSGManual > 0 ? empSGManual : salary * sgRate;
    const totalConcess = empSuper + sacrifice;
    // RFB: reportable fringe benefits (grossed-up, from income statement)
    const rfb = +p.rfb || 0;
    // Total net investment loss (ATO s293-20 / MLS income tests)
    // = amount by which financial investment deductions exceed investment income
    // (rental losses are NOT included — they're a separate category)
    const netInvIncome      = myDiv + myFrank;
    const totalNetInvLoss   = Math.max(0, investInterestDeduction - netInvIncome);
    // Div293 income (ATO s293-20):
    // = taxable income + RFB + reportable employer super + total net investment loss
    const div293Income    = taxableIncome + rfb + totalConcess + totalNetInvLoss;
    const div293Threshold = 250000;
    let div293 = 0;
    if(div293Income > div293Threshold && totalConcess > 0){
      const excess = div293Income - div293Threshold;
      div293 = Math.round(Math.min(totalConcess, excess) * 0.15);
    }
    const otherKey     = personKey === 'lumia' ? 'chilli' : 'lumia';
    const otherSalary  = +rec[otherKey]?.salary||0;
    const otherSacr    = +rec[otherKey]?.sacrifice||0;
    const _otherDivs   = personDivs(otherKey);
    const otherDiv     = _otherDivs.reduce((s,d)=>s+(+d.amount||0)*personDivShare(d,otherKey),0);
    // ATO: family income for MLS includes net rental of both persons
    const otherPropResult = propPnL(otherKey);
    const otherRental  = otherPropResult.netPropGain - otherPropResult.netPropLoss;
    const otherRFB     = +rec[otherKey]?.rfb || 0;
    const otherTI      = (otherSalary - otherSacr) + otherDiv + otherRental + otherRFB;
    // MLS family income includes RFB and net investment loss for each person
    const familyIncome = (taxableIncome + rfb + totalNetInvLoss) + (otherTI);
    const deps         = +(rec.dependants||0);
    const mls          = calcMLS(taxableIncome, familyIncome, hasPrivH, deps);
    const totalLiability = grossTax + hecsRep + mls + div293;
    const netTax    = Math.max(0, totalLiability - withheld - payg - myFrank);
    const refund    = Math.max(0, withheld + payg + myFrank - totalLiability);
    return { salary, withheld, payg, sacrifice, rfb, myDiv, myFrank, investInterestDeduction, totalNetInvLoss, empSGManual, empSuper, sgRate, totalConcess, div293Income, div293Threshold:250000, medicareLevy,
             netPropLoss, netPropGain, netRent, netExpenses,
             myCGT, taxableIncome, grossTax, medicareLevy, hecsRep, mls, div293,
             totalLiability, netTax, refund, hecsDebt, hasPrivH };
  }

  const lumProp   = propPnL('lumia');
  const chiProp   = propPnL('chilli');

  const lumTax    = personTax('lumia',  lumProp,  lumCGT);
  const chiTax    = personTax('chilli', chiProp,  chiCGT);

  // ── Property expense inputs per property ─────────────────────
  const propInputs = properties.length ? properties.map(p=>{
    const share = p.owner==='joint'?0.5:1;
    const pRec = rec.props[p.id] || {};
    const ownerLabel = {lumia:'Lumia',chilli:'Chilli',joint:'Joint 50/50'}[p.owner||'lumia']||'Lumia';
    const fi = (field,label,placeholder) => {
      const fid = `tp-${p.id}-${field}-${fy}`;
      return `<div style="position:relative"><label style="font-size:10px;color:var(--text3)">${label}</label>
       <input type="text" inputmode="text" class="fi tax-prop-inp" style="padding:3px 6px" id="${fid}"
         data-propid="${p.id}" data-field="${field}" data-fy="${fy}"
         data-prior="${pRec[field]||0}" data-committed="${pRec[field]||0}"
         placeholder="${placeholder} or +450" value="${pRec[field]||''}"
         onfocus="mathInpInit(this)"
         oninput="mathInpInput(this)"
         onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();this._saveFn=v=>{taxPropUpdate2(this,v);};mathInpCommit(this,this._saveFn);if(event.key==='Tab'){const n=this.closest('div').nextElementSibling?.querySelector('input');if(n)n.focus();}}"
         onblur="mathInpHint(this);if(this.value&&this.value.trim().match(/^[\d.]+$/)){taxPropUpdate2(this,parseFloat(this.value)||0);renderTax();}"
         onkeyup="if(event.key==='Escape'){this.value=this.dataset.prior||'';mathInpHint(this);}"
       ></div>`;
    };
    // Compute live rental summary for this property for diagnostic display
    const _m = propMetrics(p);
    const _annRent = (p.weeklyRent||0)*52*share;
    const _annInt  = _m.monthlyInterest*12*share;
    const _nonInt  = share*((+pRec.rates||0)+(+pRec.insurance||0)+(+pRec.repairs||0)+(+pRec.agent||0)+(+pRec.other||0)+(+pRec.depr_bldg||0)+(+pRec.depr_pe||0));
    const _totalExp = _nonInt + _annInt;
    const _netResult = _annRent - _totalExp;
    const _resultStr = _netResult >= 0 ? '+'+n2(_netResult) : '-'+n2(Math.abs(_netResult));
    const _resultColour = _netResult >= 0 ? 'var(--pos)' : 'var(--neg)';
    const _isPPOR = p.propType === 'ppor';
    return `<div class="fs" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <div style="font-family:var(--mono);font-size:13px;font-weight:600">${escHtml(p.name)}</div>
        <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(59,130,246,0.15);color:#60a5fa">${ownerLabel}${p.owner==='joint'?' — each 50%':''}</span>
        ${_isPPOR
          ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(239,68,68,0.15);color:var(--neg)">PPOR — excluded from rental tax calc</span>`
          : `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(0,0,0,0.2);font-family:var(--mono);color:${_resultColour}">
             Rent ${n2(_annRent)} · Expenses ${n2(_totalExp)} · Net <b>${_resultStr}</b> per owner
           </span>`
        }
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">
        ${fi('rates','Council Rates','$')}
        ${fi('insurance','Insurance','$')}
        ${fi('repairs','Repairs & Maintenance','$')}
        ${fi('agent','Agent Fees','$')}
        ${fi('other','Other Expenses','$')}
        ${fi('depr_bldg','Depreciation — Building','$')}
        ${fi('depr_pe','Depreciation — Plant & Equipment','$')}
      </div>
    </div>`;
  }).join('') : '<div style="color:var(--text3);font-size:12px">No properties added yet.</div>';

  // ── Render ────────────────────────────────────────────────────
  const row = (label, lumVal, chiVal, cls='', note='') =>
    `<tr ${cls?'class="'+cls+'"':''}>
      <td style="color:var(--text3);font-size:12px;padding:5px 8px">${label}${note?'<span style="color:var(--text3);font-size:10px"> '+note+'</span>':''}</td>
      <td style="font-family:var(--mono);font-size:12px;text-align:right;padding:5px 8px">${lumVal}</td>
      <td style="font-family:var(--mono);font-size:12px;text-align:right;padding:5px 8px">${chiVal}</td>
    </tr>`;

  const sp = (v,cls)=>`<span class="${cls||''}">${v}</span>`;


  panel.innerHTML = `
  <!-- FY selector -->
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap">
    <div style="font-family:var(--mono);font-size:13px;font-weight:600">🧾 TAX ESTIMATE</div>
    <select class="fsm" onchange="taxFY=+this.value;renderTax()">${fyOpts}</select>
    <span style="font-size:11px;color:var(--text3)">Australian tax law · Estimates only · Not financial advice</span>
  </div>

  <!-- Side by side income inputs -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px">
    ${['lumia','chilli'].map((person,pi)=>{
      const pRec = rec[person] || {};
      const name = person==='lumia'?'Lumia':'Chilli';
      const col  = person==='lumia'?'#60a5fa':'#f472b6';
      return `<div class="fs">
        <div style="font-family:var(--mono);font-size:13px;font-weight:600;color:${col};margin-bottom:12px">${name}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><label class="fl">Gross Salary (AUD)</label>
            <input type="text" inputmode="text" class="fi math-tax-inp" style="padding:4px 8px"
              placeholder="e.g. 85000 or +/-" value="${pRec.salary||''}" id="ti-${person}-salary-${fy}" data-prior="${pRec.salary||0}" data-committed="${pRec.salary||0}"
              onfocus="mathInpInit(this)"
              oninput="mathInpInput(this)"
              onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();mathInpCommit(this,v=>taxInpSave('${person}','salary',v,${fy}));}"
              onkeyup="if(event.key==='Escape'){this.value=this.dataset.prior||'';mathInpHint(this);}"
              onblur="mathInpHint(this);if(this.value&&this.value.trim().match(/^[\d.]+$/))taxInpSave('${person}','salary',parseFloat(this.value)||0,${fy});"></div>
          <div><label class="fl">Tax Withheld (PAYG)</label>
            <input type="text" inputmode="text" class="fi math-tax-inp" style="padding:4px 8px"
              placeholder="e.g. 22000 or +/-" value="${pRec.withheld||''}" id="ti-${person}-withheld-${fy}" data-prior="${pRec.withheld||0}" data-committed="${pRec.withheld||0}"
              onfocus="mathInpInit(this)"
              oninput="mathInpInput(this)"
              onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();mathInpCommit(this,v=>taxInpSave('${person}','withheld',v,${fy}));}"
              onkeyup="if(event.key==='Escape'){this.value=this.dataset.prior||'';mathInpHint(this);}"
              onblur="mathInpHint(this);if(this.value&&this.value.trim().match(/^[\d.]+$/))taxInpSave('${person}','withheld',parseFloat(this.value)||0,${fy});">
            ${(()=>{
              const s = +pRec.salary||0;
              const w = +pRec.withheld||0;
              if(!s||!w) return '';
              const pct = (w/s*100).toFixed(1);
              const clr = w/s > 0.35 ? 'var(--red)' : w/s > 0.25 ? 'var(--gold)' : 'var(--green)';
              return `<div style="margin-top:4px;font-size:11px;font-family:var(--mono);color:${clr}">`
                + `${pct}% of gross salary</div>`;
            })()}
            </div>
          <div><label class="fl">PAYG Instalments</label>
            <input type="text" inputmode="text" class="fi math-tax-inp" style="padding:4px 8px"
              placeholder="e.g. 0 or +/-" value="${pRec.payg||''}" id="ti-${person}-payg-${fy}" data-prior="${pRec.payg||0}" data-committed="${pRec.payg||0}"
              onfocus="mathInpInit(this)"
              oninput="mathInpInput(this)"
              onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();mathInpCommit(this,v=>taxInpSave('${person}','payg',v,${fy}));}"
              onkeyup="if(event.key==='Escape'){this.value=this.dataset.prior||'';mathInpHint(this);}"
              onblur="mathInpHint(this);if(this.value&&this.value.trim().match(/^[\d.]+$/))taxInpSave('${person}','payg',parseFloat(this.value)||0,${fy});"></div>
          <div>
            <label class="fl">Reportable Fringe Benefits
              <span style="color:var(--text3);font-size:10px">(grossed-up &middot; from income statement)</span>
            </label>
            <input type="text" inputmode="text" class="fi math-tax-inp" style="padding:4px 8px"
              placeholder="e.g. 15000 or leave blank" value="${pRec.rfb||''}" id="ti-${person}-rfb-${fy}" data-prior="${pRec.rfb||0}" data-committed="${pRec.rfb||0}"
              onfocus="mathInpInit(this)"
              oninput="mathInpInput(this)"
              onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();mathInpCommit(this,v=>taxInpSave('${person}','rfb',v,${fy}));}"
              onkeyup="if(event.key==='Escape'){this.value=this.dataset.prior||'';mathInpHint(this);}"
              onblur="mathInpHint(this);if(this.value&&this.value.trim().match(/^[\d.]+$/))taxInpSave('${person}','rfb',parseFloat(this.value)||0,${fy});">
          </div>
          <div style="grid-column:1/-1">
            <label class="fl">Salary Sacrifice to Super
              <span style="color:var(--text3);font-size:10px">(pre-tax · reduces taxable income)</span>
            </label>
            <input type="text" inputmode="text" class="fi math-tax-inp" style="padding:4px 8px"
              placeholder="e.g. 10000 — leave blank if none or +/-" value="${pRec.sacrifice||''}" id="ti-${person}-sacrifice-${fy}" data-prior="${pRec.sacrifice||0}" data-committed="${pRec.sacrifice||0}"
              onfocus="mathInpInit(this)"
              oninput="mathInpInput(this)"
              onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();mathInpCommit(this,v=>taxInpSave('${person}','sacrifice',v,${fy}));}"
              onkeyup="if(event.key==='Escape'){this.value=this.dataset.prior||'';mathInpHint(this);}"
              onblur="mathInpHint(this);if(this.value&&this.value.trim().match(/^[\d.]+$/))taxInpSave('${person}','sacrifice',parseFloat(this.value)||0,${fy});">
            ${+pRec.sacrifice>0?`<div style="font-size:10px;color:var(--pos);margin-top:3px">✓ Reduces taxable income by ${n2(+pRec.sacrifice)}</div>`:''}
          </div>
          <div style="grid-column:1/-1">
            <label class="fl">HECS-HELP Debt (current balance)
              ${(+pRec.hecs>0&&+pRec.salary>0)?
                `<span style="color:var(--neg);font-family:var(--mono);font-size:10px;margin-left:8px">est. repayment ${n2(calcHECS(+pRec.salary,+pRec.hecs))}/yr</span>`:
                `<span style="color:var(--text3);font-size:10px;margin-left:8px">enter salary + balance to estimate</span>`}
            </label>
            <input type="text" inputmode="text" class="fi math-tax-inp" style="padding:4px 8px"
              placeholder="e.g. 28000 — leave blank if none or +/-" value="${pRec.hecs||''}" id="ti-${person}-hecs-${fy}" data-prior="${pRec.hecs||0}" data-committed="${pRec.hecs||0}"
              onfocus="mathInpInit(this)"
              oninput="mathInpInput(this)"
              onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();mathInpCommit(this,v=>taxInpSave('${person}','hecs',v,${fy}));}"
              onkeyup="if(event.key==='Escape'){this.value=this.dataset.prior||'';mathInpHint(this);}"
              onblur="mathInpHint(this);if(this.value&&this.value.trim().match(/^[\d.]+$/))taxInpSave('${person}','hecs',parseFloat(this.value)||0,${fy});">
          </div>
          <div style="grid-column:1/-1">
            <label class="fl">Employer Super (SG)
              <span style="color:var(--text3);font-size:10px;margin-left:8px">
                leave blank to use estimated ${(()=>{const fyN=+fy;return fyN>=2027?'12':fyN>=2026?'12':'11.5';})()}% SG
              </span>
            </label>
            <input type="text" inputmode="text" class="fi math-tax-inp" style="padding:4px 8px"
              placeholder="e.g. 11500 — or leave blank for auto-calc" value="${pRec.empSG||''}" id="ti-${person}-empSG-${fy}" data-prior="${pRec.empSG||0}" data-committed="${pRec.empSG||0}"
              onfocus="mathInpInit(this)"
              oninput="mathInpInput(this)"
              onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();mathInpCommit(this,v=>taxInpSave('${person}','empSG',v,${fy}));}"
              onkeyup="if(event.key==='Escape'){this.value=this.dataset.prior||'';mathInpHint(this);}"
              onblur="mathInpHint(this);if(this.value&&this.value.trim().match(/^[\d.]+$/))taxInpSave('${person}','empSG',parseFloat(this.value)||0,${fy});">
          </div>
          <div style="grid-column:1/-1;margin-top:6px;padding:8px 10px;
               background:rgba(255,255,255,0.03);border-radius:5px;border:1px solid var(--border)">
            <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer">
              <input type="checkbox" id="chk-privhealth-${person}"
                style="margin-top:2px;width:15px;height:15px;flex-shrink:0"
                ${pRec.privateHealth?'checked':''}
                onchange="taxInpUpdate('${person}','privateHealth',this.checked,${fy})">
              <span style="font-size:12px">
                <span style="color:var(--text2);font-weight:500">Has private hospital cover</span>
                ${!pRec.privateHealth&&(+pRec.salary>93000)?
                  `<span style="display:block;color:var(--neg);font-size:11px;margin-top:2px">⚠ MLS applies — income >$93k with no private cover</span>`:''}
                ${pRec.privateHealth?
                  `<span style="display:block;color:var(--pos);font-size:11px;margin-top:2px">✓ Exempt from Medicare Levy Surcharge</span>`:''}
              </span>
            </label>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>

  <!-- Family private health toggle -->
  <div class="fs" style="margin-bottom:12px;padding:10px 14px">
    <div style="display:flex;align-items:center;gap:10px">
      <input type="checkbox" id="chk-privhealth-family" ${rec.privateHealthFamily?'checked':''}
        onchange="taxFamilyUpdate('privateHealthFamily',this.checked,${fy})">
      <label for="chk-privhealth-family" style="font-size:12px;color:var(--text2);cursor:pointer">
        <b>Family private hospital cover</b> — both persons covered under one policy
        (overrides individual settings above for MLS calculation)
      </label>
    </div>
    <div style="font-size:10px;color:var(--text3);margin-top:6px;margin-left:28px">
      MLS applies if combined family income ≥ $186,000 and no hospital cover.
      Rates: 1.0% ($93k–$108k) · 1.25% ($108k–$144k) · 1.5% ($144k+)
    </div>
  </div>

  <!-- Family / Dependants -->
  <div class="fs" style="margin-bottom:18px">
    <div class="fst">👨‍👩‍👧 Family Details</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label class="fl">Dependant Children
          <span style="color:var(--text3);font-size:10px">(adds $1,500/child to MLS family threshold)</span>
        </label>
        <input type="number" class="fi" style="padding:4px 8px" min="0" max="20" step="1"
          placeholder="0" value="${rec.dependants||''}"
          oninput="taxRecSave('dependants',+this.value,${fy})" onblur="renderTax()">
      </div>
      <div style="padding:8px 0;font-size:11px;color:var(--text3)">
        MLS family threshold: ${n2(186000+Math.max(0,(+(rec.dependants||0)-1))*1500)}
        (base $186,000${+(rec.dependants||0)>1?' + '+n2(Math.max(0,+(rec.dependants||0)-1)*1500)+' for '+Math.max(0,+(rec.dependants||0)-1)+' extra child'+(Math.max(0,+(rec.dependants||0)-1)>1?'ren':''):''})
      </div>
    </div>
  </div>

  <!-- Property expense inputs -->
  <div class="fs" style="margin-bottom:18px">
    <div class="fst">🏠 Property Expenses — FY${fy}</div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:14px">Enter full annual amounts. Joint properties are split 50/50 automatically.</div>
    ${propInputs}
  </div>

  <!-- Tax summary table -->
  <div class="fs" style="margin-bottom:18px">
    <div class="fst">📊 Tax Summary — FY${fy}</div>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;font-size:11px;color:var(--text3);font-weight:400">Item</th>
        <th style="text-align:right;padding:6px 8px;font-size:12px;font-family:var(--mono);color:#60a5fa">Lumia</th>
        <th style="text-align:right;padding:6px 8px;font-size:12px;font-family:var(--mono);color:#f472b6">Chilli</th>
      </tr></thead>
      <tbody>
        ${row('Gross Salary',n2(lumTax.salary),n2(chiTax.salary))}
        ${(lumTax.rfb>0||chiTax.rfb>0)?row('Reportable Fringe Benefits',
          lumTax.rfb>0?'+'+n2(lumTax.rfb):'—',
          chiTax.rfb>0?'+'+n2(chiTax.rfb):'—',
          '','not taxable income — used for Div293 & MLS threshold tests only'):''}
        ${`<tr>
          <td style='color:var(--text3);font-size:12px;padding:5px 8px'>Dividend Income (cash)<span style='color:var(--text3);font-size:10px'> from dividends tab</span></td>
          <td style='font-family:var(--mono);font-size:12px;text-align:right;padding:5px 8px;cursor:pointer;text-decoration:underline dotted;color:var(--green)' onclick='taxDrillDividends("lumia",${fy})' title='Click to see these dividends'>${n2(lumTax.myDiv)}</td>
          <td style='font-family:var(--mono);font-size:12px;text-align:right;padding:5px 8px;cursor:pointer;text-decoration:underline dotted;color:var(--green)' onclick='taxDrillDividends("chilli",${fy})' title='Click to see these dividends'>${n2(chiTax.myDiv)}</td>
        </tr>`}
        ${`<tr class='pos'>
          <td style='color:var(--text3);font-size:12px;padding:5px 8px'>Franking Credits</td>
          <td style='font-family:var(--mono);font-size:12px;text-align:right;padding:5px 8px;cursor:pointer;text-decoration:underline dotted' onclick='taxDrillDividends("lumia",${fy})' title='Click to see franked dividends'>+${n2(lumTax.myFrank)}</td>
          <td style='font-family:var(--mono);font-size:12px;text-align:right;padding:5px 8px;cursor:pointer;text-decoration:underline dotted' onclick='taxDrillDividends("chilli",${fy})' title='Click to see franked dividends'>+${n2(chiTax.myFrank)}</td>
        </tr>`}
        ${(lumTax.investInterestDeduction>0||chiTax.investInterestDeduction>0)?row(
          'Investment Interest Deduction',
          lumTax.investInterestDeduction>0?'-'+n2(lumTax.investInterestDeduction):'—',
          chiTax.investInterestDeduction>0?'-'+n2(chiTax.investInterestDeduction):'—',
          'neg','interest on loan used to buy investments'
        ):''}
        ${(lumTax.totalNetInvLoss>0||chiTax.totalNetInvLoss>0)?row(
          '  └ Net Investment Loss (added back for Div293/MLS)',
          lumTax.totalNetInvLoss>0?n2(lumTax.totalNetInvLoss):'—',
          chiTax.totalNetInvLoss>0?n2(chiTax.totalNetInvLoss):'—',
          '','not added to taxable income — used for Div293 & MLS threshold tests only'):''}
        ${row('Net Rental Income',lumTax.netRent>lumTax.netExpenses?'+'+n2(lumTax.netRent-lumTax.netExpenses):'—',chiTax.netRent>chiTax.netExpenses?'+'+n2(chiTax.netRent-chiTax.netExpenses):'—')}
        ${row('Rental Loss (negative gearing)',lumTax.netPropLoss>0?'-'+n2(lumTax.netPropLoss):'—',chiTax.netPropLoss>0?'-'+n2(chiTax.netPropLoss):'—','neg')}
        ${row('Net Capital Gain (after 50% disc)',n2(lumTax.myCGT),n2(chiTax.myCGT),'',cgt.totalLoss>0?'capital losses: -'+n2(cgt.totalLoss):'')}
        <tr style="border-top:1px solid var(--border)">
          <td style="font-size:12px;font-weight:600;padding:6px 8px">Taxable Income</td>
          <td style="font-family:var(--mono);font-size:13px;font-weight:600;text-align:right;padding:6px 8px">
            ${n2(Math.max(0,lumTax.taxableIncome))}
            ${lumTax.sacrifice>0?`<div style='font-size:10px;color:var(--text3)'>(pre-sacrifice: ${n2(lumTax.salary)})</div>`:''}
          </td>
          <td style="font-family:var(--mono);font-size:13px;font-weight:600;text-align:right;padding:6px 8px">
            ${n2(Math.max(0,chiTax.taxableIncome))}
            ${chiTax.sacrifice>0?`<div style='font-size:10px;color:var(--text3)'>(pre-sacrifice: ${n2(chiTax.salary)})</div>`:''}
          </td>
        </tr>
        ${lumTax.sacrifice>0||chiTax.sacrifice>0?row('Salary Sacrifice',
          lumTax.sacrifice>0?'-'+n2(lumTax.sacrifice):'—',
          chiTax.sacrifice>0?'-'+n2(chiTax.sacrifice):'—','neg','reduces taxable income'):''}
        ${row('Gross Tax Payable',n2(lumTax.grossTax),n2(chiTax.grossTax))}
        ${row('  └ Medicare Levy (2%)',
          lumTax.medicareLevy>0?n2(lumTax.medicareLevy):'—',
          chiTax.medicareLevy>0?n2(chiTax.medicareLevy):'—',
          'neg','included in gross tax above')}
        ${row('Effective Tax Rate',
          lumTax.taxableIncome>0 ? (lumTax.grossTax/lumTax.taxableIncome*100).toFixed(1)+'%' : '—',
          chiTax.taxableIncome>0 ? (chiTax.grossTax/chiTax.taxableIncome*100).toFixed(1)+'%' : '—',
          '','% of taxable income'
        )}
        ${row('PAYG Withholding Rate',
          lumTax.salary>0 ? (lumTax.withheld/lumTax.salary*100).toFixed(1)+'%' : '—',
          chiTax.salary>0 ? (chiTax.withheld/chiTax.salary*100).toFixed(1)+'%' : '—',
          '','% of gross salary withheld by employer'
        )}
${(()=>{
          if(!lumTax.div293&&!chiTax.div293) return '';
          // Store breakdown data for popup (avoids JSON.stringify in onclick)
          window.__div293 = window.__div293 || {};
          window.__div293['lumia']  = {...lumTax,  personLabel: getPersonLabel('lumia')};
          window.__div293['chilli'] = {...chiTax, personLabel: getPersonLabel('chilli')};
          const lumD293Cell = lumTax.div293>0
            ? `<td style="font-family:var(--mono);font-size:12px;text-align:right;padding:5px 8px;cursor:pointer;text-decoration:underline dotted"
                 data-div293="lumia" title="Click to see calculation">${n2(lumTax.div293)}</td>`
            : `<td style="font-family:var(--mono);font-size:12px;text-align:right;padding:5px 8px">—</td>`;
          const chiD293Cell = chiTax.div293>0
            ? `<td style="font-family:var(--mono);font-size:12px;text-align:right;padding:5px 8px;cursor:pointer;text-decoration:underline dotted"
                 data-div293="chilli" title="Click to see calculation">${n2(chiTax.div293)}</td>`
            : `<td style="font-family:var(--mono);font-size:12px;text-align:right;padding:5px 8px">—</td>`;
          return `<tr class='neg'>
          <td style='color:var(--text3);font-size:12px;padding:5px 8px'>
            Division 293 Tax
            <span style='color:var(--text3);font-size:10px'> extra 15% on super · income &gt;$250k</span>
          </td>
          ${lumD293Cell}
          ${chiD293Cell}
        </tr>`;
        })()}
      ${(lumTax.hecsRep>0||chiTax.hecsRep>0)?row('HECS-HELP Repayment',
        lumTax.hecsRep>0?n2(lumTax.hecsRep):'—',
        chiTax.hecsRep>0?n2(chiTax.hecsRep):'—'):''
      }
      ${(lumTax.mls>0||chiTax.mls>0)?row('Medicare Levy Surcharge',
        lumTax.mls>0?n2(lumTax.mls)+'<span style="font-size:10px;color:var(--neg)"> (no priv. health)</span>':'—',
        chiTax.mls>0?n2(chiTax.mls)+'<span style="font-size:10px;color:var(--neg)"> (no priv. health)</span>':'—'):''
      }
        ${row('Less: Tax Withheld','-'+n2(lumTax.withheld),'-'+n2(chiTax.withheld),'neg')}
        ${row('Less: PAYG Instalments',lumTax.payg?'-'+n2(lumTax.payg):'—',chiTax.payg?'-'+n2(chiTax.payg):'—','neg')}
        ${row('Less: Franking Credits','-'+n2(lumTax.myFrank),'-'+n2(chiTax.myFrank),'neg')}
        <tr style="border-top:2px solid var(--border);background:rgba(255,255,255,0.03)">
          <td style="font-size:13px;font-weight:700;padding:8px 8px">
            ${lumTax.refund>0||chiTax.refund>0?'Estimated Refund':'Estimated Tax Owing'}</td>
          <td style="font-family:var(--mono);font-size:15px;font-weight:700;text-align:right;padding:8px 8px" class="${lumTax.refund>0?'pos':'neg'}">
            <span class="${lumTax.refund>0?'pos':'neg'}">${lumTax.refund>0?'REFUND '+n2(lumTax.refund):'OWING '+n2(lumTax.netTax)}</span></td>
          <td style="font-family:var(--mono);font-size:15px;font-weight:700;text-align:right;padding:8px 8px">
            <span class="${chiTax.refund>0?'pos':'neg'}">${chiTax.refund>0?'REFUND '+n2(chiTax.refund):'OWING '+n2(chiTax.netTax)}</span></td>
        </tr>
      </tbody>
    </table>
    </div>
    <div style="margin-top:10px;font-size:10px;color:var(--text3)">
      ⚠ Estimates only. CGT split 50/50 between persons. Dividends split 50/50. FY2025/26 Stage 3 rates + 2% Medicare levy. MLS applies if family income &gt; $186,000 and no private hospital cover. HECS uses ATO FY2025/26 repayment rates. Consult your accountant.
    </div>
  </div>`;

}

function taxFamilyUpdate(field, val, fy){
  const k = taxKey(fy);
  if(!taxData[k]) getTaxRecord(fy);
  taxData[k][field] = val;
  saveTaxData();
  renderTax();
}

function taxInpSave(person, field, val, fy){
  // Save only — no re-render (keeps keyboard open on mobile)
  const k = taxKey(fy);
  if(!taxData[k]) getTaxRecord(fy);
  if(!taxData[k][person]) taxData[k][person] = {};
  taxData[k][person][field] = isNaN(val) ? 0 : val;
  saveTaxData();
}

function taxRecSave(field, val, fy){
  // Save only — no re-render
  const k = taxKey(fy);
  if(!taxData[k]) getTaxRecord(fy);
  taxData[k][field] = isNaN(val) ? 0 : val;
  saveTaxData();
}


function taxInpUpdate(person, field, val, fy){
  const k = taxKey(fy);
  if(!taxData[k]) getTaxRecord(fy);
  if(!taxData[k][person]) taxData[k][person] = {};
  taxData[k][person][field] = val;  // val is number or boolean
  saveTaxData();
  renderTax();
}

function taxRecUpdate(field, val, fy){
  const k = taxKey(fy);
  if(!taxData[k]) getTaxRecord(fy);
  taxData[k][field] = val;
  saveTaxData();
  renderTax();
}

function taxPropUpdate2(inp, val){
  const propId = inp.dataset.propid;
  const field  = inp.dataset.field;
  const fy     = +inp.dataset.fy;
  const k = taxKey(fy);
  if(!taxData[k]) getTaxRecord(fy);
  if(!taxData[k].props) taxData[k].props = {};
  if(!taxData[k].props[propId]) taxData[k].props[propId] = {};
  taxData[k].props[propId][field] = val;
  saveTaxData();
  renderTax();
}
function taxPropUpdate(inp){
  const propId = inp.dataset.propid;
  const field  = inp.dataset.field;
  const fy     = +inp.dataset.fy;
  const val    = parseFloat(inp.value)||0;
  const k = taxKey(fy);
  if(!taxData[k]) getTaxRecord(fy);
  if(!taxData[k].props) taxData[k].props = {};
  if(!taxData[k].props[propId]) taxData[k].props[propId] = {};
  taxData[k].props[propId][field] = val;
  saveTaxData();
  // Don't re-render (user is typing — just save silently)
}
