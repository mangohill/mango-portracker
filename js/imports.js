// ── imports.js ─────────────────────────────────────────────

function parseCSV(text){
  const lines=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim().split('\n').filter(l=>l.trim());
  if(lines.length<2) return {headers:[],rows:[]};
  const pl=line=>{
    const res=[]; let cur=''; let q=false;
    for(const c of line){
      if(c==='"'){q=!q;}
      else if(c===','&&!q){res.push(cur.trim());cur='';}
      else cur+=c;
    }
    res.push(cur.trim()); return res;
  };
  const headers=pl(lines[0]);
  const rows=lines.slice(1).map(l=>{
    const v=pl(l); const o={};
    headers.forEach((h,i)=>o[h.trim()]=v[i]||''); return o;
  });
  return {headers,rows};
}

function detectSrc(filename,headers){
  const fn=filename.toLowerCase();
  const hs=new Set(headers.map(h=>h.trim().toLowerCase()));
  if(hs.has('orderno')&&hs.has('pair')&&hs.has('executed')) return 'binance';
  if(fn.includes('binance')) return 'binance';
  if(hs.has('recordtype')||hs.has('transactionid')||fn.includes('btcmarket')) return 'btcmarkets';
  if(hs.has('transaction id')||hs.has('market id')||fn.includes('taxtransactionreport')) return 'btcmarkets_tax';
  if(hs.has('asxcode')||fn.includes('cmc')) return 'cmc';
  if(hs.has('market')&&hs.has('rate inc. fee')||fn.includes('orderhistory')||fn.includes('coinspot')) return 'coinspot';
  if(hs.has('comment')&&hs.has('transactiondate')) return 'selfwealth';
  if(fn.includes('betashare')) return 'betashares';
  // CommSec: Date, Reference, Details, Debit($), Credit($), Balance($)
  if(hs.has('details')&&hs.has('reference')&&(hs.has('debit($)')||hs.has('credit($)'))) return 'commsec';
  if(fn.includes('commsec')) return 'commsec';
  return 'generic';
}

// ── COMMSEC PARSER ───────────────────────────────────────────────────
// Format: Date(dd/mm/yyyy), Reference, Details("B 589 EBR @ 0.850000"), Debit($), Credit($), Balance($)
const CS_RE = /^([BS])\s+([0-9,]+(?:\.\d+)?)\s+([A-Z0-9]+)\s+@\s+([\d.]+)/i;
function parseCommsec(rows){
  return rows.map(r=>{
    const details=(r['Details']||'').trim();
    const m=details.match(CS_RE);
    if(!m) return null;
    const side   = m[1].toUpperCase()==='B'?'buy':'sell';
    const units  = parseFloat(m[2].replace(/,/g,''))||0;
    const sym    = m[3].toUpperCase();
    const price  = parseFloat(m[4])||0;
    const date   = nd(r['Date']||'');
    const debit  = parseFloat((r['Debit($)']||r['Debit($) ']||'').replace(/[,$]/g,''))||0;
    const credit = parseFloat((r['Credit($)']||r['Credit($) ']||'').replace(/[,$]/g,''))||0;
    const gross  = units*price;
    // Fees = difference between total paid/received and gross
    const total  = side==='buy'?debit:credit;
    const fees   = +Math.max(0, total-gross).toFixed(4);
    if(!sym||!units||!price||!date) return null;
    return {date,type:side,symbol:sym,assetType:resolveAssetType(sym,'stock'),units,price,fees,source:'commsec',notes:'',id:uid()};
  }).filter(Boolean);
}

