// ── dividends.js ─────────────────────────────────────────────

function parseBinanceCSV(text, filename){
  const lines = text.split(/\r?\n/);
  if(!lines.length){ notify('Empty file.','err'); return; }

  // Detect header
  const header = lines[0].replace(/^\uFEFF/,'').split(',').map(h=>h.trim().toLowerCase());
  const col = h => header.indexOf(h);
  const iTime   = col('time');
  const iPair   = col('pair');
  const iSide   = col('side');
  const iExec   = col('executed');
  const iAvg    = col('average price');
  const iTotal  = col('trading total');
  const iStatus = col('status');

  if(iTime<0||iPair<0||iSide<0||iExec<0||iAvg<0){
    notify('Not a recognised Binance orders CSV.','err'); return;
  }

  let added=0, skipped=0, errors=0;
  const parseNum = s => parseFloat((s||'').replace(/[^0-9.]/g,''));

  for(let i=1; i<lines.length; i++){
    const line = lines[i].trim();
    if(!line) continue;
    const cols = line.split(',');
    if(cols.length < header.length) continue;

    const pair   = (cols[iPair]||'').trim();
    const side   = (cols[iSide]||'').trim().toUpperCase();
    const status = iStatus>=0 ? (cols[iStatus]||'').trim().toUpperCase() : 'FILLED';
    if(!pair || status !== 'FILLED') continue;

    // Date from Time column (execution date): "30/04/2022 21:45" → "2022-04-30"
    const timeStr = (cols[iTime]||'').trim();
    const dm = timeStr.match(/(\d+)\/(\d+)\/(\d+)/);
    if(!dm){ errors++; continue; }
    const date = `${dm[3]}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;

    // Symbol: strip AUD/USDT/BTC/ETH/BNB suffix
    const symbol = pair.replace(/(?:AUD|USDT|BUSD|USDC|BTC|ETH|BNB)$/, '').toUpperCase();
    if(!symbol){ errors++; continue; }

    const units = parseNum(cols[iExec]);
    const price = parseFloat((cols[iAvg]||'').trim());
    if(!units||!price||isNaN(units)||isNaN(price)){ errors++; continue; }

    const type = side==='BUY' ? 'buy' : side==='SELL' ? 'sell' : null;
    if(!type){ errors++; continue; }

    const trade = {
      date, type, symbol,
      assetType: 'crypto',
      units: +units.toFixed(8),
      price: +price.toFixed(8),
      fees: 0,
      source: 'binance',
      notes: 'Binance import',
      id: uid(),
    };

    if(isTradeDuplicate(trade)){ skipped++; continue; }
    trades.push(trade);
    added++;
  }

  if(added){ save(); renderT(); renderH(); renderR(); if(typeof renderAnalytics==='function') renderAnalytics(); }
  notify(`Binance CSV: ${added} imported, ${skipped} skipped (dupes)${errors?', '+errors+' errors':''}`,
         added?'ok':'err');
}

function importDividendFile(input){
  const files = Array.from(input.files);
  if(!files.length) return;
  input.value = '';

  // If multiple files or all PDFs — use batch registry import
  const allPDF = files.every(f => f.name.toLowerCase().endsWith('.pdf'));
  const isMulti = files.length > 1;

  if(isMulti || (allPDF && !/commsec|interest.*dividend|dividend.*interest|eofy/i.test(files[0].name))){
    // Batch registry PDF import (reuses importDividendPDF logic inline)
    importDividendPDF({files, value:''});
    return;
  }

  const file = files[0];
  $('div-import-status').textContent = 'Reading ' + file.name + '…';
  $('div-import-preview').style.display = 'none';

  const reader = new FileReader();

  if(file.name.toLowerCase().endsWith('.pdf')){
    const isCommSec = /commsec|interest.*dividend|dividend.*interest|eofy/i.test(file.name);
    if(isCommSec){
      reader.onload = e => parseDividendPDF(e.target.result, file.name);
      reader.readAsArrayBuffer(file);
    } else {
      (async () => {
        const status = $('div-import-status');
        status.textContent = 'Reading ' + file.name + '…';
        try {
                  const result = await parseRegistryPDF(file);
          if(!result){ status.textContent = 'Could not parse PDF.'; return; }
          if(result.type === 'drp'){
            const { date, symbol, units, drpPrice, amount, carryIn, carryOut } = result;
            const assetType = resolveAssetType(symbol) || 'asx_stock';
            const trade = {
              date, type:'drp', symbol, assetType,
              units, price: drpPrice, fees:0, source:($('dv-drp-source')?.value||'drp'), id:uid(),
              notes:'DRP ' + nN(units,4) + ' units @ ' + n2(drpPrice,dec(drpPrice))
                   + (carryIn > 0.005 ? ' (incl. ' + n2(carryIn) + ' carry-in)' : ''),
            };
            const div = {
              date, symbol, amount, type:'drp', id:uid(),
              notes:'Declared ' + n2(amount)
                   + (carryIn  > 0.005 ? ' + ' + n2(carryIn) + ' carry-in' : '')
                   + ' → ' + nN(units,4) + ' units @ ' + n2(drpPrice,dec(drpPrice))
                   + (carryOut > 0.005 ? ' | carry-out ' + n2(carryOut) : ''),
            };
            if(isTradeDuplicate(trade)){ status.textContent = 'Skipped — duplicate DRP record.'; return; }
            const carry = getDRPCarry();
            if(carryOut > 0.005) carry[symbol] = carryOut; else delete carry[symbol];
            saveDRPCarry(carry);
            trades.push(trade); dividends.push(div);
          } else {
            const { date, symbol, amount } = result;
            const dup = dividends.some(d => d.date===date && d.symbol===symbol && Math.abs(+d.amount - +amount)<0.01);
            if(dup){ status.textContent = 'Skipped — duplicate dividend record.'; return; }
            dividends.push({ date, symbol, amount, type:'dividend', id:uid() });
          }
          save();
          renderFYBar(); renderDividends(); renderDivCharts(); renderDivCards(); renderH(); renderT();
          status.textContent = '✓ Imported ' + result.symbol + ' ' + result.type + ' $' + result.amount;
          notify('✓ ' + result.symbol + ' ' + result.type + ' imported');
        } catch(e){
          status.textContent = 'Error: ' + e.message;
          console.error('PDF import error:', e);
        }
      })();
      return;
    }
  } else {
    reader.onload = e => {
      const text = e.target.result;
      const firstLine = text.split('\n')[0].replace(/^\uFEFF/,'').toLowerCase();
      // Detect Binance orders CSV
      if(firstLine.includes('orderno') && firstLine.includes('pair') && firstLine.includes('executed')){
        parseBinanceCSV(text, file.name);
      // Detect Selfwealth cash account CSV
      } else if(firstLine.includes('transactiondate') && firstLine.includes('comment') && firstLine.includes('credit')){
        parseSelfwealthDivCSV(text, file.name);
      } else {
        parseDividendCSV(text, file.name);
      }
    };
    reader.readAsText(file);
  }
}

// ── DUPLICATE CHECK ───────────────────────────────────────────────────
function diagnoseTrades(){
  // Check for common data issues and notify the user
  const issues = [];
  // Check: any symbol has merger_from but no matching merger_to fromSymbol
  const mergerFroms = trades.filter(t=>t.type==='corporate_action'&&t.subtype==='merger_from');
  const mergerTos   = trades.filter(t=>t.type==='corporate_action'&&t.subtype==='merger_to');
  mergerFroms.forEach(mf=>{
    const hasPair = mergerTos.some(mt=>mt.fromSymbol===mf.symbol&&mt.date===mf.date);
    if(!hasPair) issues.push(`Merger: ${mf.symbol} has merger_from on ${mf.date} but no matching merger_to (missing fromSymbol?)`);
  });
  // Check: symbol appears in both regular trades AND as merger_from on same date
  mergerFroms.forEach(mf=>{
    const laterBuys = trades.filter(t=>t.symbol===mf.symbol&&t.type==='buy'&&t.date>mf.date);
    if(laterBuys.length) issues.push(`Warning: ${mf.symbol} has buys AFTER merger_from on ${mf.date} — were these meant for ${mergerTos.find(mt=>mt.date===mf.date)?.symbol||'new symbol'}?`);
  });
  // Check: duplicate corporate actions on same symbol+date+subtype
  const seen = {};
  trades.filter(t=>t.type==='corporate_action').forEach(t=>{
    const key = t.symbol+'|'+t.date+'|'+t.subtype;
    if(seen[key]) issues.push(`Duplicate corporate action: ${t.symbol} ${t.subtype} on ${t.date}`);
    seen[key] = true;
  });
  if(issues.length){
    issues.forEach(i=>console.warn('[Portfolio] '+i));
    notify('⚠ Trade data issues detected — check console for details. This may cause wrong P&L.','err');
  }
  return issues;
}

function isTradeDuplicate(t){
  return trades.some(x =>
    x.date   === t.date &&
    x.symbol === t.symbol &&
    x.type   === t.type &&
    Math.abs((+x.units) - (+t.units)) < 0.0001 &&
    Math.abs((+x.price) - (+t.price)) < 0.001
  );
}

function isDivDuplicate(d){
  return dividends.some(x =>
    x.date === d.date &&
    x.symbol === d.symbol &&
    Math.abs((+x.amount) - (+d.amount)) < 0.005
  );
}


// ── PDF DIVIDEND / DRP PARSER ────────────────────────────────────────────
// Supports: MUFG/Boardroom/Link dividend statements, DRP allotment advices

async function importDividendPDF(input){
  const files = Array.from(input.files);  // snapshot BEFORE clearing
  if(!files.length) return;
  input.value = '';  // clear after snapshot

  let imported = 0, skipped = 0, errors = [];

  for(const file of files){
    try {
          const result = await parseRegistryPDF(file);
      if(!result){ errors.push(file.name + ': could not parse'); continue; }

      if(result.type === 'drp'){
        // DRP: create trade + dividend
        const { date, symbol, units, drpPrice, amount, carryIn, carryOut, notes } = result;
        const assetType = result.assetType || resolveAssetType(symbol) || 'asx_stock';
        const price = drpPrice || (units && amount ? amount / units : 0);
        const trade = {
          date, type:'drp', symbol, assetType,
          units, price, fees:0, source:($('dv-drp-source')?.value||'drp'), id:uid(),
          notes: notes||'',
        };
        const div = {
          date, symbol, amount, type:'drp', id:uid(),
          notes: notes||'',
          frankingPct: result.frankingPct ?? null,
        };
        // Skip if duplicate (match on drp type, which is what we save)
        if(isTradeDuplicate(trade)){
          skipped++; continue;
        }
        // Update carry-forward
        const carry = getDRPCarry();
        if((carryOut||0) > 0.005) carry[symbol] = carryOut;
        else delete carry[symbol];
        saveDRPCarry(carry);

        trades.push(trade);
        dividends.push(div);
        imported++;

      } else {
        // Plain dividend
        const { date, symbol, amount, divType, notes } = result;
        if(isDivDuplicate({date, symbol, amount})){
          skipped++; continue;
        }
        dividends.push({ date, symbol, amount, type: divType||result.type||'dividend',
          notes, id: uid(),
          frankingPct: result.frankingPct ?? null });
        imported++;
      }
    } catch(e){
      errors.push(file.name + ': ' + e.message);
      console.error('PDF import error:', e);
    }
  }

  if(imported > 0){
    save();
    renderFYBar(); renderDividends(); renderDivCharts(); renderDivCards();
    renderH(); renderT();
  }

  let msg = '';
  if(imported)  msg += '✓ ' + imported + ' record' + (imported!==1?'s':'') + ' imported';
  if(skipped)   msg += (msg?' · ':'')+skipped+' skipped (duplicate)';
  if(errors.length) msg += (msg?' · ':'')+errors.join('; ');
  backupStatus(msg || 'Nothing imported', imported ? 'var(--green)' : errors.length ? 'var(--red)' : 'var(--gold)');
  notify(msg || 'Nothing imported');
}

async function parseRegistryPDF(file){
  const text = await extractPDFText(file);
  if(!text || text.length < 50) throw new Error('No text extracted from PDF — file may be image-based or encrypted');

  const r = {};
  let m;

  // Symbol
  m = text.match(/Quoted\s+([A-Z0-9]{2,6})\s+(?:CHESS|ISSUER)/i)
    || text.match(/ASX\s*Code[:\s]+([A-Z][A-Z0-9]{1,5})\b(?!\s+(?:Number|of|shares|held))/i)
    || text.match(/\bASX[:\s]+([A-Z0-9]{2,6})\b/);
  r.symbol = m ? m[1].toUpperCase() : null;

  const isDRP = /dividend re-?invest|DRP|reinvestment plan|securities allotted|shares allotted/i.test(text);
  r.type = isDRP ? 'drp' : 'dividend';

  // Date
  m = text.match(/Allotment [Dd]ate[:\s]+(\d{1,2}[\s\/]\w+[\s\/]\d{4})/i)
    || text.match(/Allotment [Dd]ate[:\s]+(\d{1,2}\/\d{2}\/\d{4})/i);
  if(!m){
    const dates = text.match(/\b(\d{2}\/\d{2}\/\d{4})\b/g);
    if(dates && dates.length >= 2) r.date = parseFlexDate(dates[1]);
    else if(dates && dates.length === 1) r.date = parseFlexDate(dates[0]);
  }
  if(m) r.date = parseFlexDate(m[1]);

  // Dividend rate per share
  // Strategy: find "NN cents $TOTAL" anchored to the actual total amount (avoids LIC/NZ rate noise)
  let ratePerShare = null;
  let rateMatch = null;
  // Will be set after amount is known — placeholder for now
  let _rateRaw = null;
  // Capture all "NN cents" occurrences and pick the right one after we know the amount
  const _centsMatches = [...text.matchAll(/(\d+(?:\.\d+)?)\s+cents/gi)];

  // Units held at record date
  // "641 *****115" — holder's unit count precedes masked account number
  let unitsHeld = null;
  m = text.match(/\b(\d{2,6})\s+\*+\d+\b/);
  if(m) unitsHeld = parseFloat(m[1]);
  // Fallback: "641 Fully Paid" style
  if(!unitsHeld){ m = text.match(/\b(\d{3,6})\s+Fully\s+Paid/i); if(m) unitsHeld = parseFloat(m[1]); }

  // Description type (Final / Interim / Special)
  m = text.match(/\b(Final|Interim|Special)\s+Dividend/i);
  const divDesc = m ? m[1] : 'Dividend';

  // Amount
  m = text.match(/Dividend Paid[\s\S]{0,80}?A\$[\d.]+\s+[\d,]+\s+A\$([\d,]+\.\d{2})/i);
  if(!m) m = text.match(/Total net amount[:\s]+A?\$?([\d,]+\.\d{2})/i);
  if(!m){
    const gaIdx = text.search(/Gross amount/i);
    if(gaIdx >= 0){
      const allAmts = [...text.slice(gaIdx).matchAll(/\$([\d,]+\.\d{2})/g)].map(x=>x[1]);
      const big = allAmts.find(v => parseFloat(v.replace(/,/g,'')) > 10);
      if(big) m = [null, big];
    }
  }
  if(!m) m = text.match(/\d+(?:\.\d+)?\s+cents\s+\$([\d,]+\.\d{2})/i);
  if(!m) m = text.match(/([\d,]+\.\d{2})\s+AUD\b/);
  r.amount = m ? parseFloat(m[1].replace(/,/g,'')) : null;

  if(isDRP){
    m = text.match(/Number of (?:shares|securities) allotted[:\s]+([\d,]+)/i);
    r.units = m ? parseFloat(m[1].replace(/,/g,'')) : null;
    // DRP price: "100 shares at A$3.5948" or "17 shares at A$6.90"
    m = text.match(/[\d,]+\s+(?:shares|securities)\s+at\s+A?\$([\d.]+)/i)
      || text.match(/allotment\s+price[:\s]+A?\$?([\d.]+)/i)
      || text.match(/price\s+per\s+(?:share|security)[:\s]+A?\$?([\d.]+)/i);
    r.drpPrice = m ? parseFloat(m[1]) : (r.units && r.amount ? r.amount/r.units : null);
    m = text.match(/[Bb]alance brought forward[^$]*A?\$([\d.]+)/i);
    r.carryIn = m ? parseFloat(m[1]) : 0;
    m = text.match(/[Bb]alance carried forward[^$]*A?\$([\d.]+)/i);
    r.carryOut = m ? parseFloat(m[1]) : 0;

    // Notes: "RF1 declared $359.64 → 100 units @ $3.5948 | carry-out $0.16"
    const priceStr = r.drpPrice ? '$' + r.drpPrice.toFixed(4).replace(/\.?0+$/, '') : '?';
    r.notes = r.symbol + ' declared $' + r.amount.toFixed(2)
      + ' → ' + (r.units||'?') + ' units @ ' + priceStr
      + (r.carryOut > 0.005 ? ' | carry-out $' + r.carryOut.toFixed(2) : '');
  } else {
    // Resolve rate anchored to actual amount (avoids LIC/NZ noise)
    if(!ratePerShare && r.amount){
      const amtStr = r.amount.toFixed(2);
      let rm = text.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s+cents\\s+\\$' + amtStr.replace('.','\\.')));
      if(rm) ratePerShare = parseFloat(rm[1]) / 100;
      if(!ratePerShare && _centsMatches.length){
        const amtIdx = text.indexOf(amtStr);
        const before = _centsMatches.filter(mx => mx.index < amtIdx);
        if(before.length) ratePerShare = parseFloat(before[before.length-1][1]) / 100;
      }
    }
    // Notes: "ARG Final - $0.20/share × 641 units"
    const ratePart = ratePerShare ? '$' + ratePerShare.toFixed(4).replace(/\.?0+$/,'') + '/share' : null;
    const unitsPart = unitsHeld ? unitsHeld.toLocaleString() + ' units' : null;
    r.notes = r.symbol + ' ' + divDesc
      + (ratePart ? ' - ' + ratePart : '')
      + (unitsPart ? ' × ' + unitsPart : '');

    // ── Extract franking % from registry PDF ────────────────────
    // Pattern 1: explicit franking credit amount → calculate %
    let frankingPct = null;
    let fcMatch = text.match(/[Ff]ranking\s+[Cc]redit[s]?[:\s]+A?\$?([\d,]+\.\d+)/i)
                || text.match(/[Ff]ranking\s+[Cc]redit[s]?[^\n]*?\$([\d,]+\.\d+)/i);
    if(fcMatch && r.amount > 0){
      const fc = parseFloat(fcMatch[1].replace(/,/g,''));
      frankingPct = Math.round((fc / (r.amount * 30 / 70)) * 100);
      frankingPct = Math.min(100, Math.max(0, frankingPct));
    }
    // Pattern 2: 'Fully Franked' or 'Franked to 100%'
    if(frankingPct === null && /fully\s+franked|franked\s+to\s+100|100%\s+franked/i.test(text)){
      frankingPct = 100;
    }
    // Pattern 3: 'Unfranked' or 'Unfranked Amount $X.XX' with no franked amount
    if(frankingPct === null){
      const unfrankedAmt = text.match(/[Uu]nfranked\s+[Aa]mount[:\s]+A?\$?([\d,]+\.\d+)/i);
      const frankedAmt   = text.match(/[Ff]ranked\s+[Aa]mount[:\s]+A?\$?([\d,]+\.\d+)/i);
      if(frankedAmt && unfrankedAmt){
        const fAmt  = parseFloat(frankedAmt[1].replace(/,/g,''));
        const ufAmt = parseFloat(unfrankedAmt[1].replace(/,/g,''));
        const total = fAmt + ufAmt;
        if(total > 0) frankingPct = Math.round((fAmt / total) * 100);
      } else if(/unfranked/i.test(text) && !/franked/i.test(text.replace(/unfranked/gi,''))){
        frankingPct = 0;
      }
    }
    // Pattern 4: 'franked at X%'
    if(frankingPct === null){
      const pctMatch = text.match(/franked\s+(?:to\s+)?(\d+(?:\.\d+)?)%/i);
      if(pctMatch) frankingPct = Math.min(100, Math.max(0, parseFloat(pctMatch[1])));
    }
    r.frankingPct = frankingPct;
  }

  if(!r.symbol) throw new Error('Could not parse ASX symbol from PDF');
  if(!r.amount) throw new Error('Could not parse dividend amount from PDF');
  return r;
}

function parseFlexDate(str){
  // "26 February 2026" or "26/02/2026" or "9 March 2026" or "12/09/2025"
  const months = {january:1,february:2,march:3,april:4,may:5,june:6,
                  july:7,august:8,september:9,october:10,november:11,december:12};
  const longMatch = str.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if(longMatch){
    const [,d,m,y] = longMatch;
    const mo = months[m.toLowerCase()];
    if(mo) return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  const slashMatch = str.match(/(\d{1,2})\/(\d{2})\/(\d{4})/);
  if(slashMatch){
    const [,d,mo,y] = slashMatch;
    return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return null;
}

// ── CSV IMPORT ────────────────────────────────────────────────────────
// Expected columns (case-insensitive): date, symbol, amount, type, notes
// ── SELFWEALTH CASH CSV → DIVIDENDS ──────────────────────────────────
// Detects dividend/distribution credits from a Selfwealth cash account export
// Header: TransactionDate, Comment, Credit, Debit, Balance
const SW_DIV_SPECIAL = {
  'MONASH MONASH': 'MOAT',
  'MONASH': 'MAAT',
  'HEARTS AND MINDS': 'HM1',
  'S00125291431': 'HM1',
};
const SW_DIV_RE = /^([A-Z0-9]{2,6})\s+(?:DST|DIST|DIVIDEND|DIV|QRTLY\s+DIV|QRT\s+DIV|REPLACEMENT)\s+/i;
const SW_DIST_RE = /^([A-Z0-9]{2,6})Dist/i;
const SW_SKIP_RE = /^(Opening Balance|Closing Balance|Selfwealth|SW\s*CG|Sw\s+dividends|Dividends\s*sw|Dividends|Top\s+up|NEED\s+FUNDS|SW|Sw)\s*$/i;
const SW_LICS    = new Set(['AFI','ARG','MLT','WHF','HM1','WQG','RF1']);

function swExtractSymbol(comment){
  const c = comment.trim();
  const cu = c.toUpperCase();
  for(const [key, sym] of Object.entries(SW_DIV_SPECIAL)){
    if(cu.startsWith(key)) return sym;
  }
  let m = SW_DIV_RE.exec(c);
  if(m) return m[1].toUpperCase();
  m = SW_DIST_RE.exec(c);
  if(m) return m[1].toUpperCase();
  return null;
}

function parseSelfwealthDivCSV(text, filename){
  const lines = text.replace(/\r/g,'').split('\n');
  // Find header row
  const headerIdx = lines.findIndex(l => l.toLowerCase().includes('transactiondate'));
  if(headerIdx < 0){ $('div-import-status').textContent = 'Could not find header row.'; return; }
  const headers = lines[headerIdx].split(',').map(h => h.trim().toLowerCase());
  const gi = n => headers.indexOf(n);
  const iDate = gi('transactiondate'), iComment = gi('comment'),
        iCredit = gi('credit'), iDebit = gi('debit');

  const parsed = [];
  for(let i = headerIdx+1; i < lines.length; i++){
    const cols = lines[i].split(',');
    if(cols.length < 3) continue;
    const dateRaw = (cols[iDate]||'').trim();
    const comment = (cols[iComment]||'').trim();
    const creditS = (cols[iCredit]||'').trim();
    const debitS  = (cols[iDebit]||'').trim();

    if(!dateRaw || !comment || !creditS || debitS) continue;
    const amount = parseFloat(creditS);
    if(isNaN(amount) || amount <= 0) continue;
    if(SW_SKIP_RE.test(comment)) continue;
    if(/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(comment)) continue; // person name
    if(/^\d+$/.test(comment)) continue; // pure reference number

    const sym = swExtractSymbol(comment);
    if(!sym) continue;

    const date = dateRaw.slice(0,10); // YYYY-MM-DD
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const divType = SW_LICS.has(sym) ? 'dividend' : 'distribution';
    parsed.push({
      date, symbol: sym, amount: +amount.toFixed(2),
      type: divType,
      notes: 'Selfwealth: ' + comment.slice(0,50),
      id: uid()
    });
  }
  showDividendPreview(parsed, filename);
}

function parseDividendCSV(text, filename){
  const lines = text.trim().split('\n').filter(l => l.trim());
  if(lines.length < 2){ $('div-import-status').textContent = 'No data found in CSV.'; return; }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z]/g,''));
  const get = (row, name) => {
    const i = headers.indexOf(name);
    return i >= 0 ? (row[i]||'').trim().replace(/^"|"$/g,'') : '';
  };

  const parsed = [];
  for(let i = 1; i < lines.length; i++){
    const row = lines[i].split(',');
    const date   = ndFlex(get(row,'date'));
    const symbol = get(row,'symbol').toUpperCase();
    const amount = parseFloat(get(row,'amount').replace(/[$,]/g,''));
    const type   = get(row,'type') || 'dividend';
    const notes  = get(row,'notes') || '';
    if(!date || !symbol || isNaN(amount) || amount <= 0) continue;
    parsed.push({date, symbol, amount, type, notes, id: uid()});
  }
  showDividendPreview(parsed, filename);
}

// ── PDF IMPORT (CommSec EOFY Dividend Summary) ────────────────────────
async function parseDividendPDF(buffer, filename){
  $('div-import-status').textContent = 'Extracting text from PDF…';
  try {
    // Wrap buffer in a File object so extractPDFText can read it
    const blob = new Blob([buffer], {type: 'application/pdf'});
    const file = new File([blob], filename || 'statement.pdf', {type: 'application/pdf'});
    const fullText = await extractPDFText(file);

    const parsed = parseCommSecDividendText(fullText);
    if(parsed.length > 0){
      showDividendPreview(parsed, filename);
    } else {
      $('div-import-status').textContent = 'No dividend rows found in PDF. Make sure you upload the CommSec Interest & Dividend Summary PDF.';
    }
  } catch(e) {
    $('div-import-status').textContent = 'PDF error: ' + e.message;
    console.error('PDF parse error:', e);
  }
}

// Parse CommSec EOFY Interest & Dividend Summary text
// Looks for patterns like: "25-Feb-2025 25-Feb-2025 Interim $0.1200 851 $0.00 $102.12 $102.12 $43.77"
function parseCommSecDividendText(text){
  const results = [];

  // Find current symbol sections - pattern: "SYM - COMPANY NAME"
  // Then parse rows: DD-Mon-YYYY DD-Mon-YYYY Type $x.xx NNN $x.xx $x.xx $TOTAL $x.xx
  const symSections = [...text.matchAll(/([A-Z]{2,5})\s*-\s*[A-Z][A-Z &.]+(?:FPO|ETF|CDI|LTD)[^\n]*/g)];

  // Also try simpler date-based pattern scan
  // Date pattern: DD-Mon-YYYY (payment date is what we use)
  // Row pattern: exDate payDate Type $dps units $unfranked $franked $total $fc
  const MONTHS = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                  Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};

  const dateRe = /(\d{2})-([A-Z][a-z]{2})-(\d{4})/g;

  // Find symbol headers then scan following rows
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let currentSym = null;

  for(let i = 0; i < lines.length; i++){
    const line = lines[i];

    // Detect symbol header lines from dividend section only
    // Exclude portfolio valuation lines which contain unit prices like $7.3500
    const symMatch = line.match(/^([A-Z]{2,5})\s*-\s*[A-Z]/);
    if(symMatch && line.length > 6 && !line.match(/\$[\d]+\.[\d]{4}/)){
      currentSym = symMatch[1];
      continue;
    }

    if(!currentSym) continue;

    // Detect rows with two dates and a type keyword
    // "03-Feb-2025 25-Feb-2025 Interim $0.1200 851 $0.00 $102.12 $102.12 $43.77"
    const rowMatch = line.match(
      /(\d{2}-[A-Z][a-z]{2}-\d{4})\s+(\d{2}-[A-Z][a-z]{2}-\d{4})\s+(Interim|Final|Special)\s+\$?([\d.]+)\s+([\d,]+)\s+\$?([\d.]+)\s+\$?([\d.]+)\s+\$?([\d.]+)(?:\s+\$?([\d.]+))?/
    );
    if(rowMatch){
      const payDateStr = rowMatch[2]; // payment date
      const type       = rowMatch[3].toLowerCase() === 'interim' ? 'distribution' : 'dividend';
      const dps        = parseFloat(rowMatch[4]);
      const units      = parseFloat(rowMatch[5].replace(/,/g,''));
      const total      = parseFloat(rowMatch[8]);

      // Convert "25-Feb-2025" → "2025-02-25"
      const dp = payDateStr.match(/(\d{2})-([A-Z][a-z]{2})-(\d{4})/);
      if(!dp) continue;
      const date = dp[3] + '-' + (MONTHS[dp[2]]||'01') + '-' + dp[1];

      const notes = (rowMatch[3]) + ' - ' + dps.toFixed(4) + '/share x ' + units;
      // Classify: LIC/stocks (AFI,ARG etc) pay dividends; ETFs pay distributions
      const divType = ['AFI','ARG','MLT','WHF','WAM','QVE','CDM'].includes(currentSym) ? 'dividend' : 'distribution';

      // Calculate franking % from the fc (franking credit) column
      // ATO formula: fc = cash_div * frankPct/100 * (30/70)
      // So: frankPct = fc / (total * 30/70) * 100
      const fc           = rowMatch[9] ? parseFloat(rowMatch[9]) : 0;
      const unfranked    = parseFloat(rowMatch[6]||0);
      const franked      = parseFloat(rowMatch[7]||0);
      let frankingPct    = null;
      if(total > 0 && fc > 0){
        frankingPct = Math.round((fc / (total * 30 / 70)) * 100);
        frankingPct = Math.min(100, Math.max(0, frankingPct));
      } else if(unfranked > 0 && franked === 0){
        frankingPct = 0;  // fully unfranked
      } else if(franked > 0 && unfranked === 0){
        frankingPct = 100; // fully franked
      }
      results.push({date, symbol: currentSym, amount: total, type: divType, notes, id: uid(), frankingPct});
    }

    // Reset symbol on Sub Total line
    if(line.startsWith('Sub Total') || line.includes('---PAGE---')) currentSym = null;
  }

  return results;
}

function ndFlex(s){
  if(!s) return '';
  // Handle dd/mm/yyyy, yyyy-mm-dd, dd-Mon-yyyy
  if(s.match(/^\d{4}-\d{2}-\d{2}$/)) return s;
  if(s.match(/^\d{2}\/\d{2}\/\d{4}$/)){
    const [d,m,y] = s.split('/'); return y+'-'+m+'-'+d;
  }
  return s;
}

// ── PREVIEW & CONFIRM ─────────────────────────────────────────────────
function showDividendPreview(parsed, filename){
  _divImportPending = parsed;
  const newCount  = parsed.filter(d => !isDivDuplicate(d)).length;
  const dupCount  = parsed.length - newCount;

  $('div-import-status').textContent = filename + ' — ' + parsed.length + ' entries found';
  $('div-import-preview-title').textContent =
    'PREVIEW — ' + newCount + ' NEW, ' + dupCount + ' DUPLICATE' + (dupCount!==1?'S':'') + ' (will be skipped)';

  const typeLabel = {dividend:'Dividend',distribution:'Distribution',drp:'DRP',interest:'Interest',staking:'Staking',airdrop:'Airdrop'};
  $('div-import-tbody').innerHTML = parsed.map(d => {
    const dup = isDivDuplicate(d);
    return '<tr style="' + (dup ? 'opacity:0.4' : '') + '">'
      + '<td>' + d.date + '</td>'
      + '<td><b>' + d.symbol + '</b></td>'
      + '<td>' + (typeLabel[d.type]||d.type) + '</td>'
      + '<td class="pos">$' + (+d.amount).toFixed(2) + '</td>'
      + '<td style="font-size:10px;color:var(--text3)">' + (d.notes||'') + '</td>'
      + '<td style="font-size:10px">' + (dup
          ? '<span style="color:var(--gold)">⚠ duplicate</span>'
          : '<span style="color:var(--green)">✓ new</span>') + '</td>'
      + '</tr>';
  }).join('');

  $('div-import-preview').style.display = '';
  $('div-import-preview').scrollIntoView({behavior:'smooth', block:'nearest'});
}

function confirmDividendImport(){
  const toAdd = _divImportPending.filter(d => !isDivDuplicate(d));
  if(!toAdd.length){ notify('No new dividends to import.','info'); return; }
  dividends.push(...toAdd);
  save();
  renderDividends(); renderDivCharts(); renderDivCards();
  $('div-import-preview').style.display = 'none';
  $('div-import-status').textContent = '';
  _divImportPending = [];
  // Reset file input
  const fi = $('div-import-file');
  if(fi) fi.value = '';
  notify(toAdd.length + ' dividends imported \u2713', 'ok');
}

function cancelDividendImport(){
  _divImportPending = [];
  $('div-import-preview').style.display = 'none';
  $('div-import-status').textContent = '';
  const fi = $('div-import-file');
  if(fi) fi.value = '';
}


// ── DIVIDENDS ─────────────────────────────────────────────────────────
function addDividend(){
  const date   = $('dv-date').value;
  const sym    = $('dv-sym').value.trim().toUpperCase();
  const amount = parseFloat($('dv-amt').value);
  const type   = $('dv-type').value;
  const notes  = $('dv-notes').value.trim();
  if(!date||!sym||isNaN(amount)||amount<=0){ notify('Fill date, symbol and amount.','err'); return; }

  if(type === 'drp'){
    // DRP mode — also create a buy trade
    const at      = $('dv-drp-at').value || 'asx_stock';
    const units   = parseFloat($('dv-drp-units').value);
    const price   = parseFloat($('dv-drp-price').value);
    const carryIn = parseFloat($('dv-drp-carry-in').value) || 0;
    if(isNaN(units)||units<=0||isNaN(price)||price<=0){ notify('Fill DRP units and price.','err'); return; }

    const reinvested = units * price;
    const carryOut   = Math.max(0, parseFloat(((amount + carryIn) - reinvested).toFixed(4)));
    const finalNotes = notes || (sym + ' DRP $' + amount.toFixed(2) + ' → ' + units + ' units @ $' + price.toFixed(4).replace(/\.?0+$/,'') + (carryOut > 0.005 ? ' | carry-out $' + carryOut.toFixed(2) : ''));

    const trade = {
      date, type:'drp', symbol:sym, assetType: at,
      units, price, fees:0, source:($('dv-drp-source')?.value||'drp'), id:uid(),
      notes: finalNotes,
    };
    if(isTradeDuplicate(trade)){ notify('Duplicate DRP — skipped.','err'); return; }

    const carry = getDRPCarry();
    if(carryOut > 0.005) carry[sym] = carryOut; else delete carry[sym];
    saveDRPCarry(carry);

    const dupDiv = isDivDuplicate({date, symbol:sym, amount});
    trades.push(trade);
    if(!dupDiv) dividends.push({ date, symbol:sym, amount, type:'drp', notes: finalNotes, id:uid(),
      frankingPct: (() => { const v=parseFloat($('dv-franking')?.value); return isNaN(v)?null:Math.min(100,Math.max(0,v)); })() });
    save();
    renderFYBar(); renderDividends(); renderDivCharts(); renderDivCards(); renderH(); renderT();
    notify('DRP saved ✓');
    dvClear();
  } else {
    if(isDivDuplicate({date, symbol:sym, amount})){
      notify('Duplicate dividend entry — same date, symbol and amount already exists.','err'); return;
    }
    dividends.push({ date, symbol:sym, amount, type, notes, id:uid(),
      frankingPct: (() => { const v=parseFloat($('dv-franking')?.value); return isNaN(v)?null:Math.min(100,Math.max(0,v)); })() });
    save();
    renderFYBar(); renderDividends(); renderDivCharts(); renderDivCards();
    notify('Dividend added ✓');
    dvClear();
  }
}

function dvTypeChange(){
  const type = $('dv-type').value;
  const isDRP = type === 'drp';
  const fields = $('dv-drp-fields');
  if(fields) fields.style.display = isDRP ? '' : 'none';
  const btn = $('dv-save-btn');
  if(btn) btn.textContent = isDRP ? '✓ SAVE DRP' : 'ADD DIVIDEND';
  if(isDRP){
    drpLoadCarry(); // refresh carry-in for current symbol
    // auto-fill carry-in from stored carry-forward for this symbol
    const sym = ($('dv-sym').value||'').toUpperCase();
    if(sym){
      const carry = getDRPCarry();
      const el = $('dv-drp-carry-in');
      if(el && !el.value) el.value = carry[sym] ? carry[sym].toFixed(2) : '';
    }
    dvDrpCalc();
  }
}

function dvDrpCalc(){
  const units   = parseFloat($('dv-drp-units')?.value)    || 0;
  const price   = parseFloat($('dv-drp-price')?.value)    || 0;
  const amount  = parseFloat($('dv-amt')?.value)          || 0;
  const carryIn = parseFloat($('dv-drp-carry-in')?.value) || 0;
  const sym     = ($('dv-sym')?.value || '').toUpperCase();
  const date    = $('dv-date')?.value || '';

  const available  = amount + carryIn;
  const reinvested = units > 0 && price > 0 ? units * price : 0;
  const carryOut   = reinvested > 0 ? Math.max(0, parseFloat((available - reinvested).toFixed(4))) : 0;

  const pt = $('dv-drp-prev-trade');
  const pd = $('dv-drp-prev-div');
  const pc = $('dv-drp-prev-carry');
  if(!pt) return;

  if(sym && units > 0 && price > 0){
    pt.innerHTML = '📈 Trade: DRP BUY ' + sym + ' — ' + nN(units,4) + ' units @ ' + n2(price, dec(price)) + ' = ' + n2(reinvested);
    pd.innerHTML = '💰 Dividend: ' + sym + ' DRP ' + n2(amount) + (carryIn > 0.005 ? ' + ' + n2(carryIn) + ' carry-in' : '') + ' = ' + n2(available) + ' available';
    pc.innerHTML = carryOut > 0.005 ? '↩ Carry-forward to next DRP: ' + n2(carryOut) : '✓ Fully reinvested';
  } else {
    pt.innerHTML = '';
    pd.innerHTML = amount > 0 ? '💰 Dividend: ' + n2(amount) + (carryIn > 0.005 ? ' + ' + n2(carryIn) + ' carry-in = ' + n2(available) : '') : '';
    pc.innerHTML = '';
  }
}

function dvClear(){
  ['dv-sym','dv-amt','dv-notes','dv-drp-units','dv-drp-price','dv-drp-carry-in'].forEach(id=>{
    const el=$(id); if(el) el.value='';
  });
  const pt=$('dv-drp-prev-trade'); if(pt) pt.innerHTML='';
  const pd=$('dv-drp-prev-div');   if(pd) pd.innerHTML='';
  const pc=$('dv-drp-prev-carry'); if(pc) pc.innerHTML='';
  // reset type to dividend
  const t=$('dv-type'); if(t){ t.value='dividend'; dvTypeChange(); }
  const d=$('dv-date'); if(d) d.value=new Date().toISOString().slice(0,10);
}

// Cycle state for each dividend card: 0=current FY, 1=prev FY, 2=all time
const divCardMode = { thisFY: 0, yield: 0, topPayer: 0, payments: 0 };

function cycleDivCard(key){
  // thisFY card only toggles between current(0) and prev(1) — no all-time
  const max = key === 'thisFY' ? 2 : 3;
  divCardMode[key] = (divCardMode[key]+1) % max;
  renderDivCards();
}

function renderDivCards(){
  const now   = new Date();
  const curFY = now.getMonth() >= 6 ? now.getFullYear()+1 : now.getFullYear();
  const prevFY = curFY - 1;

  function divForMode(mode){
    if(mode===0) return dividends.filter(d=>dateToFY(d.date)===curFY);
    if(mode===1) return dividends.filter(d=>dateToFY(d.date)===prevFY);
    return dividends;
  }
  function modeLabel(mode){
    if(mode===0) return 'FY'+curFY+' (current)';
    if(mode===1) return 'FY'+prevFY+' (previous)';
    return 'All time';
  }
  function modeHint(mode){
    if(mode===0) return '▸ click for prev FY';
    if(mode===1) return '▸ click for all time';
    return '▸ click for current FY';
  }

  const holdings  = calcH();
  const totalCost = holdings.reduce((s,h)=>s+h.costBasis,0);

  // This FY card
  const fyDivs  = divForMode(divCardMode.thisFY);
  const fyTotal = fyDivs.reduce((s,d)=>s+(+d.amount||0),0);

  // Yield card
  const yDivs      = divForMode(divCardMode.yield);
  const yTotal     = yDivs.reduce((s,d)=>s+(+d.amount||0),0);
  const yTotalGross= grossUpTotal(yDivs);
  const yieldPct   = totalCost>0?(yTotal/totalCost)*100:0;
  const yieldGross = totalCost>0?(yTotalGross/totalCost)*100:0;

  // Top payer card
  const tpDivs = divForMode(divCardMode.topPayer);
  const bySymbol = {};
  tpDivs.forEach(d=>{ bySymbol[d.symbol]=(bySymbol[d.symbol]||0)+(+d.amount||0); });
  const topSym = Object.entries(bySymbol).sort((a,b)=>b[1]-a[1])[0];

  // Payments card
  const pmDivs = divForMode(divCardMode.payments);

  const CARD_STYLE = 'cursor:pointer;user-select:none;';
  const HINT_STYLE = 'font-size:9px;color:var(--text3);margin-top:3px;font-family:var(--mono)';

  $('div-cards').innerHTML = [
    { key:null,       l:'Total Income',         v:n2(dividends.reduce((s,d)=>s+(+d.amount||0),0)), s:'pos',
      sub:'Cash · All time · Grossed-up: '+n2(grossUpTotal(dividends)) },

    { key:'thisFY',   l:divCardMode.thisFY===0?'This Financial Year':'Previous Financial Year', v:n2(fyTotal), s:'pos', sub:modeLabel(divCardMode.thisFY), hint:divCardMode.thisFY===0?'▸ click for prev FY':'▸ click for current FY' },
    { key:'yield',    l:'Portfolio Yield',       v:yieldPct.toFixed(2)+'% cash',  s:'pos',
      sub:'Grossed-up: '+yieldGross.toFixed(2)+'% · '+modeLabel(divCardMode.yield), hint:modeHint(divCardMode.yield) },

    { key:'topPayer', l:'Top Payer',             v:topSym?topSym[0]:'—',         s:'neu', sub:(topSym?n2(topSym[1]):'—')+' · '+modeLabel(divCardMode.topPayer), hint:modeHint(divCardMode.topPayer) },
    { key:'payments', l:'Payments',              v:pmDivs.length,                s:'neu', sub:modeLabel(divCardMode.payments), hint:modeHint(divCardMode.payments) },
  ].map(c=>{
    const clickable = c.key ? `onclick="cycleDivCard('${c.key}')" style="${CARD_STYLE}"` : '';
    return `<div class="card" ${clickable}>
      <div class="card-label">${c.l}</div>
      <div class="card-value ${c.s}">${c.v}</div>
      <div class="card-sub">${c.sub}</div>
      ${c.hint ? `<div style="${HINT_STYLE}">${c.hint}</div>` : ''}
    </div>`;
  }).join('');
}

function renderDivCharts(){
  // Bar: income by AU financial year (Jul 1 – Jun 30)
  const fyMap = {}, fyMapGross = {};
  dividends.forEach(d=>{
    const fy = dateToFY(d.date);
    fyMap[fy]      = (fyMap[fy]||0)      + (+d.amount||0);
    fyMapGross[fy] = (fyMapGross[fy]||0) + grossUpDiv(+d.amount||0, d.frankingPct||0);
  });
  const fyKeys      = Object.keys(fyMap).map(Number).sort();
  const fyLabels    = fyKeys.map(fy=>'FY'+fy);
  const fyData      = fyKeys.map(fy=>+fyMap[fy].toFixed(2));
  const fyDataGross = fyKeys.map(fy=>+(fyMapGross[fy]||0).toFixed(2));
  mkChart('div-chart',{
    type:'bar',
    data:{ labels:fyLabels.length?fyLabels:['No data'], datasets:[{
      label:'Cash Dividend (AUD)', data:fyData.length?fyData:[0],
      backgroundColor:'rgba(0,214,143,0.6)', borderColor:'#00d68f', borderWidth:1
    },{
      label:'Grossed-up (incl. Franking Credits)', data:fyDataGross.length?fyDataGross:[0],
      backgroundColor:'rgba(96,165,250,0.35)', borderColor:'#60a5fa', borderWidth:1,
      borderDash:[4,3]
    }]},
    options:{ responsive:true, maintainAspectRatio:false,
      scales:{ x:{ticks:{color:'#4a5568'}}, y:{ticks:{color:'#4a5568',callback:v=>'$'+v.toLocaleString()}, grid:{color:'#1f2733'}} },
      plugins:{legend:{labels:{color:'#8899aa'}}}
    }
  });

    // Pie: income by symbol
  const bySymbol = {};
  dividends.forEach(d=>{ bySymbol[d.symbol]=(bySymbol[d.symbol]||0)+(+d.amount||0); });
  const symLabels = Object.keys(bySymbol);
  const symData   = symLabels.map(k=>+bySymbol[k].toFixed(2));
  mkChart('div-pie-chart',{
    type:'doughnut',
    data:{ labels:symLabels.length?symLabels:['No data'], datasets:[{
      data:symData.length?symData:[1],
      backgroundColor:PALETTE, borderColor:'#111418', borderWidth:2
    }]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'bottom',labels:{color:'#8899aa',font:{size:10}}},
        tooltip:{ callbacks:{ label:ctx=>' '+ctx.label+': $'+ctx.parsed.toLocaleString('en-AU',{minimumFractionDigits:2}) } }
      }
    }
  });
}


// ── FINANCIAL YEAR HELPERS ────────────────────────────────────────────
// AU financial year: July 1 – June 30. FY2025 = Jul 2024 – Jun 2025.
function dateToFY(dateStr){
  // dateStr: YYYY-MM-DD
  const [y, m] = dateStr.split('-').map(Number);
  return m >= 7 ? y + 1 : y;  // July+ belongs to next FY
}
function fyLabel(fy){ return 'FY' + fy; }

function renderFYBar(){
  const bar = $('dv-fy-bar');
  if(!bar) return;
  // Gather unique FYs from dividends, sorted descending
  const fys = [...new Set(dividends.map(d => dateToFY(d.date)))].sort((a,b)=>b-a);
  const pill = (label, val) => {
    const active = dvFYFilter === val;
    return `<button onclick="dvFYFilter='${val}';renderFYBar();renderDividends()"
      style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;
             border:1px solid ${active?'var(--gold)':'var(--bo)'};
             background:${active?'var(--gold)':'var(--bg2)'};
             color:${active?'#0a0f1e':'var(--text2)'};
             transition:all 0.15s">${label}</button>`;
  };
  bar.innerHTML = pill('ALL','ALL') + fys.map(fy => pill(fyLabel(fy), String(fy))).join('');
}

