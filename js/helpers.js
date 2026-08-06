// ── helpers.js ─────────────────────────────────────────────

function csvSafe(v){
  // Prevent CSV/XLSX formula injection by prefixing formula chars with apostrophe
  if(v == null) return '';
  const s = String(v);
  if(s.match(/^[=+\-@\t\r]/)) return "'" + s;
  return s;
}

// ── STOCK OWNERSHIP HELPERS ───────────────────────────────────────
function getAllPersons(){
  return ['lumia','chilli',...extraPersons];
}
function getPersonLabel(key){
  if(key==='lumia')  return 'Lumia';
  if(key==='chilli') return 'Chilli';
  if(key==='joint')  return 'Joint';
  return key.charAt(0).toUpperCase()+key.slice(1);
}
function getPersonColour(key){
  const colours = {lumia:'#60a5fa',chilli:'#f472b6',joint:'#34d399'};
  if(colours[key]) return colours[key];
  // Generate stable colour for custom persons
  let hash=0; for(const c of key) hash=(hash*31+c.charCodeAt(0))&0xffffffff;
  const hue = Math.abs(hash)%360;
  return `hsl(${hue},60%,60%)`;
}
function saveStockOwners(){ localStorage.setItem('pt_stock_owners', JSON.stringify(stockOwners)); }
function saveExtraPersons(){ localStorage.setItem('pt_extra_persons', JSON.stringify(extraPersons)); }
function getSymbolOwner(sym){ return stockOwners[sym]||'joint'; }
function setSymbolOwner(sym, owner){ stockOwners[sym]=owner; saveStockOwners(); }
// Get share for a given person (0-1)
function ownerShare(sym, person){
  const own = getSymbolOwner(sym);
  if(own === person) return 1.0;
  if(own === 'joint') return 0.5; // joint = 50/50 between all persons
  return 0.0;
}
// Add a custom person
function addPerson(name){
  const key = name.trim().toLowerCase().replace(/[^a-z0-9]/g,'_');
  if(!key||getAllPersons().includes(key)){ notify('Person already exists or invalid name','err'); return false; }
  extraPersons.push(key);
  saveExtraPersons();
  // Ensure taxData has an entry for this person
  for(const fy of Object.keys(taxData)){
    if(!taxData[fy][key]) taxData[fy][key]={salary:0,withheld:0,payg:0,hecs:0,privateHealth:false,sacrifice:0};
  }
  saveTaxData();
  return key;
}
function promptAddPerson(){
  const name = prompt('Enter name (e.g. "Partner", "Trust", "Company"):');
  if(!name||!name.trim()) return;
  const key = addPerson(name.trim());
  if(key){ notify(getPersonLabel(key)+' added ✓'); refreshOwnerSelects(); renderTax(); if(typeof renderOwnershipGrid==='function') renderOwnershipGrid(); }
}
function refreshOwnerSelects(){
  // Rebuild all owner selects across the app
  document.querySelectorAll('.owner-select').forEach(sel=>{
    const cur = sel.value;
    const sym = sel.dataset.sym;
    sel.innerHTML = buildOwnerOptions(getSymbolOwner(sym));
  });
}
function buildOwnerOptions(selectedKey){
  const opts = [
    ...getAllPersons().map(p=>`<option value="${p}" ${p===selectedKey?'selected':''}>${getPersonLabel(p)}</option>`),
    `<option value="joint" ${selectedKey==='joint'?'selected':''}>Joint (50/50)</option>`,
  ];
  return opts.join('');
}
function changeSymbolOwner(sym, newOwner){
  setSymbolOwner(sym, newOwner);
  // Refresh all owner badges for this symbol
  document.querySelectorAll(`[data-owner-sym="${escHtml(sym)}"]`).forEach(el=>{
    el.textContent = getPersonLabel(newOwner);
    el.style.background = getPersonColour(newOwner)+'33';
    el.style.color = getPersonColour(newOwner);
  });
  renderTax();
}