// ── CMC MARKETS PARSER ───────────────────────────────────────────────
// Columns: AsxCode, Order Type, Trade Date, Quantity, Price, Brokerage, GST
function parseCMC(rows){
  return rows.map(r=>{
    const sym=(r['AsxCode']||'').trim().toUpperCase();
    const date=nd(r['Trade Date']||r['Settlement Date']||'');
    const side=(r['Order Type']||'').toLowerCase().includes('sell')?'sell':'buy';
    const units=parseFloat((r['Quantity']||'').replace(/[,$\s]/g,''))||0;
    const price=parseFloat((r['Price']||r['Avg Price']||'').replace(/[,$\s]/g,''))||0;
    const brok=parseFloat((r['Brokerage']||'').replace(/[,$\s]/g,''))||0;
    const gst =parseFloat((r['GST']||'').replace(/[,$\s]/g,''))||0;
    const fees=+(brok+gst).toFixed(4);
    if(!sym||!units||!price||!date) return null;
    return {date,type:side,symbol:sym,assetType:resolveAssetType(sym,'etf'),units,price,fees,source:'cmc',notes:'',id:uid()};
  }).filter(Boolean);
}

// ── SELFWEALTH PARSER ────────────────────────────────────────────────
// Cash ledger: Comment = "Order N: Buy/Sell QTY SYM @ $PRICE"
// Multiple fills of same order number = separate trade rows (keep both)
const SW_RE = /order\s+\d+:\s*(buy|sell)\s+([\d,]+(?:\.\d+)?)\s+([A-Z0-9]+)\s+@\s+\$?([\d.]+)/i;
function parseSW(rows){
  return rows.map(r=>{
    const comment=(r['Comment']||'').trim();
    const m=comment.match(SW_RE);
    if(!m) return null;
    const side=m[1].toLowerCase();
    const units=parseFloat(m[2].replace(/,/g,''))||0;
    const sym=m[3].toUpperCase();
    const price=parseFloat(m[4])||0;
    const date=nd(r['TransactionDate']||r['Date']||'');
    if(!sym||!units||!price||!date) return null;
    // Brokerage: difference between debit and gross (often 0 for Selfwealth $9.50 flat)
    const debit=parseFloat((r['Debit']||'').replace(/[,$]/g,''))||0;
    const gross=+(units*price).toFixed(4);
    const fees=debit>gross?+(debit-gross).toFixed(4):0;
    return {date,type:side,symbol:sym,assetType:resolveAssetType(sym,'etf'),units,price,fees,source:'selfwealth',notes:'',id:uid()};
  }).filter(Boolean);
}

// ── BTCMARKETS PARSER ────────────────────────────────────────────────
// Ledger format: paired rows per referenceId
// Buy: AUD debit row + crypto credit row + Trading Fee row
// Sell: crypto debit row + AUD credit row + Trading Fee row
// ── BTCMARKETS TAX TRANSACTION REPORT PARSER ─────────────────────────
// Format: Transaction Id, Transaction Date and Timestamp, Transaction,
//         Asset, Market Id, Volume, Price (AUD), Fee (AUD), Nett Value (AUD), Reference Id
// Dates are UTC — converted to Australian Eastern time (AEDT/AEST)
function utcToAEST(utcStr){
  // Parse UTC timestamp, convert to AEST (UTC+10) or AEDT (UTC+11)
  // AEDT: first Sun Oct → first Sun Apr; AEST: rest of year
  if(!utcStr) return '';
  const dt = new Date(utcStr);
  if(isNaN(dt)) return utcStr.slice(0,10);
  const month = dt.getUTCMonth() + 1; // 1-12
  // Approximate DST: Oct, Nov, Dec, Jan, Feb, Mar = AEDT (+11), else AEST (+10)
  const offsetHrs = (month >= 10 || month <= 3) ? 11 : 10;
  const local = new Date(dt.getTime() + offsetHrs * 3600 * 1000);
  return local.toISOString().slice(0, 10);
}