function renderDividends(){
  const search = ($('dv-search').value||'').toLowerCase();
  const typeF  = $('dv-filter').value;
  // Rebuild dv-sym-filter dynamically from all dividend symbols
  const _dvSymSel = $('dv-sym-filter');
  const _dvSymCur = _dvSymSel ? _dvSymSel.value : '';
  const _dvSyms = [...new Set(dividends.map(d=>d.symbol).filter(Boolean))].sort();
  if(_dvSymSel) _dvSymSel.innerHTML = '<option value="">All Symbols</option>' +
    _dvSyms.map(s=>`<option value="${escHtml(s)}" ${s===_dvSymCur?'selected':''}>${escHtml(s)}</option>`).join('');
  const symF = _dvSymCur;
  // Rebuild dv-owner-filter from actual owners
  const _dvOwnerSel = $('dv-owner-filter');
  const _dvOwnerCur = _dvOwnerSel ? _dvOwnerSel.value : '';
  if(_dvOwnerSel) _dvOwnerSel.innerHTML = '<option value="">All Owners</option>' +
    getAllPersons().concat(['joint']).map(p=>`<option value="${p}" ${p===_dvOwnerCur?'selected':''}>${getPersonLabel(p)}</option>`).join('');
  const ownerF = _dvOwnerCur;

  let filtered = [...dividends].filter(d=>{
    if(search && !d.symbol.toLowerCase().includes(search)) return false;
    if(typeF && d.type!==typeF) return false;
    if(symF   && d.symbol!==symF) return false;
    if(ownerF && getSymbolOwner(d.symbol)!==ownerF) return false;
    if(dvFYFilter !== 'ALL'){
      const fy = dateToFY(d.date);
      if(String(fy) !== dvFYFilter) return false;
    }
    return true;
  });

  // Sort
  const {col, dir} = getSort('dv-body');
  if(col){
    filtered = sortRows(filtered, col, dir, 'type', 'symbol');
  } else {
    filtered = filtered.reverse();
  }

  $('dv-empty').style.display = filtered.length ? 'none' : '';
  const idxMap={};
  dividends.forEach((d,i)=>idxMap[d.id]=i);

  // Sortable headers
  const TID='dv-body';
  const th=(col,label,sty)=>sortTh(TID,col,label,'renderDividends',sty);
  $('dv-body').closest('table').querySelector('thead tr').innerHTML =
    th('date','Date') +
    th('symbol','Symbol') +
    '<th>Owner</th>' +
    th('type','Type') +
    th('amount','Cash (AUD)','text-align:right') +
    '<th style="text-align:right">Grossed-up</th>' +
    '<th style="text-align:right">Franking</th>' +
    '<th>Notes</th><th></th>';

  const TYPES = ['dividend','distribution','drp','interest','staking','airdrop'];
  const TYPE_LABEL = {dividend:'Dividend',distribution:'Distribution',interest:'Interest',staking:'Staking',airdrop:'Airdrop',drp:'DRP'};
  const EDIT_BTN = `cursor:pointer;background:#1a2f4a;color:#3d9cf0;border:1px solid #3d9cf0;border-radius:4px;padding:3px 8px;font-size:11px;margin-right:4px`;

  $('dv-body').innerHTML = filtered.map(d=>{
    if(editingDivId != null && String(editingDivId) === String(d.id)){
      // Inline edit row
      return `<tr style="background:var(--bg2);outline:2px solid var(--blue)">
        <td><input class="fi" type="date" id="ed-date" value="${d.date}" style="width:118px;padding:3px 5px"></td>
        <td><input class="fi" type="text" id="ed-sym" value="${d.symbol}" style="width:70px;padding:3px 5px" oninput="this.value=this.value.toUpperCase()"></td>
        <td><select class="fi" id="ed-type" style="padding:3px 5px;font-size:11px">
          ${TYPES.map(t=>`<option value="${t}"${t===d.type?' selected':''}>${TYPE_LABEL[t]}</option>`).join('')}
        </select></td>
        <td><input class="fi" type="number" id="ed-amt" value="${d.amount}" step="any" style="width:100px;padding:3px 5px;text-align:right"></td>
        <td><input class="fi" type="text" id="ed-notes" value="${escHtml(d.notes||'')}" style="width:120px;padding:3px 5px"></td>
        <td style="padding:2px 4px"><input class="fi" type="number" id="ed-franking" min="0" max="100" step="any" style="width:64px;padding:3px 5px" placeholder="Frank%" title="Franking %" value="${d.frankingPct??""}"></td>
        <td style="white-space:nowrap;padding:6px 8px">
          <button class="btn btn-g" style="padding:4px 12px;font-size:11px" onclick="saveEditDiv()">&#10003; SAVE</button>
          <button class="btn" style="padding:4px 8px;font-size:11px" onclick="cancelEditDiv()">&#10005;</button>
        </td>
      </tr>`;
    }
    return `<tr>
      <td>${d.date}</td>
      <td><b>${displaySymbol(d.symbol)}</b></td>
      <td><span style="font-size:10px;padding:2px 6px;border-radius:12px;background:${getPersonColour(getSymbolOwner(d.symbol))}22;color:${getPersonColour(getSymbolOwner(d.symbol))}">${getPersonLabel(getSymbolOwner(d.symbol))}</span></td>
      <td><span class="badge b-etf" style="font-size:10px">${TYPE_LABEL[d.type]||d.type}</span></td>
      <td style="text-align:right" class="pos">$${(+d.amount).toFixed(2)}</td>
      <td style="text-align:right;font-family:var(--mono);color:var(--blue);font-size:12px">$${grossUpDiv(+d.amount||0,d.frankingPct||0).toFixed(2)}</td>
      <td style="text-align:right;color:var(--text3);font-size:11px">${d.frankingPct!=null?d.frankingPct+"%":"—"}</td>
      <td style="color:var(--text3);font-size:11px">${escHtml(d.notes||'')}</td>
      <td style="white-space:nowrap;padding:4px 6px">
        <button style="${EDIT_BTN}" onclick="doEditDiv('${d.id}')">&#9998; EDIT</button>
        <button class="del-btn" onclick="delDiv(${idxMap[d.id]})">&#10005;</button>
      </td>
    </tr>`;
  }).join('');

  // Filtered total footer — shown when search/filter/FY is active
  const hasFilter = search || typeF || ownerF || _dvSymCur || dvFYFilter !== 'ALL';
  const filteredTotal = filtered.reduce((s,d)=>s+(+d.amount||0),0);
  const filteredCount = filtered.length;
  const foot = $('dv-foot');
  if(foot){
    if(hasFilter && filteredCount > 0){
      foot.innerHTML = `<tr style="font-weight:700;border-top:2px solid var(--bo)">
        <td colspan="4" style="color:var(--text2);font-size:12px">
          ${filteredCount} result${filteredCount!==1?'s':''} shown
        </td>
        <td style="text-align:right;color:var(--gold);font-size:13px">
          ${n2(filteredTotal)}
        </td>
        <td style="text-align:right;color:var(--blue);font-size:12px">
          $${grossUpTotal(filtered).toFixed(2)}
        </td>
        <td colspan="3" style="color:var(--text3);font-size:11px">filtered total (grossed-up: above)</td>
      </tr>`;
    } else {
      foot.innerHTML = '';
    }
  }
}


