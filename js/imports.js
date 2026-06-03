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
  if(hs.has('asxcode')||fn.includes('cmc')) return 'cmc';
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
function parseBTCM(rows){
  // Only trade record rows
  const tr=rows.filter(r=>(r['recordType']||r[' recordType']||'').trim()==='Trade');
  // Group by referenceId
  const groups={};
  for(const r of tr){
    const ref=(r['referenceId']||'').trim();
    if(!groups[ref]) groups[ref]=[];
    groups[ref].push(r);
  }
  const results=[];
  for(const grp of Object.values(groups)){
    // Crypto row: currency != AUD, action = Buy Order or Sell Order
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
    // AUD row (not the fee row)
    const audRow=grp.find(r=>(r['currency']||'').trim()==='AUD'&&(r['action']||'').trim()!=='Trading Fee');
    const audAmt=Math.abs(parseFloat(audRow?.amount||0)||0);
    const price=units>0?+(audAmt/units).toFixed(8):0;
    // Fee row
    const feeRow=grp.find(r=>(r['action']||'').trim()==='Trading Fee');
    const fees=Math.abs(parseFloat(feeRow?.amount||0)||0);
    if(!sym||!units||!price||!date) continue;
    results.push({date,type:side,symbol:sym,assetType:resolveAssetType(sym,'crypto'),units,price,fees,source:'btcmarkets',notes:'',id:uid()});
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
  else if(src==='btcmarkets') parsed=parseBTCM(rows);
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