function parseBTCMTax(rows){
  const results = [];
  for(const r of rows){
    const g = k => (r[k] || r[' '+k] || '').trim();
    const txnType = g('Transaction');
    if(txnType !== 'Buy Order' && txnType !== 'Sell Order') continue;
    const sym   = g('Asset').toUpperCase();
    const utcTs = g('Transaction Date and Timestamp');
    const date  = utcToAEST(utcTs);
    const units = Math.abs(parseFloat(g('Volume')) || 0);
    const price = Math.abs(parseFloat(g('Price (AUD)')) || 0);
    const fees  = Math.abs(parseFloat(g('Fee (AUD)')) || 0);
    const nett  = Math.abs(parseFloat(g('Nett Value (AUD)')) || 0);
    const side  = txnType === 'Buy Order' ? 'buy' : 'sell';
    if(!sym || !units || !price || !date) continue;
    // Note records the AUD total and price for CGT record-keeping
    const total = (units * price).toFixed(2);
    const notes = `BTC Markets · ${side==='buy'?'Cost':'Proceeds'}: $${nett.toFixed(2)} · Price: $${price} · Fee: $${fees.toFixed(4)}`;
    results.push({date, type:side, symbol:sym,
      assetType: resolveAssetType(sym,'crypto'),
      units: +units.toFixed(8), price: +price.toFixed(8),
      fees: +fees.toFixed(4), source:'btcmarkets', notes, id:uid()});
  }
  return results;
}

// ── BTCMARKETS LEDGER PARSER (old format) ───────────────────────────
// Format: paired debit/credit rows per referenceId
function parseBTCM(rows){
  // Detect which format: Tax Report has "Transaction" column; Ledger has "recordType"
  const firstRow = rows[0] || {};
  const hasTxnCol = Object.keys(firstRow).some(k => k.trim().toLowerCase() === 'transaction');
  const hasRecType = Object.keys(firstRow).some(k => k.trim().toLowerCase() === 'recordtype');
  if(hasTxnCol && !hasRecType) return parseBTCMTax(rows);

  // Old ledger format below
  const tr=rows.filter(r=>(r['recordType']||r[' recordType']||'').trim()==='Trade');
  const groups={};
  for(const r of tr){
    const ref=(r['referenceId']||'').trim();
    if(!groups[ref]) groups[ref]=[];
    groups[ref].push(r);
  }
  const results=[];
  for(const grp of Object.values(groups)){
    const cryptoRow=grp.find(r=>{
      const cur=(r['currency']||'').trim();
      const act=(r['action']||'').trim();
      return cur!=='AUD'&&(act==='Buy Order'||act==='Sell Order');
    });
    if(!cryptoRow) continue;
    const sym=(cryptoRow['currency']||'').trim().toUpperCase();
    const units=Math.abs(parseFloat(cryptoRow['amount'])||0);
    const side=(cryptoRow['action']||'').trim()==='Buy Order'?'buy':'sell';
    const date=nd((cryptoRow['creationTime']||'').split('T')[0]);
    const audRow=grp.find(r=>(r['currency']||'').trim()==='AUD'&&(r['action']||'').trim()!=='Trading Fee');
    const audAmt=Math.abs(parseFloat(audRow?.amount||0)||0);
    const price=units>0?+(audAmt/units).toFixed(8):0;
    const feeRow=grp.find(r=>(r['action']||'').trim()==='Trading Fee');
    const fees=Math.abs(parseFloat(feeRow?.amount||0)||0);
    if(!sym||!units||!price||!date) continue;
    results.push({date,type:side,symbol:sym,assetType:resolveAssetType(sym,'crypto'),units,price,fees,source:'btcmarkets',notes:'',id:uid()});
  }
  return results;
}

