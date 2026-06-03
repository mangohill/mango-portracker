// ── spending.js ─────────────────────────────────────────────

function loadSpending(){
  try{
    const raw = localStorage.getItem('pt_spending');
    if(raw){ spendingData = JSON.parse(raw); return; }
  }catch(e){}
  // First load — seed with bundled data
  spendingData = SP_SEED.slice();
  saveSpending();
}
function saveSpending(){
  localStorage.setItem('pt_spending', JSON.stringify(spendingData));
}
let spendingData = [];

// State
let spFY = null;           // selected FY (null = latest)
let spCatFilter = null;    // selected category (money out)
let spInCatFilter = null;  // selected category (money in)
let spSortOut = {col:'amount', dir:-1};  // money out category sort
let spSortIn  = {col:'amount', dir:-1};  // money in category sort
let spSortTxn = {col:'date',   dir:-1};  // transaction sort

const SP_EXCLUDE = new Set(['__TRANSFERS__']);
const SP_MONEY_IN = new Set(['__REFUND__', '__OTHER_INCOME__']);
const SP_IN_LABEL = {'__REFUND__':'Refunds', '__OTHER_INCOME__':'Other Income'};

// Category emoji map
const SP_CAT_ICON = {
  'Groceries':'🛒', 'Restaurants & Takeaway':'🍽️', 'Other Shopping':'🛍️',
  'Fuel':'⛽', 'Phone & Internet':'📱', 'Clothing & Accessories':'👗',
  'Flights':'✈️', 'Homeware & Home Improvements':'🏡', 'Government':'🏛️',
  'Education':'📚', 'Medical':'💊', 'Insurance':'🛡️', 'Attractions & Events':'🎟️',
  'Cafe & Coffee':'☕', 'Public Transport':'🚌', 'Fees':'🏦',
  'Parking & Tolls':'🅿️', 'Accommodation':'🏨', 'Travel Expenses & Holidays':'🌏',
  'Alcohol':'🍷', 'Personal Care & Beauty':'💅', 'Gym & Fitness':'💪',
  'Electronics & Technology':'💻', 'Utilities':'💡', 'Vehicle Expenses':'🚗',
  'Services':'🔧',
  'Refunds':'↩️', 'Other Income':'💰',
};

function initSpending(){
  loadSpending();
  const fys = [...new Set(spendingData.map(d=>d.fy))].sort();
  if(!spFY || !fys.includes(spFY)) spFY = fys[fys.length-1];
  renderSpFYBar();
  renderSpending();
}

function renderSpFYBar(){
  const fys = [...new Set(spendingData.map(d=>d.fy))].sort();
  const bar = $('sp-fy-bar');
  if(!bar) return;
  bar.innerHTML = fys.map(fy=>
    `<span class="badge" onclick="setSpFY(${fy})"
      style="cursor:pointer;padding:4px 12px;border-radius:12px;font-family:var(--mono);font-size:11px;
      background:${spFY===fy?'var(--blue)':'var(--surface2)'};
      color:${spFY===fy?'#fff':'var(--text2)'};
      border:1px solid ${spFY===fy?'var(--blue)':'var(--border2)'};transition:all .15s">
      FY${fy}
    </span>`
  ).join('');
}

function setSpFY(fy){
  spFY = fy; spCatFilter = null; spInCatFilter = null;
  renderSpFYBar(); renderSpending();
}

function getSpData(){
  const search = ($('sp-search')?.value||'').toLowerCase();
  return spendingData.filter(d => {
    if(d.fy !== spFY) return false;
    if(search && !d.merchant.toLowerCase().includes(search) && !d.details.toLowerCase().includes(search)) return false;
    return true;
  });
}

