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
// Per-person default tax-input shape — same fields regardless of person.
function taxPersonDefaults(){
  return {salary:0, withheld:0, payg:0, hecs:0, privateHealth:false, sacrifice:0};
}
function getTaxRecord(fy){
  const k = taxKey(fy);
  const persons = (typeof getAllPersons === 'function') ? getAllPersons() : ['lumia','chilli'];
  const defaults = {
    privateHealthFamily: false,
    dependants: 0,
    props:  {},
  };
  persons.forEach(p => { defaults[p] = taxPersonDefaults(); });
  if(!taxData[k]){
    taxData[k] = defaults;
  } else {
    // Merge missing top-level keys (handles old localStorage data)
    for(const key of Object.keys(defaults)){
      if(taxData[k][key] === undefined || taxData[k][key] === null){
        taxData[k][key] = defaults[key];
      }
    }
    // Merge missing person fields — covers both old records missing a
    // person entirely (e.g. a custom person added after this FY record was
    // first created) and a record missing an individual field.
    for(const person of persons){
      if(!taxData[k][person]) taxData[k][person] = taxPersonDefaults();
      else {
        const pd = taxPersonDefaults();
        for(const f of Object.keys(pd)){
          if(taxData[k][person][f] === undefined) taxData[k][person][f] = pd[f];
        }
      }
    }
  }
  return taxData[k];
}

// ATO FY2025/26 tax brackets (Stage 3 cuts)
function calcTax(taxable, fy){
  // taxable: numeric income
  // fy: optional fiscal year (FY as integer, e.g. 2027 for FY2026-27). If omitted, use current FY.
  taxable = +taxable || 0;
  if(taxable <= 0) return 0;
  let targetFY;
  if(fy) targetFY = +fy;
  else if(typeof dateToFY === 'function') targetFY = dateToFY(new Date().toISOString().slice(0,10));
  else { const d = new Date(); targetFY = d.getMonth() >= 6 ? d.getFullYear()+1 : d.getFullYear(); }

  let tax = 0;
  // Use ATO resident rates by FY (covers FY2023–24 → FY2026–27). Default fallbacks kept conservative.
  if(targetFY >= 2027){
    // FY2026-27
    if(taxable <= 18200) tax = 0;
    else if(taxable <= 45000) tax = (taxable - 18200) * 0.15;
    else if(taxable <= 135000) tax = 4020 + (taxable - 45000) * 0.30;
    else if(taxable <= 190000) tax = 31020 + (taxable - 135000) * 0.37;
    else tax = 51370 + (taxable - 190000) * 0.45;
  } else if(targetFY === 2026 || targetFY === 2025){
    // FY2024-25 and FY2025-26 (user-supplied same structure)
    // 18,201–45,000: 16c; 45,001–135,000: $4,288 + 30c; 135,001–190,000: $31,288 + 37c; 190,001+: $51,638 + 45c
    if(taxable <= 18200) tax = 0;
    else if(taxable <= 45000) tax = (taxable - 18200) * 0.16;
    else if(taxable <= 135000) tax = 4288 + (taxable - 45000) * 0.30;
    else if(taxable <= 190000) tax = 31288 + (taxable - 135000) * 0.37;
    else tax = 51638 + (taxable - 190000) * 0.45;
  } else if(targetFY === 2024){
    // FY2023-24
    if(taxable <= 18200) tax = 0;
    else if(taxable <= 45000) tax = (taxable - 18200) * 0.19;
    else if(taxable <= 120000) tax = 5092 + (taxable - 45000) * 0.325;
    else if(taxable <= 180000) tax = 29467 + (taxable - 120000) * 0.37;
    else tax = 51667 + (taxable - 180000) * 0.45;
  } else {
    // conservative default: FY2026-27 style
    if(taxable <= 18200) tax = 0;
    else if(taxable <= 45000) tax = (taxable - 18200) * 0.15;
    else if(taxable <= 135000) tax = 4020 + (taxable - 45000) * 0.30;
    else if(taxable <= 190000) tax = 31020 + (taxable - 135000) * 0.37;
    else tax = 51370 + (taxable - 190000) * 0.45;
  }

  // Medicare levy 2%, with the ATO's low-income shade-in applied instead of
  // a hard cliff at the threshold — see calcMedicareLevy() below.
  tax += calcMedicareLevy(taxable);
  return Math.round(tax * 100) / 100;
}