// ── COINSPOT PARSER ─────────────────────────────────────────────────
// Format: Transaction Date (dd/mm/yyyy HH:MM AM/PM AEST), Type, Market (e.g. DOGE/AUD),
//         Amount, Rate inc. fee, Rate ex. fee, Fee (AUD), Fee AUD (inc GST), GST AUD,
//         Total AUD, Total (inc GST)
// Dates are already in AEST — no UTC conversion needed.
function parseCoinSpot(rows){
  const results = [];
  for(const r of rows){
    const g = k => (r[k]||'').trim();
    const rawDate  = g('Transaction Date');
    const txnType  = g('Type').toLowerCase();
    const market   = g('Market');                     // e.g. DOGE/AUD
    const symbol   = market.split('/')[0].toUpperCase();
    const units    = Math.abs(parseFloat(g('Amount'))||0);
    // Rate ex. fee = clean per-unit price excluding fee
    const price    = Math.abs(parseFloat(g('Rate ex. fee'))||0);
    // Fee: strip trailing " AUD" then parse
    const feeStr   = g('Fee').replace(/\s*AUD$/i,'').replace(/,/g,'');
    const fees     = Math.abs(parseFloat(feeStr)||0);
    const total    = Math.abs(parseFloat(g('Total AUD'))||0);

    if(!symbol||!units||!price||!rawDate) continue;
    if(txnType!=='buy'&&txnType!=='sell') continue;

    // Parse dd/mm/yyyy HH:MM AM/PM
    const dm = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if(!dm) continue;
    let hr = parseInt(dm[4]);
    if(dm[6].toUpperCase()==='PM' && hr!==12) hr+=12;
    if(dm[6].toUpperCase()==='AM' && hr===12) hr=0;
    const date = `${dm[3]}-${dm[2]}-${dm[1]}`;

    const side = txnType === 'sell' ? 'sell' : 'buy';
    const notes = `CoinSpot · ${side==='buy'?'Cost':'Proceeds'}: $${total.toFixed(2)} · Price: $${price} · Fee: $${fees.toFixed(4)}`;
    results.push({
      date, type:side, symbol,
      assetType: resolveAssetType(symbol, 'crypto'),
      units: +units.toFixed(8), price: +price.toFixed(8),
      fees: +fees.toFixed(4), source:'coinspot', notes, id:uid()
    });
  }
  return results;
}

// ── GENERIC PARSER ───────────────────────────────────────────────────
function parseGeneric(rows,source){
  const gc=(r,...names)=>{
    for(const n of names){
      const k=Object.keys(r).find(k=>k.trim().toLowerCase().includes(n.toLowerCase()));
      if(k!=null) return r[k]||'';
    }
    return '';
  };
  return rows.map(r=>{
    const date=nd(gc(r,'date','time','created'));
    const rawSide=(gc(r,'type','side','action','order type')||'').toLowerCase();
    const side=rawSide.includes('sell')?'sell':'buy';
    const sym=(gc(r,'symbol','ticker','asx','code','asxcode','asset')||'').replace('.AX','').split('/')[0].toUpperCase().trim();
    const units=Math.abs(parseFloat((gc(r,'units','quantity','qty','amount','size')||'').replace(/[,$]/g,''))||0);
    const price=parseFloat((gc(r,'price','rate','avg price','unit price')||'').replace(/[,$\s]/g,''))||0;
    const fees=parseFloat((gc(r,'fee','brokerage','commission')||'').replace(/[,$]/g,''))||0;
    if(!sym||!units||!price||!date) return null;
    return {date,type:side,symbol:sym,assetType:resolveAssetType(sym, CG[sym]?'crypto':'stock'),units,price,fees,source,notes:'',id:uid()};
  }).filter(Boolean);
}

// ── IMPORT FLOW ──────────────────────────────────────────────────────
function dzO(e){e.preventDefault();$('dz').classList.add('drag');}
function dzL(){$('dz').classList.remove('drag');}
function dzD(e){e.preventDefault();dzL();const f=e.dataTransfer.files[0];if(f)procFile(f);}
function onSel(e){procFile(e.target.files[0]);}