function renderSpending(){
  const data = getSpData();

  // ── Summary cards ───────────────────────────────────────────────
  const transfers = spendingData.filter(d=>d.fy===spFY&&d.category==='__TRANSFERS__');
  const totalSpent   = transfers.reduce((s,d)=>s+d.amount,0); // positive = payment into CC
  const totalOut = data.filter(d=>d.amount<0&&!SP_MONEY_IN.has(d.category)&&!SP_EXCLUDE.has(d.category))
                       .reduce((s,d)=>s+(-d.amount),0);
  const totalIn  = data.filter(d=>d.amount>0&&!SP_EXCLUDE.has(d.category))
                       .reduce((s,d)=>s+d.amount,0);
  const net = totalIn - totalOut;

  $('sp-cards').innerHTML = [
    {l:'Total Paid (Credit Card)', v:'$'+totalSpent.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}), s:'neg', sub:'FY'+spFY+' card payments made', big:true},
    {l:'Total Categorised Spend',  v:'$'+totalOut.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}), s:'neg', sub:'All money out'},
    {l:'Money In (Refunds etc.)',   v:'$'+totalIn.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}),  s:'pos', sub:'Refunds + credits'},
    {l:'Net Spend',                 v:'$'+(Math.abs(net)).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}), s:net>=0?'pos':'neg', sub:net>=0?'Net ahead':'Net out'},
  ].map(c=>`<div class="card" style="${c.big?'border-color:var(--blue);background:rgba(61,156,240,0.06)':''}">
    <div class="card-label">${c.l}</div>
    <div class="card-value ${c.s}" style="${c.big?'font-size:22px':''}">${c.v}</div>
    <div class="card-sub">${c.sub}</div>
  </div>`).join('');

  // ── Money Out ───────────────────────────────────────────────────
  $('sp-out-total').textContent = '$'+totalOut.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});

  if(spCatFilter){
    renderSpTxnTable(data, spCatFilter, false);
    $('sp-cat-list').style.display='none';
    $('sp-txn-wrap').style.display='';
  } else {
    $('sp-cat-list').style.display='';
    $('sp-txn-wrap').style.display='none';
    renderSpCatList(data);
  }

  // ── Money In ────────────────────────────────────────────────────
  const inData = data.filter(d=>d.amount>0&&SP_MONEY_IN.has(d.category));
  $('sp-in-total').textContent = '$'+totalIn.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});

  if(spInCatFilter){
    renderSpTxnTable(data, spInCatFilter, true);
    $('sp-in-list').style.display='none';
    $('sp-in-txn-wrap').style.display='';
  } else {
    $('sp-in-list').style.display='';
    $('sp-in-txn-wrap').style.display='none';
    renderSpInCatList(inData);
  }
}