function delDiv(idx){
  if(idx < 0 || idx >= dividends.length){ notify('Dividend not found.','err'); return; }
  if(!confirm('Delete this dividend entry?')) return;
  dividends.splice(idx,1); save();
  renderDividends(); renderDivCharts(); renderDivCards();
  notify('Dividend deleted.','ok');
}


// ── PROPERTY ──────────────────────────────────────────────────────────
let properties = (()=>{try{return JSON.parse(localStorage.getItem('pt_props')||'[]');}catch(e){return [];}})() ;

function doEditDiv(id){
  editingDivId = id;  // keep as string — IDs can be numeric or 'div_xxx' strings
  renderDividends();
  // Scroll the editing row into view
  setTimeout(()=>{
    const row = $('dv-body').querySelector('tr[style*="outline"]');
    if(row) row.scrollIntoView({block:'nearest', behavior:'smooth'});
  }, 50);
}

function cancelEditDiv(){
  editingDivId = null;
  renderDividends();
}

function saveEditDiv(){
  const date  = $('ed-date')?.value;
  const sym   = ($('ed-sym')?.value||'').trim().toUpperCase();
  const type  = $('ed-type')?.value;
  const amt   = parseFloat($('ed-amt')?.value);
  const notes = $('ed-notes')?.value||'';

  if(!date || !sym || isNaN(amt) || amt <= 0){
    notify('Date, symbol and a positive amount are required.', 'err');
    return;
  }

  const idx = dividends.findIndex(d => d.id == editingDivId);
  if(idx < 0){ notify('Dividend not found.', 'err'); return; }

  const nfp = parseFloat($('ed-franking')?.value);
  dividends[idx] = { ...dividends[idx], date, symbol:sym, type, amount:+amt.toFixed(2), notes,
    frankingPct: isNaN(nfp) ? null : Math.min(100,Math.max(0,nfp)) };
  editingDivId = null;
  save();
  renderFYBar();
  renderDividends();
  renderDivCharts();
  renderDivCards();
  notify('Dividend updated ✓');
}