function escHtml(s){
  if(s==null) return '';
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// ── STATE ────────────────────────────────────────────────────────────
let trades    = (()=>{try{return JSON.parse(localStorage.getItem('pt_trades')||'[]');}catch(e){return [];}})() ;
let prices    = (()=>{try{return JSON.parse(localStorage.getItem('pt_prices')||'{}');}catch(e){return {};}})() ;
let pending   = [];
let dividends = (()=>{try{return JSON.parse(localStorage.getItem('pt_divs')||'[]');}catch(e){return [];}})() ;
let editingTradeId = null;
let superAccounts = (()=>{try{return JSON.parse(localStorage.getItem('pt_super')||'[]');}catch(e){return [];}})() ;
let editingSuperAccountId = null;
let propRentAnnual = true;   // true=annual, false=monthly
let propDebtNet = false;     // false=gross debt, true=net (minus offsets)
let portfolioView = 1; // 0=All, 1=Stocks, 2=Crypto — defaults to Stocks on load
let anHiddenGroups = new Set();
let anPerfFilter = 'all'; // asset type filter for performers // groups hidden in analytics chart // 0=All, 1=Stocks, 2=Crypto
let propRepayAnnual = false; // true=annual, false=monthly
let editingDivId    = null;
let hdSortKey = 'symbol'; // matches the "Name A→Z" default shown in the hd-sort dropdown
let dvFYFilter = 'ALL';

// CoinGecko symbol→id
const CG = {
  BTC:'bitcoin',ETH:'ethereum',XRP:'ripple',LTC:'litecoin',BCH:'bitcoin-cash',
  ETC:'ethereum-classic',ALGO:'algorand',BNB:'binancecoin',SOL:'solana',ADA:'cardano',
  DOT:'polkadot',LINK:'chainlink',DOGE:'dogecoin',AVAX:'avalanche-2',MATIC:'matic-network',
  UNI:'uniswap',ATOM:'cosmos',NEAR:'near',FTM:'fantom',VET:'vechain',SHIB:'shiba-inu',
  USDT:'tether',USDC:'usd-coin',XLM:'stellar',TRX:'tron',HBAR:'hedera-hashgraph',
  ICP:'internet-computer',IMX:'immutable-x',OP:'optimism',ARB:'arbitrum',SUI:'sui',APT:'aptos',
  AXS:'axie-infinity',
};

// ── HELPERS ──────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const uid = () => Date.now() + Math.floor(Math.random()*1e7);
const n2 = (n,d=2) => n==null?'—':'$'+Number(n).toLocaleString('en-AU',{minimumFractionDigits:d,maximumFractionDigits:d});
const nN = (n,d=6) => Number(n).toLocaleString('en-AU',{minimumFractionDigits:0,maximumFractionDigits:d});
const nP = n  => n==null?'—':(n>=0?'+':'')+n.toFixed(2)+'%';
const clr = n => n==null?'neu':n>0?'pos':n<0?'neg':'neu';
const dec = p => p<0.01?8:p<1?6:p<100?4:2;
const bS  = t => t==='buy'?'<span class="badge b-buy">BUY</span>':t==='drp'?'<span class="badge" style="background:#3b1f6e;color:#c4b5fd;border:1px solid #7c3aed">DRP</span>':'<span class="badge b-sell">SELL</span>';
const ASSET_LABELS = {asx_stock:'ASX',crypto:'CRYPTO',stock:'STOCK',etf:'ETF',lic:'LIC',reit:'REIT',bond:'BOND',commodity:'CMDTY',managed:'MANAGED',super:'SUPER'};

// ── SYMBOL → ASSET TYPE MAP ───────────────────────────────────────────
// Auto-applied on import. Add any symbol (without broker suffix) here.
const SYMBOL_TYPES = {
  // ETFs
  DHHF:'etf', VTS:'etf', VAE:'etf', OOO:'etf', VGS:'etf', IVV:'etf',
  NDQ:'etf',  A200:'etf', VAS:'etf', IOZ:'etf', QUAL:'etf', HACK:'etf',
  ETHI:'etf', VDHG:'etf', VBLD:'etf', VAP:'etf', MVW:'etf', SYI:'etf',
  GEAR:'etf', BBOZ:'etf', BBUS:'etf', BEAR:'etf', QFN:'etf', QRE:'etf',
  RF1:'etf',
  // LICs
  AFI:'lic',  ARG:'lic',  MLT:'lic',  WHF:'lic',  WAM:'lic',  WAX:'lic',
  WLE:'lic',  WMI:'lic',  QVE:'lic',  CDM:'lic',  DJW:'lic',  MFF:'lic',
  PMC:'lic',  BTI:'lic',  CAM:'lic',  PIA:'lic',  WGB:'lic',
  // REITs
  GMG:'reit', SCG:'reit', GPT:'reit', MGR:'reit', CHC:'reit', CIP:'reit',
  // Crypto (common)
  BTC:'crypto', ETH:'crypto', SOL:'crypto', XRP:'crypto', ADA:'crypto',
  DOT:'crypto', AVAX:'crypto', MATIC:'crypto', LINK:'crypto',
};

// Returns the known asset type for a symbol, or falls back to defaultType
function resolveAssetType(sym, defaultType){
  const base = priceSymbol(sym); // strip :XX suffix
  return SYMBOL_TYPES[base] || defaultType;
}
const ASSET_CLASSES = {crypto:'b-crypto',stock:'b-stock',etf:'b-etf',lic:'b-lic',reit:'b-reit',bond:'b-bond',commodity:'b-cmdty',managed:'b-managed',super:'b-super'};
const bT = t => { t = t||'asx_stock'; return '<span class="badge ' + (ASSET_CLASSES[t]||'b-stock') + '">' + (ASSET_LABELS[t]||t.toUpperCase()) + '</span>'; };

// ── BROKER / SOURCE MANAGEMENT ───────────────────────────────────────────────
const DEFAULT_BROKERS = [
  {value:'commsec',   label:'CommSec'},
  {value:'selfwealth',label:'Selfwealth'},
  {value:'cmc',       label:'CMC Markets'},
  {value:'stake',     label:'Stake'},
  {value:'btcmarkets',label:'BTC Markets'},
  {value:'betashares',label:'Betashares'},
  {value:'drp',       label:'DRP (direct)'},
  {value:'binance',   label:'Binance'},
  {value:'manual',    label:'Manual'},
];

function getCustomBrokers(){
  try { return (()=>{try{return JSON.parse(localStorage.getItem('pt_brokers')||'[]');}catch(e){return [];}})() ; } catch{ return []; }
}
function saveCustomBrokers(arr){
  localStorage.setItem('pt_brokers', JSON.stringify(arr));
}
function getAllBrokers(){
  const custom = getCustomBrokers();
  const all = [...DEFAULT_BROKERS];
  for(const c of custom){
    if(!all.find(b => b.value === c.value)) all.push(c);
  }
  return all;
}

// Populate a <select> with all brokers, optionally pre-selecting a value
function populateBrokerSelect(id, selectedValue){
  const el = $(id);
  if(!el) return;
  const brokers = getAllBrokers();
  const cur = selectedValue !== undefined ? selectedValue : el.value;
  el.innerHTML = '';
  // For filter selects (tso), prepend "All sources"
  if(id === 'tso'){
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = 'All sources';
    el.appendChild(opt);
  }
  for(const b of brokers){
    const opt = document.createElement('option');
    opt.value = b.value; opt.textContent = b.label;
    el.appendChild(opt);
  }
  if(cur) el.value = cur;
}

// Repopulate all broker selects across the app
function refreshAllBrokerSelects(){
  populateBrokerSelect('fso');
  populateBrokerSelect('tso');
  populateBrokerSelect('dv-drp-source');
}

function promptAddBroker(returnSelectId){
  const name = prompt('Enter broker name (e.g. CommSec, Pearler):');
  if(!name || !name.trim()) return;
  const label = name.trim();
  const value = label.toLowerCase().replace(/[^a-z0-9]/g,'');
  const custom = getCustomBrokers();
  const all = getAllBrokers();
  if(all.find(b => b.value === value)){
    notify(label + ' already exists', 'err'); return;
  }
  custom.push({value, label});
  saveCustomBrokers(custom);
  refreshAllBrokerSelects();
  // Select the new broker in the originating dropdown
  const el = $(returnSelectId);
  if(el) el.value = value;
  notify(label + ' added as broker ✓');
}


function notify(msg,type='ok'){
  const n=$('notif'); n.textContent=msg; n.className='notif show '+type;
  clearTimeout(n._t); n._t=setTimeout(()=>n.classList.remove('show'),3500);
}
function save(){ localStorage.setItem('pt_trades',JSON.stringify(trades)); setTimeout(diagnoseTrades,100); localStorage.setItem('pt_prices',JSON.stringify(prices)); localStorage.setItem('pt_divs',JSON.stringify(dividends)); saveProps(); }

// ── DATE ─────────────────────────────────────────────────────────────
function nd(s){
  if(!s) return '';
  s=s.trim();
  // Strip time portion
  const datePart = s.split(/[\sT]/)[0];
  // Already ISO yyyy-mm-dd
  if(/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  // dd/mm/yyyy or dd-mm-yyyy
  const m=datePart.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if(m){ const y=m[3].length===2?'20'+m[3]:m[3]; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
  return datePart.slice(0,10);
}

// ── HUD-STYLE POPUP HELPER ─────────────────────────────────────────────
// Shared by breakdown popups (Div293, Debt Recycling) so they all read as
// a floating cockpit overlay — dark backdrop scrim + blue-glow instrument
// panel — rather than blending into the surface colour behind them.
function openHudPopup(id, innerHtml, opts){
  opts = opts || {};
  // Acts as a toggle: clicking the same trigger again closes it
  if(document.getElementById(id)){ closeHudPopup(id); return null; }

  const backdrop = document.createElement('div');
  backdrop.id = id+'-backdrop';
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9998';
  backdrop.addEventListener('click', ()=>closeHudPopup(id));

  const panel = document.createElement('div');
  panel.id = id;
  panel.style.cssText = [
    'position:fixed','top:50%','left:50%',
    'transform:translate(-50%,-50%)',
    'background:linear-gradient(165deg,#132029 0%,#0a1319 100%)',
    'border:1px solid var(--blue)',
    'border-radius:10px','padding:20px 24px',
    'z-index:9999',`min-width:${opts.minWidth||'320px'}`,'max-width:95vw',
    'box-shadow:0 12px 40px rgba(0,0,0,.7), 0 0 30px var(--blue-glow)',
    'font-family:var(--mono)','font-size:12px',
  ].join(';');
  panel.innerHTML = innerHtml;
  panel.addEventListener('click', e => e.stopPropagation());

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);

  // Defer the outside-click dismiss listener — otherwise the click that
  // opened this popup is still bubbling to document and would close it instantly.
  setTimeout(()=>{
    document.addEventListener('click', function dismiss(){
      closeHudPopup(id);
      document.removeEventListener('click', dismiss);
    });
  }, 0);

  return panel;
}
function closeHudPopup(id){
  const panel = document.getElementById(id);
  const backdrop = document.getElementById(id+'-backdrop');
  if(panel) panel.remove();
  if(backdrop) backdrop.remove();
}

// ── RESPONSIVE TABLES (phones + tablet portrait) ───────────────────────
// iPad portrait is 768–834px — wider than the old 680px mobile breakpoint,
// so it was getting zero responsive handling and just overflowing.
// This auto-retrofits EVERY data table in the app: on narrow viewports it
// hides lower-priority columns and lets tapping a row reveal them as
// label:value pairs underneath. No changes needed in individual render
// functions — a MutationObserver picks up every table re-render.
const RTBL_BREAKPOINT = 900; // px — covers iPad portrait + phones

function rtblBudget(){
  const w = window.innerWidth;
  if(w <= 420) return 3;
  if(w <= 680) return 4;
  if(w <= RTBL_BREAKPOINT) return 5;
  return Infinity; // desktop / landscape tablet — no hiding
}

function enhanceResponsiveTables(){
  const budget = rtblBudget();
  document.querySelectorAll('.ovx table, table.tbl').forEach(table=>{
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if(!thead || !tbody) return;
    const ths = [...thead.querySelectorAll('th')];
    const total = ths.length;
    if(!total) return;
    // Column show-order: explicit data-pri hints where present (lower =
    // shown first), else natural left-to-right order as the default.
    const order = ths.map((th,i)=>({i, pri: th.dataset.pri!=null ? +th.dataset.pri : i}))
                      .sort((a,b)=>a.pri-b.pri);
    const visible = new Set(order.slice(0, Math.min(budget, total)).map(o=>o.i));
    visible.add(0); visible.add(total-1); // identifier col + trailing action col always shown
    const headers = ths.map(th=>th.textContent.trim());

    [...tbody.querySelectorAll(':scope > tr')].forEach(row=>{
      if(row.classList.contains('rtbl-detail')) return;
      const cells = [...row.children];
      if(cells.length !== total) return; // foreign/mismatched row shape, leave untouched

      const hiddenIdx = [];
      cells.forEach((td,i)=>{ if(!visible.has(i)) hiddenIdx.push(i); });

      // Skip entirely if this row is already correctly enhanced for the
      // current budget — avoids rewriting the DOM (and re-triggering the
      // MutationObserver) on every pass once things have settled.
      const sig = budget+':'+hiddenIdx.join(',');
      if(row.dataset.rtblSig === sig) return;
      row.dataset.rtblSig = sig;

      const oldDetail = row.nextElementSibling;
      if(oldDetail && oldDetail.classList && oldDetail.classList.contains('rtbl-detail')) oldDetail.remove();
      cells.forEach(td=>td.classList.remove('rtbl-hide'));
      row.classList.remove('rtbl-row','rtbl-open');
      row.onclick = null;
      if(!hiddenIdx.length) return; // fits within budget as-is

      cells.forEach((td,i)=>{ if(hiddenIdx.includes(i)) td.classList.add('rtbl-hide'); });
      row.classList.add('rtbl-row');
      const detail = document.createElement('tr');
      detail.className = 'rtbl-detail';
      detail.style.display = 'none';
      const dtd = document.createElement('td');
      dtd.colSpan = total;
      dtd.innerHTML = hiddenIdx.map(i=>
        `<div class="rtbl-detail-row"><span class="rtbl-detail-label">${escHtml(headers[i]||'')}</span><span>${cells[i].innerHTML}</span></div>`
      ).join('');
      detail.appendChild(dtd);
      row.after(detail);

      row.onclick = e=>{
        if(e.target.closest('button,a,select,input,.del-btn,.owner-select')) return;
        const open = detail.style.display !== 'none';
        detail.style.display = open ? 'none' : '';
        row.classList.toggle('rtbl-open', !open);
      };
    });
  });
}

function disableResponsiveTables(){
  document.querySelectorAll('.rtbl-detail').forEach(el=>el.remove());
  document.querySelectorAll('.rtbl-hide').forEach(el=>el.classList.remove('rtbl-hide'));
  document.querySelectorAll('.rtbl-row').forEach(el=>{
    el.classList.remove('rtbl-row','rtbl-open'); el.onclick=null; delete el.dataset.rtblSig;
  });
}

let _rtblWasNarrow = false;
function refreshResponsiveTables(){
  const narrow = window.innerWidth <= RTBL_BREAKPOINT;
  if(narrow) enhanceResponsiveTables();
  else if(_rtblWasNarrow) disableResponsiveTables();
  _rtblWasNarrow = narrow;
}

(function initResponsiveTables(){
  let timer = null;
  const debounced = ()=>{ clearTimeout(timer); timer = setTimeout(refreshResponsiveTables, 80); };
  const start = ()=>{
    refreshResponsiveTables();
    new MutationObserver(debounced).observe(document.body, {childList:true, subtree:true});
    window.addEventListener('resize', ()=>{ clearTimeout(timer); timer = setTimeout(refreshResponsiveTables, 150); });
    window.addEventListener('orientationchange', debounced);
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

// ── CSV PARSE ────────────────────────────────────────────────────────