function renderSpCatList(data){
  // Build category totals
  const catTotals = {};
  const catCounts = {};
  data.forEach(d=>{
    if(d.amount>=0||SP_MONEY_IN.has(d.category)||SP_EXCLUDE.has(d.category)) return;
    catTotals[d.category] = (catTotals[d.category]||0) + (-d.amount);
    catCounts[d.category] = (catCounts[d.category]||0) + 1;
  });

  let cats = Object.entries(catTotals);
  // Sort
  if(spSortOut.col==='category') cats.sort((a,b)=>spSortOut.dir*(a[0].localeCompare(b[0])));
  else cats.sort((a,b)=>spSortOut.dir*(a[1]-b[1]));

  const grandTotal = cats.reduce((s,[,v])=>s+v,0);

  // Header row
  const hdrStyle = 'font-family:var(--mono);font-size:10px;color:var(--text3);letter-spacing:.08em;padding:6px 10px;cursor:pointer;user-select:none;white-space:nowrap';
  const sortArrow = (col) => spSortOut.col===col ? (spSortOut.dir===-1?' ▼':' ▲') : '';

  $('sp-cat-list').innerHTML = `
    <div style="display:grid;grid-template-columns:28px 1fr 80px 80px 120px 36px;gap:0;border-bottom:1px solid var(--border);margin-bottom:4px">
      <div style="${hdrStyle}"></div>
      <div style="${hdrStyle}" onclick="spSortCat('category')">CATEGORY${sortArrow('category')}</div>
      <div style="${hdrStyle};text-align:right" onclick="spSortCat('count')">TXNS${sortArrow('count')}</div>
      <div style="${hdrStyle};text-align:right" onclick="spSortCat('pct')">% OF TOTAL${sortArrow('pct')}</div>
      <div style="${hdrStyle};text-align:right" onclick="spSortCat('amount')">AMOUNT${sortArrow('amount')}</div>
      <div style="${hdrStyle}"></div>
    </div>
    ${cats.map(([cat,amt])=>{
      const pct = grandTotal>0?(amt/grandTotal*100):0;
      const icon = SP_CAT_ICON[cat]||'•';
      const cnt = catCounts[cat]||0;
      return `<div style="display:grid;grid-template-columns:28px 1fr 80px 80px 120px 36px;gap:0;
                border-bottom:1px solid var(--border);transition:background .1s"
              class="sp-cat-row" onclick="selectSpCat('${cat.replace(/'/g,"\\'")}')"
              onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
        <div style="padding:10px 4px 10px 10px;font-size:15px">${icon}</div>
        <div style="padding:10px 8px;font-family:var(--sans);font-size:13px;color:var(--text)">
          ${cat}
          <div style="margin-top:3px;background:var(--border);border-radius:2px;height:3px;width:100%;max-width:200px">
            <div style="background:var(--red);height:3px;border-radius:2px;width:${Math.min(100,pct)}%"></div>
          </div>
        </div>
        <div style="padding:10px 8px;text-align:right;font-family:var(--mono);font-size:12px;color:var(--text3)">${cnt}</div>
        <div style="padding:10px 8px;text-align:right;font-family:var(--mono);font-size:12px;color:var(--text3)">${pct.toFixed(1)}%</div>
        <div style="padding:10px 8px;text-align:right;font-family:var(--mono);font-size:13px;font-weight:600;color:var(--red)">
          ${n2(amt)}
        </div>
        <div style="padding:10px 8px;text-align:center;color:var(--text3);font-size:12px">›</div>
      </div>`;
    }).join('')}
    <div style="display:grid;grid-template-columns:28px 1fr 80px 80px 120px 36px;gap:0;border-top:2px solid var(--border);padding:8px 0;font-weight:700">
      <div></div>
      <div style="padding:8px 8px;font-family:var(--mono);font-size:12px;color:var(--text2)">TOTAL (${cats.length} categories)</div>
      <div style="padding:8px 8px;text-align:right;font-family:var(--mono);font-size:12px;color:var(--text3)">${cats.reduce((s,[,_],i)=>s+(catCounts[cats[i][0]]||0),0)}</div>
      <div style="padding:8px 8px;text-align:right;font-family:var(--mono);font-size:12px;color:var(--text3)">100%</div>
      <div style="padding:8px 8px;text-align:right;font-family:var(--mono);font-size:13px;color:var(--red)">${n2(grandTotal)}</div>
      <div></div>
    </div>`;
}

