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
  [/veneta blinds|\bblinds\b/i,                  'Homeware & Home Improvements'],
  [/philips hue|\bhue webstore/i,                'Electronics & Technology'],
  [/instant gaming|gamesplanet/i,                 'Attractions & Events'],
  [/\bgrab\b/i,                                  'Public Transport'],
  [/fanatec/i,                                    'Electronics & Technology'],
  [/\bunited\s*x{3,}|united airlines/i,           'Flights'],
  [/handling fee/i,                               'Fees'],
  [/annual fee|card fee|interest charge|international transaction fee/i, 'Fees'],
  [/trip\.?com|expedia|agoda/i,                  'Travel Expenses & Holidays'],
  [/telecom billing|mva\*/i,                     'Phone & Internet'],
  [/sukanlaya|kusuka|siam smash|momo house|crepe shop|subway|beaumont|dessertland/i, 'Restaurants & Takeaway'],
  [/majestea|charleys|jocelyns provisions/i,      'Cafe & Coffee'],
  [/lavender/i,                                   'Attractions & Events'],
  [/\baje\b/i,                                    'Clothing & Accessories'],
  [/nordvpn|\bvpn\b/i,                            'Electronics & Technology'],
  [/pillow talk/i,                                'Homeware & Home Improvements'],
  [/\bunion\b|association|membership/i,           'Services'],
  [/woolworths|coles|aldi|iga\b/i,                'Groceries'],
  [/ampol|bp\b|shell|caltex|7-eleven|united petrol/i, 'Fuel'],
  [/qantas|jetstar|virgin australia|rex airlines/i,   'Flights'],
  [/uber eats|menulog|doordash|mcdonald|kfc|domino/i, 'Restaurants & Takeaway'],
  [/cafe|coffee|starbucks|gloria jean/i,          'Cafe & Coffee'],
  [/telstra|optus|vodafone|aussie broadband|belong/i, 'Phone & Internet'],
  [/bunnings|ikea|spotlight/i,              'Homeware & Home Improvements'],
  [/translink|go card|uber(?! eats)|didi/i,       'Public Transport'],
  [/linkt|transurban|parking|secure parking/i,    'Parking & Tolls'],
  [/chemist|pharmacy|priceline|medical|dental/i,  'Medical'],
  [/airbnb|booking\.com|hotel|resort|motel/i,     'Accommodation'],
  [/anytime fitness|f45|gym|fitness/i,            'Gym & Fitness'],
  [/jb hi-?fi|apple\.com|harvey norman/i, 'Electronics & Technology'],
  [/ato\b|service nsw|qld gov|transport and main roads|council/i, 'Government'],
  [/insurance|nrma|racq|allianz|aami/i,           'Insurance'],
  [/netflix|spotify|disney|stan\b|binge|steam/i,  'Attractions & Events'],
];

// ── Learn categories from your existing (CSV-imported) history ──────────
// Your bank's CSV carried a category per merchant; Odoo only has raw text. So we
// index every past expense by the leading words of its merchant/details text and
// reuse the category you already have for the same merchant.
const ODOO_NOISE = new Set(['AU','AUS','AUD','QLD','NSW','VIC','WA','SA','TAS','NT','ACT','PTY','LTD',
  'CARD','PURCHASE','EFTPOS','VISA','DEBIT','CREDIT','MASTERCARD','PAYWAVE','VALUE','DATE','AUSTRALIA']);