// Medicare levy 2%, with the ATO's low-income shade-in applied instead of
// a hard cliff at the threshold. Below the lower threshold: no levy.
// Between lower and upper (~1.1x lower): levy phases in at 10c per dollar
// over the lower threshold. Above upper: full 2% on all taxable income.
// NOTE: $26,000 is carried over from the original single-threshold figure
// already in this file — verify it's the correct FY figure against the
// ATO's published Medicare levy low-income thresholds for the target year.
// Shared by calcTax() (baked into the tax figure) and the standalone
// medicareLevy display line in buildPersonTax(), so the two can't diverge.
function calcMedicareLevy(taxable){
  taxable = Math.max(0, +taxable || 0);
  const ML_LOWER = 26000;
  const ML_UPPER = ML_LOWER * 1.1;
  if(taxable > ML_UPPER) return Math.round(taxable * 0.02 * 100) / 100;
  if(taxable > ML_LOWER) return Math.round((taxable - ML_LOWER) * 0.10 * 100) / 100;
  return 0;
}

// Grossed-up dividend = cash / (1 - 0.30) * frankingPct/100

// HECS-HELP repayment rates FY2025/26
function calcHECS(income, hecsDebt, fy){
  income = +income || 0;  // guard NaN
  if(!hecsDebt || hecsDebt <= 0) return 0;
  if(income <= 0) return 0;

  // From FY2025-26, compulsory HELP/HECS repayments switched to a MARGINAL
  // system: the repayment rate applies only to the income above each
  // threshold (like income tax brackets), not as a single flat rate on the
  // whole income the way it worked pre-reform. See ATO "Study and training
  // loans – what's new". The final bracket is the one exception — it's a
  // flat 10% of TOTAL repayment income, not stacked on top of the brackets
  // below it (this matches the ATO's own published tables, including the
  // small discontinuity at the top threshold).
  let targetFY;
  if(fy) targetFY = +fy;
  else if(typeof dateToFY === 'function') targetFY = dateToFY(new Date().toISOString().slice(0,10));
  else { const d = new Date(); targetFY = d.getMonth() >= 6 ? d.getFullYear()+1 : d.getFullYear(); }

  let brackets;
  if(targetFY >= 2027){
    // Table 1: 2026–27 repayment thresholds and rates
    brackets = [
      { to: 69528,     base: 0,    from: 0,      rate: 0    },
      { to: 129717,    base: 0,    from: 69528,  rate: 0.15 },
      { to: 186050,    base: 9028, from: 129717, rate: 0.17 },
      { to: Infinity,  flatOnTotal: true,         rate: 0.10 },
    ];
  } else {
    // Table 2: 2025–26 repayment thresholds and rates. Also used as the
    // fallback for any FY < 2026 — no pre-reform (pre-marginal) table is
    // wired up here since this app previously only ever carried one set of
    // figures; verify against the ATO if you need an older year's numbers.
    brackets = [
      { to: 67000,     base: 0,    from: 0,      rate: 0    },
      { to: 125000,    base: 0,    from: 67000,  rate: 0.15 },
      { to: 179285,    base: 8700, from: 125000, rate: 0.17 },
      { to: Infinity,  flatOnTotal: true,         rate: 0.10 },
    ];
  }

  const b = brackets.find(x => income <= x.to);
  const repayment = b.rate === 0 ? 0
    : b.flatOnTotal ? income * b.rate
    : b.base + (income - b.from) * b.rate;

  // ATO caps repayment at remaining debt balance
  return Math.min(Math.round(repayment), hecsDebt);
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

// NOTE: calcHECSRate() (a single-flat-rate-by-threshold lookup) used to
// live here but was dead code — confirmed unused anywhere in the app —
// and carried a third, different, now-obsolete set of thresholds left over
// from the pre-FY2025-26 flat-rate HECS system. Since the ATO switched to
// a marginal-bracket system from FY2025-26 (see calcHECS() above), a
// single "rate for this income" function doesn't really map onto the
// current rules, so it's been removed rather than updated. If you need a
// per-dollar marginal rate for display purposes, derive it from the same
// `brackets` table calcHECS() uses instead of resurrecting this.


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
        background:${getPersonColourAlpha(p,'33')};color:${getPersonColour(p)};
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
        <select style="background:${getPersonColourAlpha(own,'22')};color:${col};border:1px solid ${getPersonColourAlpha(own,'55')};
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

  // CGT per person for this FY — pulled directly from computeCGTSummary()
  // in cgt.js, the same engine that powers the Capital Gains tab: FIFO
  // parcel matching, AMIT cost-base adjustments, corporate-action
  // rollovers, property CGT, ownership split, and the correct ATO
  // ordering (losses offset short-term gains before long-term, discount
  // applied after). This keeps the Tax tab's estimate identical to the
  // Capital Gains tab for the same person + FY. Guard if the CGT engine
  // isn't available (avoid hard errors when files are missing or failed
  // to execute due to runtime issues).
  function personCGT(personKey) {
    if(typeof computeCGTSummary !== 'function'){
      console.warn('CGT engine not available; returning empty CGT summary');
      return { shortGain:0, longGain:0, totalLoss:0, netGain:0 };
    }
    const r = ((computeCGTSummary().result||{})[personKey]||{})[fy];
    if(!r) return { shortGain:0, longGain:0, totalLoss:0, netGain:0 };
    return { shortGain: r.netShort, longGain: r.discountedLong, totalLoss: r.losses, netGain: r.netCapitalGain };
  }
  // Persons this Tax tab computes for — all of them, not just the couple.
  const taxPersons = (typeof getAllPersons === 'function') ? getAllPersons() : ['lumia','chilli'];

  // Shared CGT summary (for display totals) — sum of every person's attributed gains
  const cgtByPerson = {};
  taxPersons.forEach(p => { cgtByPerson[p] = personCGT(p); });
  const cgt = taxPersons.reduce((acc, p) => {
    const c = cgtByPerson[p];
    acc.netGain   += c.netGain;
    acc.totalLoss += c.totalLoss;
    acc.shortGain += c.shortGain;
    acc.longGain  += c.longGain;
    return acc;
  }, { netGain:0, totalLoss:0, shortGain:0, longGain:0 });

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
      return own===personKey || (own==='joint' && JOINT_PERSONS.includes(personKey));
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
      // 'joint' means Lumia+Chilli specifically — a custom/extra person is
      // never an owner of a joint property (mattered less while this only
      // ever ran for Lumia/Chilli; now that it runs for everyone, an
      // unscoped check would attribute every joint property to them too).
      const isOwner = pOwner===owner || (pOwner==='joint' && JOINT_PERSONS.includes(owner));
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
    // Dividends attributed by actual stock ownership. 'joint' means split
    // 50/50 between JOINT_PERSONS (Lumia/Chilli) specifically — a custom
    // person (e.g. a child) querying a joint-owned symbol gets 0, not 0.5.
    // This mattered less while personTax() only ever ran for Lumia/Chilli
    // (every "other" person got 0 anyway); now that it runs for everyone,
    // an unscoped check would double-count a joint symbol's dividend.
    const _myDivs  = fyDivs.filter(d=>{
      const own = getSymbolOwner(d.symbol);
      return own===personKey || (own==='joint' && JOINT_PERSONS.includes(personKey));
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
    // Medicare levy (2% w/ shade-in — already baked into calcTax, extracted here for display)
    const medicareLevy = calcMedicareLevy(Math.max(0, taxableIncome));
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
    // ATO's MLS family-income test applies to a couple (you + spouse) —
    // it doesn't merge a dependent's own return with their parents' income.
    // Only JOINT_PERSONS (Lumia/Chilli) get the coupled family-income
    // treatment; anyone else (e.g. a custom/extra person like a child)
    // is assessed purely on their own income against the single threshold.
    const isCoupled = JOINT_PERSONS.includes(personKey);
    let familyIncome;
    if(isCoupled){
      const otherKey     = personKey === JOINT_PERSONS[0] ? JOINT_PERSONS[1] : JOINT_PERSONS[0];
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
      familyIncome = (taxableIncome + rfb + totalNetInvLoss) + otherTI;
    } else {
      // No spouse to combine with — family income reduces to own income, so
      // calcMLS's family-threshold branch effectively never applies and
      // only the single-filer threshold/rate logic governs this person.
      familyIncome = taxableIncome + rfb + totalNetInvLoss;
    }
    const deps         = isCoupled ? +(rec.dependants||0) : 0;
    const mls          = calcMLS(taxableIncome, familyIncome, hasPrivH, deps);
    const totalLiability = grossTax + hecsRep + mls + div293;
    const netTax    = Math.max(0, totalLiability - withheld - payg - myFrank);
    const refund    = Math.max(0, withheld + payg + myFrank - totalLiability);
    return { salary, withheld, payg, sacrifice, rfb, myDiv, myFrank, investInterestDeduction, totalNetInvLoss, empSGManual, empSuper, sgRate, totalConcess, div293Income, div293Threshold:250000, medicareLevy,
             netPropLoss, netPropGain, netRent, netExpenses,
             myCGT, taxableIncome, grossTax, medicareLevy, hecsRep, mls, div293,
             totalLiability, netTax, refund, hecsDebt, hasPrivH, isCoupled };
  }

  const propByPerson = {};
  const taxByPerson  = {};
  taxPersons.forEach(p => {
    propByPerson[p] = propPnL(p);
    taxByPerson[p]  = personTax(p, propByPerson[p], cgtByPerson[p]);
  });

  // ── Property expense inputs per property ─────────────────────
  const propInputs = properties.length ? properties.map(p=>{
    const share = p.owner==='joint'?0.5:1;
    const pRec = rec.props[p.id] || {};
    // getPersonLabel() covers any person (built-in or custom); previously
    // a custom owner (e.g. a property held by Cg) fell through this map to
    // the 'Lumia' fallback and displayed the wrong name.
    const ownerLabel = p.owner==='joint' ? 'Joint 50/50' : getPersonLabel(p.owner||'lumia');
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
  const row = (label, valuesArr, cls='', note='') =>
    `<tr ${cls?'class="'+cls+'"':''}>
      <td style="color:var(--text3);font-size:12px;padding:5px 8px">${label}${note?'<span style="color:var(--text3);font-size:10px"> '+note+'</span>':''}</td>
      ${valuesArr.map(v=>`<td style="font-family:var(--mono);font-size:12px;text-align:right;padding:5px 8px">${v}</td>`).join('')}
    </tr>`;

  const sp = (v,cls)=>`<span class="${cls||''}">${v}</span>`;


  panel.innerHTML = `
  <!-- FY selector -->
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap">
    <div style="font-family:var(--mono);font-size:13px;font-weight:600">🧾 TAX ESTIMATE</div>
    <select class="fsm" onchange="taxFY=+this.value;renderTax()">${fyOpts}</select>
    <span style="font-size:11px;color:var(--text3)">Australian tax law · Estimates only · Not financial advice</span>
    <button class="btn" style="margin-left:auto" onclick="generateEofyPack(${fy})">📦 EOFY Pack</button>
  </div>

  <!-- Side by side income inputs -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:18px">
    ${taxPersons.map((person,pi)=>{
      const pRec = rec[person] || {};
      const name = getPersonLabel(person);
      const col  = getPersonColour(person);
      return `<div class="fs">
        <div style="font-family:var(--mono);font-size:13px;font-weight:600;color:${col};margin-bottom:12px">${escHtml(name)}</div>
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
        <b>Family private hospital cover</b> — everyone above covered under one policy
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
    <div class="fst">👨‍👩‍👧 Family Details — ${escHtml(getPersonLabel(JOINT_PERSONS[0]))} &amp; ${escHtml(getPersonLabel(JOINT_PERSONS[1]))}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label class="fl">Dependant Children
          <span style="color:var(--text3);font-size:10px">(adds $1,500/child to the MLS family threshold below)</span>
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
    ${taxPersons.length>2?`<div style="font-size:10px;color:var(--text3);margin-top:8px">
      This family income test applies only to ${escHtml(getPersonLabel(JOINT_PERSONS[0]))} &amp; ${escHtml(getPersonLabel(JOINT_PERSONS[1]))} — the ATO MLS family test combines a couple's income, it doesn't merge a dependant's own return with their parents'.
      ${taxPersons.filter(p=>!JOINT_PERSONS.includes(p)).map(p=>escHtml(getPersonLabel(p))).join(', ')} ${taxPersons.filter(p=>!JOINT_PERSONS.includes(p)).length===1?'is':'are'} assessed on their own income against the $93,000 single threshold instead.
    </div>`:''}
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
        ${taxPersons.map(p=>`<th style="text-align:right;padding:6px 8px;font-size:12px;font-family:var(--mono);color:${getPersonColour(p)}">${escHtml(getPersonLabel(p))}</th>`).join('')}
      </tr></thead>
      <tbody>
        ${row('Gross Salary', taxPersons.map(p=>n2(taxByPerson[p].salary)))}
        ${taxPersons.some(p=>taxByPerson[p].rfb>0)?row('Reportable Fringe Benefits',
          taxPersons.map(p=>taxByPerson[p].rfb>0?'+'+n2(taxByPerson[p].rfb):'—'),
          '','not taxable income — used for Div293 & MLS threshold tests only'):''}
        ${`<tr>
          <td style='color:var(--text3);font-size:12px;padding:5px 8px'>Dividend Income (cash)<span style='color:var(--text3);font-size:10px'> from dividends tab</span></td>
          ${taxPersons.map(p=>`<td style='font-family:var(--mono);font-size:12px;text-align:right;padding:5px 8px;cursor:pointer;text-decoration:underline dotted;color:var(--green)' onclick='taxDrillDividends("${p}",${fy})' title='Click to see these dividends'>${n2(taxByPerson[p].myDiv)}</td>`).join('')}
        </tr>`}
        ${`<tr class='pos'>
          <td style='color:var(--text3);font-size:12px;padding:5px 8px'>Franking Credits</td>
          ${taxPersons.map(p=>`<td style='font-family:var(--mono);font-size:12px;text-align:right;padding:5px 8px;cursor:pointer;text-decoration:underline dotted' onclick='taxDrillDividends("${p}",${fy})' title='Click to see franked dividends'>+${n2(taxByPerson[p].myFrank)}</td>`).join('')}
        </tr>`}
        ${taxPersons.some(p=>taxByPerson[p].investInterestDeduction>0)?row(
          'Investment Interest Deduction',
          taxPersons.map(p=>taxByPerson[p].investInterestDeduction>0?'-'+n2(taxByPerson[p].investInterestDeduction):'—'),
          'neg','interest on loan used to buy investments'
        ):''}
        ${taxPersons.some(p=>taxByPerson[p].totalNetInvLoss>0)?row(
          '  └ Net Investment Loss (added back for Div293/MLS)',
          taxPersons.map(p=>taxByPerson[p].totalNetInvLoss>0?n2(taxByPerson[p].totalNetInvLoss):'—'),
          '','not added to taxable income — used for Div293 & MLS threshold tests only'):''}
        ${row('Net Rental Income', taxPersons.map(p=>taxByPerson[p].netRent>taxByPerson[p].netExpenses?'+'+n2(taxByPerson[p].netRent-taxByPerson[p].netExpenses):'—'))}
        ${row('Rental Loss (negative gearing)', taxPersons.map(p=>taxByPerson[p].netPropLoss>0?'-'+n2(taxByPerson[p].netPropLoss):'—'),'neg')}
        ${row('Net Capital Gain (after 50% disc)', taxPersons.map(p=>n2(taxByPerson[p].myCGT)),'',cgt.totalLoss>0?'capital losses: -'+n2(cgt.totalLoss):'')}
        <tr><td colspan="${taxPersons.length+1}" style="padding:2px 8px 8px">
          <span style="font-size:11px;color:var(--blue);cursor:pointer" onclick="switchTab('cgt',$('tab-cgt'))">
            ↳ View full Capital Gains report (per-parcel detail, any FY) →
          </span>
        </td></tr>
        <tr style="border-top:1px solid var(--border)">
          <td style="font-size:12px;font-weight:600;padding:6px 8px">Taxable Income</td>
          ${taxPersons.map(p=>{
            const t = taxByPerson[p];
            return `<td style="font-family:var(--mono);font-size:13px;font-weight:600;text-align:right;padding:6px 8px">
              ${n2(Math.max(0,t.taxableIncome))}
              ${t.sacrifice>0?`<div style='font-size:10px;color:var(--text3)'>(pre-sacrifice: ${n2(t.salary)})</div>`:''}
            </td>`;
          }).join('')}
        </tr>
        ${taxPersons.some(p=>taxByPerson[p].sacrifice>0)?row('Salary Sacrifice',
          taxPersons.map(p=>taxByPerson[p].sacrifice>0?'-'+n2(taxByPerson[p].sacrifice):'—'),'neg','reduces taxable income'):''}
        ${row('Gross Tax Payable', taxPersons.map(p=>n2(taxByPerson[p].grossTax)))}
        ${row('  └ Medicare Levy (2%)',
          taxPersons.map(p=>taxByPerson[p].medicareLevy>0?n2(taxByPerson[p].medicareLevy):'—'),
          'neg','included in gross tax above')}
        ${row('Effective Tax Rate',
          taxPersons.map(p=>taxByPerson[p].taxableIncome>0 ? (taxByPerson[p].grossTax/taxByPerson[p].taxableIncome*100).toFixed(1)+'%' : '—'),
          '','% of taxable income'
        )}
        ${row('PAYG Withholding Rate',
          taxPersons.map(p=>taxByPerson[p].salary>0 ? (taxByPerson[p].withheld/taxByPerson[p].salary*100).toFixed(1)+'%' : '—'),
          '','% of gross salary withheld by employer'
        )}
${(()=>{
          if(!taxPersons.some(p=>taxByPerson[p].div293>0)) return '';
          // Store breakdown data for popup (avoids JSON.stringify in onclick)
          window.__div293 = window.__div293 || {};
          taxPersons.forEach(p=>{ window.__div293[p] = {...taxByPerson[p], personLabel: getPersonLabel(p)}; });
          return `<tr class='neg'>
          <td style='color:var(--text3);font-size:12px;padding:5px 8px'>
            Division 293 Tax
            <span style='color:var(--text3);font-size:10px'> extra 15% on super · income &gt;$250k</span>
          </td>
          ${taxPersons.map(p=>{
            const t = taxByPerson[p];
            return `<td style='font-family:var(--mono);font-size:12px;text-align:right;padding:5px 8px;
            ${t.div293>0?'cursor:pointer;text-decoration:underline dotted':''}'
            onclick='${t.div293>0?`showDiv293Breakdown("${p}")`:""}'
            title='${t.div293>0?'Click to see calculation':''}'>
            ${t.div293>0?n2(t.div293):'—'}
          </td>`;
          }).join('')}
        </tr>`;
        })()}
      ${taxPersons.some(p=>taxByPerson[p].hecsRep>0)?row('HECS-HELP Repayment',
        taxPersons.map(p=>taxByPerson[p].hecsRep>0?n2(taxByPerson[p].hecsRep):'—')):''
      }
      ${taxPersons.some(p=>taxByPerson[p].mls>0)?row('Medicare Levy Surcharge',
        taxPersons.map(p=>taxByPerson[p].mls>0?n2(taxByPerson[p].mls)+'<span style="font-size:10px;color:var(--neg)"> (no priv. health)</span>':'—')):''
      }
        ${row('Less: Tax Withheld', taxPersons.map(p=>'-'+n2(taxByPerson[p].withheld)),'neg')}
        ${row('Less: PAYG Instalments', taxPersons.map(p=>taxByPerson[p].payg?'-'+n2(taxByPerson[p].payg):'—'),'neg')}
        ${row('Less: Franking Credits', taxPersons.map(p=>'-'+n2(taxByPerson[p].myFrank)),'neg')}
        <tr style="border-top:2px solid var(--border);background:rgba(255,255,255,0.03)">
          <td style="font-size:13px;font-weight:700;padding:8px 8px">Estimated Refund / Owing</td>
          ${taxPersons.map(p=>{
            const t = taxByPerson[p];
            return `<td style="font-family:var(--mono);font-size:15px;font-weight:700;text-align:right;padding:8px 8px">
              <span class="${t.refund>0?'pos':'neg'}">${t.refund>0?'REFUND '+n2(t.refund):'OWING '+n2(t.netTax)}</span>
            </td>`;
          }).join('')}
        </tr>
      </tbody>
    </table>
    </div>
    <div style="margin-top:10px;font-size:10px;color:var(--text3)">
      ⚠ Estimates only. CGT and dividends on jointly-owned holdings split 50/50 between ${escHtml(getPersonLabel(JOINT_PERSONS[0]))} and ${escHtml(getPersonLabel(JOINT_PERSONS[1]))} specifically — other persons' shares come only from their own individual stock ownership. FY2025/26 Stage 3 rates + 2% Medicare levy. MLS family income test (threshold &gt;$186,000) applies only to ${escHtml(getPersonLabel(JOINT_PERSONS[0]))} &amp; ${escHtml(getPersonLabel(JOINT_PERSONS[1]))}; other persons use the $93,000 individual threshold. HECS uses ATO FY2025/26 repayment rates. Consult your accountant.
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