function renderSpInCatList(inData){
  const catTotals = {};
  const catCounts = {};
  inData.forEach(d=>{
    const lbl = SP_IN_LABEL[d.category]||d.category;
    catTotals[lbl] = (catTotals[lbl]||0) + d.amount;
    catCounts[lbl] = (catCounts[lbl]||0) + 1;
  });

  let cats = Object.entries(catTotals);
  if(spSortIn.col==='category') cats.sort((a,b)=>spSortIn.dir*(a[0].localeCompare(b[0])));
  else cats.sort((a,b)=>spSortIn.dir*(a[1]-b[1]));

  const hdrStyle = 'font-family:var(--mono);font-size:10px;color:var(--text3);letter-spacing:.08em;padding:6px 10px;cursor:pointer;user-select:none';
  const sortArrow = (col) => spSortIn.col===col?(spSortIn.dir===-1?' ▼':' ▲'):'';

  $('sp-in-list').innerHTML = `
    <div style="display:grid;grid-template-columns:28px 1fr 80px 120px 36px;gap:0;border-bottom:1px solid var(--border);margin-bottom:4px">
      <div style="${hdrStyle}"></div>
      <div style="${hdrStyle}" onclick="spSortInCat('category')">CATEGORY${sortArrow('category')}</div>
      <div style="${hdrStyle};text-align:right" onclick="spSortInCat('count')">TXNS${sortArrow('count')}</div>
      <div style="${hdrStyle};text-align:right" onclick="spSortInCat('amount')">AMOUNT${sortArrow('amount')}</div>
      <div style="${hdrStyle}"></div>
    </div>
    ${cats.map(([cat,amt])=>{
      const icon = SP_CAT_ICON[cat]||'↩️';
      const cnt = catCounts[cat]||0;
      const rawCat = Object.keys(SP_IN_LABEL).find(k=>SP_IN_LABEL[k]===cat)||cat;
      return `<div style="display:grid;grid-template-columns:28px 1fr 80px 120px 36px;gap:0;
                border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s"
              onclick="selectSpInCat('${rawCat}')"
              onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
        <div style="padding:10px 4px 10px 10px;font-size:15px">${icon}</div>
        <div style="padding:10px 8px;font-family:var(--sans);font-size:13px;color:var(--text)">${cat}</div>
        <div style="padding:10px 8px;text-align:right;font-family:var(--mono);font-size:12px;color:var(--text3)">${cnt}</div>
        <div style="padding:10px 8px;text-align:right;font-family:var(--mono);font-size:13px;font-weight:600;color:var(--green)">${n2(amt)}</div>
        <div style="padding:10px 8px;text-align:center;color:var(--text3);font-size:12px">›</div>
      </div>`;
    }).join('')}`;
}

function spSortCat(col){
  if(spSortOut.col===col) spSortOut.dir*=-1;
  else { spSortOut.col=col; spSortOut.dir = col==='category'?1:-1; }
  renderSpending();
}

function spSortInCat(col){
  if(spSortIn.col===col) spSortIn.dir*=-1;
  else { spSortIn.col=col; spSortIn.dir = col==='category'?1:-1; }
  renderSpending();
}

function selectSpCat(cat){
  spCatFilter = cat; renderSpending();
}
function clearSpendingCat(){
  spCatFilter = null; renderSpending();
}
function selectSpInCat(cat){
  spInCatFilter = cat; renderSpending();
}
function clearSpendingInCat(){
  spInCatFilter = null; renderSpending();
}

function renderSpTxnTable(data, cat, isIn){
  const txns = data.filter(d=>d.category===cat);
  const bodyId = isIn?'sp-in-txn-body':'sp-txn-body';
  const headId = isIn?'sp-in-txn-head':'sp-txn-head';
  const titleId = isIn?'sp-in-txn-title':'sp-txn-title';
  const label = SP_IN_LABEL[cat]||(SP_CAT_ICON[cat]||'')+' '+cat;
  const total = txns.reduce((s,d)=>s+(isIn?d.amount:-d.amount),0);
  $(titleId).textContent = label+' — '+n2(total);

  // Sort
  let sorted = [...txns];
  const s = spSortTxn;
  sorted.sort((a,b)=>{
    if(s.col==='date')    return s.dir*(a.date.localeCompare(b.date));
    if(s.col==='amount')  return s.dir*(Math.abs(a.amount)-Math.abs(b.amount));
    if(s.col==='merchant')return s.dir*(a.merchant.localeCompare(b.merchant));
    return 0;
  });

  const arrow = col => spSortTxn.col===col?(spSortTxn.dir===-1?' ▼':' ▲'):'';
  const thStyle = 'cursor:pointer;user-select:none';

  $(headId).innerHTML = `
    <th style="${thStyle}" onclick="sortSpTxn('date')">Date${arrow('date')}</th>
    <th style="${thStyle}" onclick="sortSpTxn('merchant')">Merchant${arrow('merchant')}</th>
    <th style="text-align:right;${thStyle}" onclick="sortSpTxn('amount')">Amount${arrow('amount')}</th>`;

  $(bodyId).innerHTML = sorted.map(d=>`<tr>
    <td style="color:var(--text3);font-size:12px">${d.date}</td>
    <td>${d.merchant}</td>
    <td style="text-align:right;font-family:var(--mono);${isIn?'color:var(--green)':'color:var(--red)'}">${n2(Math.abs(d.amount))}</td>
  </tr>`).join('');
}