function odooTokens(s){
  return String(s || '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/)
    .filter(t => t.length >= 2 && !/\d/.test(t) && !ODOO_NOISE.has(t));
}

function odooBuildIndex(){
  const idx = new Map();                       // key -> { category: count }
  for(const d of spendingData){
    if(d.odooId != null || d.amount >= 0 || !d.category || d.category.startsWith('__') || d.category === 'Other Shopping') continue;
    for(const text of [d.merchant, d.details]){
      const toks = odooTokens(text);
      for(let L = 1; L <= 3 && L <= toks.length; L++){
        const key = toks.slice(0, L).join(' ');
        if(key.length < 4) continue;
        const e = idx.get(key) || {};
        e[d.category] = (e[d.category] || 0) + 1;
        idx.set(key, e);
      }
    }
  }
  return idx;
}

function odooLearned(idx, texts){
  for(const L of [3, 2, 1]){
    for(const text of texts){
      const toks = odooTokens(text);
      // sliding start tolerates prefixes like "VISA PURCHASE 12MAR" before the merchant
      for(let st = 0; st <= Math.min(3, toks.length - L); st++){
        const e = idx.get(toks.slice(st, st + L).join(' '));
        if(!e) continue;
        const ents = Object.entries(e).sort((a, b) => b[1] - a[1]);
        const total = ents.reduce((n, [, c]) => n + c, 0);
        const [cat, cnt] = ents[0];
        // a single common word (e.g. "UBER") must be a clear, repeated majority
        if(L >= 2 || (cnt >= 2 && cnt / total >= 0.8)) return cat;
      }
    }
  }
  return null;
}

function odooRuleCat(merchant){
  for(const [re, cat] of ODOO_CAT_RULES) if(re.test(merchant)) return cat;
  return null;
}

function odooCategorise(merchant, amount, ref, idx){
  // Card payments into the card (positive, "payment"/"transfer"-like) are internal transfers.
  if(amount > 0 && /payment|transfer|bpay|thank you/i.test(merchant)) return '__TRANSFERS__';
  if(amount > 0) return '__REFUND__';
  return (idx && odooLearned(idx, [merchant, ref])) || odooRuleCat(merchant) || 'Other Shopping';
}

// Re-run categorisation on rows (Odoo or CSV) still sitting in "Other Shopping" — picks up
// newly learned history and new rules without re-importing anything.
function odooRecategorise(){
  const idx = odooBuildIndex();
  let n = 0;
  for(const d of spendingData){
    if(d.amount >= 0 || d.category !== 'Other Shopping') continue;
    const c = odooLearned(idx, [d.merchant, d.details]) || odooRuleCat(d.merchant);
    if(c && c !== 'Other Shopping'){ d.category = c; n++; }
  }
  return n;
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

  // Incremental start point comes from the DATA, not a stored date: the newest Odoo row
  // already in Spending, minus a 7-day overlap for late-posting transactions. If there are
  // no Odoo rows at all (first run, or after restoring an older backup) it pulls everything.
  // This self-heals after any restore, which a separately stored "last sync" date can't.
  if(typeof loadSpending === 'function' && !spendingData.length) loadSpending();
  const odooDates = spendingData.filter(d => d.odooId != null).map(d => d.date).sort();
  let since = '';
  if(odooDates.length && !opts.full){
    const d = new Date(odooDates[odooDates.length - 1] + 'T00:00:00'); d.setDate(d.getDate() - 7);
    since = localDateStr(d);
  }

  say('Syncing from Odoo…');
  try{
    const r = await fetch(`${base}/?odooTxns=1${since ? '&since=' + since : ''}&key=${encodeURIComponent(token)}`);
    if(r.status === 401){ say('✗ Sync token rejected — re-enter it.', 'var(--red)'); localStorage.removeItem(ODOO_TOKEN_KEY); return; }
    const data = await r.json();
    if(!r.ok || data.error){ say('✗ Odoo sync failed: ' + (data.error || r.status), 'var(--red)'); return; }

    const fysBefore = new Set(spendingData.map(d => d.fy));
    const catIdx = odooBuildIndex();
    const byId = new Map(spendingData.filter(d => d.odooId != null).map(d => [d.odooId, d]));
    const haveIds = new Set(byId.keys());
    let added = 0, skipped = 0;
    for(const t of data.rows){
      const merchant = (t.merchant || t.ref || 'Unknown').slice(0, 60);
      const date = t.date;                       // already YYYY-MM-DD from Odoo
      const fy = spDateToFY(date);
      if(!fy) continue;
      const card = (t.journal || (t.journalId != null ? 'Card ' + t.journalId : '')).slice(0, 40);
      const rec = { date, fy, amount: t.amount, category: odooCategorise(merchant, t.amount, t.ref, catIdx),
                    merchant, details: t.ref || merchant, odooId: t.id, card };
      // Odoo id is authoritative; fall back to the CSV-style heuristic so rows
      // already imported from a CSV aren't doubled up.
      // Rows synced before the card filter existed get their card label filled in here.
      if(byId.has(rec.odooId) && card && byId.get(rec.odooId).card !== card) byId.get(rec.odooId).card = card;
      if(haveIds.has(rec.odooId) || isDupSpend(rec, spendingData.filter(d => d.odooId == null))){ skipped++; continue; }
      spendingData.push(rec); haveIds.add(rec.odooId); added++;
    }
    const recat = odooRecategorise();
    saveSpending();
    localStorage.setItem(ODOO_LAST_KEY, localDateStr());
    const fys = [...new Set(spendingData.map(d => d.fy))].filter(f => f != null).sort((a,b) => b-a);
    // A brand-new FY appearing (e.g. first July transactions) becomes the selected view;
    // otherwise keep whatever FY is being looked at.
    if(!fys.includes(spFY) || fys.some(f => !fysBefore.has(f) && f > spFY)) spFY = fys[0];
    renderSpFYBar(); renderSpending();
    say(`✓ Odoo: ${added} new transaction${added===1?'':'s'}${skipped ? ' (' + skipped + ' already present)' : ''}${recat ? ', ' + recat + ' recategorised' : ''}`, 'var(--green)');
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