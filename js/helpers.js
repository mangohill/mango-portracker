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
let portfolioView = 0;
let anHiddenGroups = new Set();
let anPerfFilter = 'all'; // asset type filter for performers // groups hidden in analytics chart // 0=All, 1=Stocks, 2=Crypto
let propRepayAnnual = false; // true=annual, false=monthly
let editingDivId    = null;
let hdSortKey = 'value_desc';
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

// ── CSV PARSE ────────────────────────────────────────────────────────