// ── SPENDING CSV IMPORT ───────────────────────────────────────────────

// Category mapping: bank label → internal label
const SP_CAT_MAP = {
  'Groceries':'Groceries',
  'Restaurants & takeaway':'Restaurants & Takeaway',
  'Restaurants & Takeaway':'Restaurants & Takeaway',
  'Other shopping':'Other Shopping',
  'Other Shopping':'Other Shopping',
  'Fuel':'Fuel',
  'Phone & internet':'Phone & Internet',
  'Phone & Internet':'Phone & Internet',
  'Clothing & accessories':'Clothing & Accessories',
  'Clothing & Accessories':'Clothing & Accessories',
  'Flights':'Flights',
  'Homeware':'Homeware & Home Improvements',
  'Home improvements':'Homeware & Home Improvements',
  'Home Improvements':'Homeware & Home Improvements',
  'Homeware & Home Improvements':'Homeware & Home Improvements',
  'Government':'Government',
  'Education':'Education',
  'Medical':'Medical',
  'Insurance':'Insurance',
  'Attractions & events':'Attractions & Events',
  'Attractions & Events':'Attractions & Events',
  'Cafe & coffee':'Cafe & Coffee',
  'Cafe & Coffee':'Cafe & Coffee',
  'Public transport':'Public Transport',
  'Public Transport':'Public Transport',
  'Fees':'Fees',
  'Parking & tolls':'Parking & Tolls',
  'Parking & Tolls':'Parking & Tolls',
  'Accommodation':'Accommodation',
  'Travel expenses':'Travel Expenses & Holidays',
  'Travel Expenses & Holidays':'Travel Expenses & Holidays',
  'Alcohol':'Alcohol',
  'Personal care':'Personal Care & Beauty',
  'Personal Care & Beauty':'Personal Care & Beauty',
  'Gym & fitness':'Gym & Fitness',
  'Gym & Fitness':'Gym & Fitness',
  'Electronics & technology':'Electronics & Technology',
  'Electronics & Technology':'Electronics & Technology',
  'Utilities':'Utilities',
  'Vehicle expenses':'Vehicle Expenses',
  'Vehicle Expenses':'Vehicle Expenses',
  'Services':'Services',
  'Donations':'Other Shopping',
  'Hobbies':'Other Shopping',
  'Gifts':'Other Shopping',
  'Refund':'__REFUND__',
  'Other income':'__OTHER_INCOME__',
  'Other Income':'__OTHER_INCOME__',
  'Internal transfers':'__TRANSFERS__',
  'Internal Transfers':'__TRANSFERS__',
};

