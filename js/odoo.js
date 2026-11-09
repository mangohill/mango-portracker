// ── odoo.js ──────────────────────────────────────────────────────────
// Pulls credit card transactions from Odoo (via your Cloudflare Worker) into
// the Spending tab. The Worker holds the Odoo API key; this file only holds
// the Worker's own sync token. Safe to remove this file and its <script> tag
// (plus the SYNC ODOO button) with zero effect on anything else.

const ODOO_TOKEN_KEY = 'pt_odoo_token';
const ODOO_LAST_KEY  = 'pt_odoo_last_sync';

// Odoo has no category taxonomy matching SP_CAT_MAP, so map by merchant text.
// First match wins; anything unmatched becomes "Other Shopping" and can be
// recategorised by adding a rule here. Edit freely.
const ODOO_CAT_RULES = [
  [/woolworths|coles|aldi|iga\b/i,                'Groceries'],
  [/ampol|bp\b|shell|caltex|7-eleven|united petrol/i, 'Fuel'],
  [/qantas|jetstar|virgin australia|rex airlines/i,   'Flights'],
  [/uber eats|menulog|doordash|mcdonald|kfc|domino/i, 'Restaurants & Takeaway'],
  [/cafe|coffee|starbucks|gloria jean/i,          'Cafe & Coffee'],
  [/telstra|optus|vodafone|aussie broadband|belong/i, 'Phone & Internet'],
  [/bunnings|ikea|kmart|spotlight/i,              'Homeware & Home Improvements'],
  [/translink|go card|uber(?! eats)|didi/i,       'Public Transport'],
  [/linkt|transurban|parking|secure parking/i,    'Parking & Tolls'],
  [/chemist|pharmacy|priceline|medical|dental/i,  'Medical'],
  [/airbnb|booking\.com|hotel|resort|motel/i,     'Accommodation'],
  [/anytime fitness|f45|gym|fitness/i,            'Gym & Fitness'],
  [/jb hi-?fi|apple\.com|officeworks|harvey norman/i, 'Electronics & Technology'],
  [/ato\b|service nsw|qld gov|transport and main roads|council/i, 'Government'],
  [/insurance|nrma|racq|allianz|aami/i,           'Insurance'],
  [/netflix|spotify|disney|stan\b|binge|steam/i,  'Attractions & Events'],
];

function odooCategorise(merchant, amount){
  // Card payments into the card (positive, "payment"/"transfer"-like) are internal transfers.
  if(amount > 0 && /payment|transfer|bpay|thank you/i.test(merchant)) return '__TRANSFERS__';
  if(amount > 0) return '__REFUND__';
  for(const [re, cat] of ODOO_CAT_RULES) if(re.test(merchant)) return cat;
  return 'Other Shopping';
}

function odooWorkerURL(){
  const u = (typeof getWorkerURL === 'function' ? getWorkerURL() : localStorage.getItem('cf_worker_url')) || '';
  return u.replace(/\/+$/, '');
}

function odooSetToken(){
  const cur = localStorage.getItem(ODOO_TOKEN_KEY) || '';
  const t = prompt('Odoo sync token (the ODOO_SYNC_TOKEN secret you set on your Worker):', cur);
  if(t === null) return false;
  localStorage.setItem(ODOO_TOKEN_KEY, t.trim());
  return !!t.trim();
}

async function syncOdoo(opts = {}){
  const status = $('sp-import-status');
  const say = (msg, color) => { if(!status) return; status.style.display=''; status.style.color = color || 'var(--text3)'; status.textContent = msg; };

  const base = odooWorkerURL();
  if(!base){ say('✗ Set your Cloudflare Worker URL in Settings first.', 'var(--red)'); return; }
  let token = localStorage.getItem(ODOO_TOKEN_KEY) || '';
  if(!token){ if(!odooSetToken()) return; token = localStorage.getItem(ODOO_TOKEN_KEY); }

  // Incremental: last successful sync date minus a 7-day overlap (late-posting
  // transactions); full history on first run or when opts.full is set.
  const last = localStorage.getItem(ODOO_LAST_KEY);
  let since = '';
  if(last && !opts.full){
    const d = new Date(last + 'T00:00:00'); d.setDate(d.getDate() - 7);
    since = localDateStr(d);
  }

  say('Syncing from Odoo…');
  try{
    const r = await fetch(`${base}/?odooTxns=1${since ? '&since=' + since : ''}&key=${encodeURIComponent(token)}`);
    if(r.status === 401){ say('✗ Sync token rejected — re-enter it.', 'var(--red)'); localStorage.removeItem(ODOO_TOKEN_KEY); return; }
    const data = await r.json();
    if(!r.ok || data.error){ say('✗ Odoo sync failed: ' + (data.error || r.status), 'var(--red)'); return; }

    if(typeof loadSpending === 'function' && !spendingData.length) loadSpending();
    const fysBefore = new Set(spendingData.map(d => d.fy));
    const haveIds = new Set(spendingData.filter(d => d.odooId != null).map(d => d.odooId));
    let added = 0, skipped = 0;
    for(const t of data.rows){
      const merchant = (t.merchant || t.ref || 'Unknown').slice(0, 60);
      const date = t.date;                       // already YYYY-MM-DD from Odoo
      const fy = spDateToFY(date);
      if(!fy) continue;
      const rec = { date, fy, amount: t.amount, category: odooCategorise(merchant, t.amount),
                    merchant, details: t.ref || merchant, odooId: t.id };
      // Odoo id is authoritative; fall back to the CSV-style heuristic so rows
      // already imported from a CSV aren't doubled up.
      if(haveIds.has(rec.odooId) || isDupSpend(rec, spendingData.filter(d => d.odooId == null))){ skipped++; continue; }
      spendingData.push(rec); haveIds.add(rec.odooId); added++;
    }
    saveSpending();
    localStorage.setItem(ODOO_LAST_KEY, localDateStr());
    const fys = [...new Set(spendingData.map(d => d.fy))].filter(f => f != null).sort((a,b) => b-a);
    // A brand-new FY appearing (e.g. first July transactions) becomes the selected view;
    // otherwise keep whatever FY is being looked at.
    if(!fys.includes(spFY) || fys.some(f => !fysBefore.has(f) && f > spFY)) spFY = fys[0];
    renderSpFYBar(); renderSpending();
    say(`✓ Odoo: ${added} new transaction${added===1?'':'s'}${skipped ? ' (' + skipped + ' already present)' : ''}`, 'var(--green)');
  }catch(e){
    say('✗ Odoo sync error: ' + e.message, 'var(--red)');
  }
}

// Auto-sync once per day on app open, only if a token has already been set up.
setTimeout(() => {
  try{
    if(localStorage.getItem(ODOO_TOKEN_KEY) && localStorage.getItem(ODOO_LAST_KEY) !== localDateStr()) syncOdoo();
  }catch(e){}
}, 2500);