function procFile(file){
  const reader=new FileReader();
  reader.onload=ev=>parseFile(ev.target.result,file.name);
  reader.readAsText(file);
}
function parseBinance(rows){
  const parseNum = s => parseFloat((s||'').replace(/[^0-9.]/g,'')) || 0;
  const result = [];
  for(const r of rows){
    const pair   = (r['Pair']||r['pair']||'').trim();
    const side   = (r['Side']||r['side']||'').trim().toUpperCase();
    const status = (r['Status']||r['status']||'FILLED').trim().toUpperCase();
    if(!pair || status !== 'FILLED') continue;

    const timeStr = (r['Time']||r['time']||'').trim();
    const dm = timeStr.match(/(\d+)\/(\d+)\/(\d+)/);
    if(!dm) continue;
    const date = `${dm[3]}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;

    const symbol = pair.replace(/(?:AUD|USDT|BUSD|USDC|BTC|ETH|BNB)$/, '').toUpperCase();
    if(!symbol) continue;

    const units = parseNum(r['Executed']||r['executed']||'');
    const price = parseFloat((r['Average Price']||r['average price']||'').trim()) || 0;
    if(!units || !price) continue;

    const type = side==='BUY' ? 'buy' : side==='SELL' ? 'sell' : null;
    if(!type) continue;

    result.push({
      date, type, symbol,
      assetType: 'crypto',
      units: +units.toFixed(8),
      price: +price.toFixed(8),
      fees: 0,
      source: 'binance',
      notes: 'Binance import',
    });
  }
  return result;
}

function parseFile(text,filename){
  const {headers,rows}=parseCSV(text);
  if(!headers.length){notify('Could not read CSV.','err');return;}
  const src=detectSrc(filename,headers);
  let parsed=[];
  if(src==='commsec')     parsed=parseCommsec(rows);
  else if(src==='cmc')    parsed=parseCMC(rows);
  else if(src==='selfwealth') parsed=parseSW(rows);
  else if(src==='btcmarkets'||src==='btcmarkets_tax') parsed=parseBTCM(rows);
  else if(src==='coinspot') parsed=parseCoinSpot(rows);
  else if(src==='binance') parsed=parseBinance(rows);
  else                    parsed=parseGeneric(rows,src);
  if(!parsed.length){notify(`No trades found (detected: ${src}). Check file format.`,'err');return;}
  pending=parsed;
  showPrev(parsed,filename,src);
}
function showPrev(parsed,filename,src){
  $('ipv').style.display='';
  const newCount  = parsed.filter(t => !isTradeDuplicate(t)).length;
  const dupCount  = parsed.length - newCount;
  const dupNote   = dupCount > 0 ? ` · ⚠ ${dupCount} duplicate${dupCount>1?'s':''} will be skipped` : '';
  $('ipt').textContent=`PREVIEW — ${newCount} new · ${dupCount} duplicate${dupCount!==1?'s':''} · ${filename} · [${src.toUpperCase()}]`;
  const show=parsed.slice(0,30);
  $('ipb').innerHTML=show.map(t=>{
    const dup = isTradeDuplicate(t);
    return `<tr style="${dup?'opacity:0.4':''}">
    <td>${t.date}</td><td>${bS(t.type)}</td><td><b>${displaySymbol(t.symbol)}</b></td>
    <td>${bT(t.assetType)}</td><td>${nN(t.units,8)}</td>
    <td>${n2(t.price,dec(t.price))}</td>
    <td style="color:var(--text3)">${n2(t.fees)}</td>
    <td style="color:var(--text3);font-size:10px">${t.source}</td>
    <td style="color:var(--text3);font-size:10px">${dup?'<span style="color:var(--gold)">⚠ duplicate</span>':escHtml(t.notes)}</td>
  </tr>`;
  }).join('')+(parsed.length>30?`<tr><td colspan="9" style="text-align:center;color:var(--text3);font-size:11px">…and ${parsed.length-30} more rows</td></tr>`:'');
}
function confirmImp(){
  const toAdd = pending.filter(t => !isTradeDuplicate(t));
  const skipped = pending.length - toAdd.length;
  trades.push(...toAdd);
  save(); pending=[];
  $('ipv').style.display='none';
  $('cf').value='';
  const msg = skipped > 0 ? `✓ Imported ${toAdd.length} trades (${skipped} duplicate${skipped>1?'s':''} skipped)` : `✓ Imported ${toAdd.length} trades`;
  notify(msg,'ok');
  renderH(); renderT(); renderR(); if(typeof renderAnalytics==='function') renderAnalytics();
}
function cancelImp(){pending=[];$('ipv').style.display='none';}

// ── HOLDINGS CALC ────────────────────────────────────────────────────
// ── PRICE SYMBOL ALIAS ───────────────────────────────────────────────
// Strips broker suffixes like :AU, :BS so DHHF:AU and DHHF share one price