function spDateToFY(dateStr){
  // Accepts YYYY-MM-DD or DD Mon YY or DD/MM/YYYY or DD/MM/YY
  let d = null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(dateStr)){
    d = new Date(dateStr);
  } else if(/^\d{2} [A-Za-z]{3} \d{2,4}$/.test(dateStr)){
    d = new Date(dateStr.replace(/(\d{2}) ([A-Za-z]{3}) (\d{2})$/, (m,dd,mon,yy)=>`${dd} ${mon} 20${yy}`));
    if(isNaN(d)) d = new Date(dateStr);
  } else if(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(dateStr)){
    const [dd,mm,yy] = dateStr.split('/');
    const yyyy = yy.length===2 ? '20'+yy : yy;
    d = new Date(`${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);
  } else {
    d = new Date(dateStr);
  }
  if(!d || isNaN(d)) return null;
  return d.getMonth() >= 6 ? d.getFullYear()+1 : d.getFullYear();
}

function spNormaliseDate(dateStr){
  // Returns YYYY-MM-DD
  if(/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if(/^\d{2} [A-Za-z]{3} \d{2}$/.test(dateStr)){
    const d = new Date(dateStr.replace(/(\d{2} [A-Za-z]{3} )(\d{2})$/, '$120$2'));
    if(!isNaN(d)) return d.toISOString().slice(0,10);
  }
  if(/^\d{2} [A-Za-z]{3} \d{4}$/.test(dateStr)){
    const d = new Date(dateStr);
    if(!isNaN(d)) return d.toISOString().slice(0,10);
  }
  if(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(dateStr)){
    let [p1,p2,yy] = dateStr.split('/');
    const yyyy = yy.length===2 ? '20'+yy : yy;
    let dd = p1, mm = p2;
    // If p2 > 12 it cannot be a month — must be MM/DD (US format): swap
    if(parseInt(p2,10) > 12){ dd = p2; mm = p1; }
    // Validate — if month still > 12 after swap, fall through to native parser
    if(parseInt(mm,10) > 12){
      const d = new Date(dateStr);
      return isNaN(d) ? null : d.toISOString().slice(0,10);
    }
    return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
  }
  const d = new Date(dateStr);
  return isNaN(d) ? null : d.toISOString().slice(0,10);
}

// Detect bank format and parse accordingly
// Returns array of {date, fy, amount, category, merchant, details} or null if unrecognised
function parseSpendingCSV(text){
  const lines = text.split(/\r?\n/).filter(l=>l.trim());
  if(lines.length < 2) return null;

  const hdr = lines[0].toLowerCase();
  const cols = lines[0].split(',').map(c=>c.trim().replace(/^"|"$/g,'').toLowerCase());

  // ── FORMAT A: Current bank (Date, Amount, Account Number, , Transaction Type, Transaction Details, Category, Merchant Name)
  if(cols.includes('transaction type') && cols.includes('transaction details') && cols.includes('category')){
    return parseFormatA(lines);
  }

  // ── FORMAT B: Generic (Date, Description/Merchant, Amount, Category?)
  if(cols.includes('date') && (cols.includes('description') || cols.includes('merchant') || cols.includes('details'))){
    return parseFormatGeneric(lines, cols);
  }

  // ── FORMAT C: Try generic with first 3 cols = date, description, amount
  if(cols[0].includes('date') && cols[2].includes('amount') || cols[1].includes('amount')){
    return parseFormatGeneric(lines, cols);
  }

  // Last resort: try generic
  return parseFormatGeneric(lines, cols);
}

function parseFormatA(lines){
  // Date,Amount,Account Number,,Transaction Type,Transaction Details,Category,Merchant Name
  const results = [];
  for(let i=1; i<lines.length; i++){
    const parts = splitCSVLine(lines[i]);
    if(parts.length < 6) continue;
    const dateRaw = (parts[0]||'').trim();
    const amtRaw  = (parts[1]||'').trim();
    const catRaw  = (parts[6]||'').trim();
    const merch   = (parts[7]||'').trim() || (parts[5]||'').trim().slice(0,40);
    const details = (parts[5]||'').trim();
    const amt = parseFloat(amtRaw);
    if(!dateRaw || isNaN(amt)) continue;
    const date = spNormaliseDate(dateRaw);
    if(!date) continue;
    const fy = spDateToFY(date);
    if(!fy) continue;
    const category = SP_CAT_MAP[catRaw] || 'Other Shopping';
    results.push({date, fy, amount:amt, category, merchant:merch||details.slice(0,40), details});
  }
  return results;
}

function parseFormatGeneric(lines, cols){
  // Try to find date, amount, description/merchant, category columns
  const ci = name => {
    const idx = cols.findIndex(c=>c.includes(name));
    return idx >= 0 ? idx : -1;
  };
  const iDate   = ci('date');
  const iAmt    = cols.findIndex(c=>c.includes('amount') || c.includes('debit') || c.includes('credit'));
  const iMerch  = cols.findIndex(c=>c.includes('merchant') || c.includes('description') || c.includes('details') || c.includes('narration') || c.includes('narrative'));
  const iCat    = ci('categor');
  if(iDate<0 || iAmt<0) return null;

  const results = [];
  for(let i=1; i<lines.length; i++){
    const parts = splitCSVLine(lines[i]);
    const dateRaw = (parts[iDate]||'').trim();
    const amtRaw  = (parts[iAmt]||'').replace(/[$,]/g,'').trim();
    const merch   = iMerch>=0 ? (parts[iMerch]||'').trim() : dateRaw;
    const catRaw  = iCat>=0 ? (parts[iCat]||'').trim() : '';
    const amt = parseFloat(amtRaw);
    if(!dateRaw || isNaN(amt) || amt===0) continue;
    const date = spNormaliseDate(dateRaw);
    if(!date) continue;
    const fy = spDateToFY(date);
    if(!fy) continue;
    const category = SP_CAT_MAP[catRaw] || (amt>0 ? '__OTHER_INCOME__' : 'Other Shopping');
    results.push({date, fy, amount:amt, category, merchant:merch.slice(0,60), details:merch});
  }
  return results;
}

function splitCSVLine(line){
  // Handles quoted fields with commas inside
  const result = [];
  let cur = '', inQ = false;
  for(let i=0; i<line.length; i++){
    const ch = line[i];
    if(ch==='"'){ inQ=!inQ; }
    else if(ch===',' && !inQ){ result.push(cur); cur=''; }
    else { cur+=ch; }
  }
  result.push(cur);
  return result;
}

function isDupSpend(rec, existing){
  return existing.some(e=>
    e.date === rec.date &&
    Math.abs(e.amount - rec.amount) < 0.01 &&
    e.merchant.slice(0,20) === rec.merchant.slice(0,20)
  );
}

function importSpendingCSV(input){
  const file = input.files[0];
  if(!file) return;
  const status = $('sp-import-status');
  status.style.display='';
  status.style.color='var(--text3)';
  status.textContent = 'Reading '+file.name+'…';

  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const parsed = parseSpendingCSV(text);
    if(!parsed || parsed.length===0){
      status.style.color='var(--red)';
      status.textContent = '✗ Could not parse CSV — check format. Expected columns: Date, Amount, Category, Merchant/Description.';
      input.value='';
      return;
    }
    // Dedup against existing
    let added=0, skipped=0;
    for(const rec of parsed){
      if(isDupSpend(rec, spendingData)){ skipped++; }
      else { spendingData.push(rec); added++; }
    }
    saveSpending();
    // Update FY to show the imported data's FY
    const fys = [...new Set(spendingData.map(d=>d.fy))].sort();
    spFY = fys[fys.length-1];
    spCatFilter=null; spInCatFilter=null;
    renderSpFYBar();
    renderSpending();
    status.style.color='var(--green)';
    status.textContent = `✓ Imported ${added} transactions from ${file.name}${skipped?' ('+skipped+' duplicates skipped)':''}`;
    input.value='';
  };
  reader.readAsText(file);
}

function clearSpendingData(){
  if(!confirm('Delete ALL spending data? This cannot be undone.')) return;
  spendingData=[];
  localStorage.removeItem('pt_spending');
  spFY=null; spCatFilter=null; spInCatFilter=null;
  renderSpFYBar(); renderSpending();
  notify('Spending data cleared.','ok');
}


function sortSpTxn(col){
  if(spSortTxn.col===col) spSortTxn.dir*=-1;
  else { spSortTxn.col=col; spSortTxn.dir = col==='date'?-1:(col==='amount'?-1:1); }
  renderSpending();
}


// ── BACKUP & RESTORE ──────────────────────────────────────────────────

const BACKUP_VERSION = 1;
let _pendingRestore = null;
