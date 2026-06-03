// ── trades.js ─────────────────────────────────────────────

function renderR(){
  const man=[...trades].filter(t=>t.source==='manual').reverse().slice(0,8);
  $('re').style.display=man.length?'none':'';
  const im={}; trades.forEach((t,i)=>im[t.id]=i);
  $('rb').innerHTML=man.map(t=>`<tr>
    <td>${t.date}</td><td>${bS(t.type)}</td><td><b>${displaySymbol(t.symbol)}</b></td>
    <td>${nN(t.units,8)}</td><td>${n2(t.price,dec(t.price))}</td>
    <td>${n2((+t.units * +t.price)+(t.type==='buy'?+t.fees:0))}</td>
    <td><button class="del-btn" onclick="delT(${im[t.id]});renderR()">✕</button></td>
  </tr>`).join('');
}

// ── CORPORATE ACTIONS ────────────────────────────────────────────────
let caType = 'merger';

const CA_CONFIG = {
  merger: {
    fromLabel:'From Symbol (old)',  toLabel:'To Symbol (new)',
    ratioLabel:'Conversion Ratio (new units per old unit)',
    ratioPlaceholder:'e.g. 1.0 for 1:1',
    showRatio:true, showToUnits:false, showAlloc:false, showFromUnits:true,
    toSymPlaceholder:'e.g. MAIF',
  },
  split: {
    fromLabel:'Symbol',             toLabel:'Same Symbol (post-split)',
    ratioLabel:'Split Ratio (new shares per old share)',
    ratioPlaceholder:'e.g. 4 for a 4:1 split',
    showRatio:true, showToUnits:false, showAlloc:false, showFromUnits:true,
    toSymPlaceholder:'same ticker',
  },
  rename: {
    fromLabel:'Old Symbol',         toLabel:'New Symbol',
    ratioLabel:'',
    ratioPlaceholder:'',
    showRatio:false, showToUnits:false, showAlloc:false, showFromUnits:true,
    toSymPlaceholder:'e.g. NEWCODE',
  },
  spinoff: {
    fromLabel:'Parent Symbol',      toLabel:'Spun-off Symbol',
    ratioLabel:'New Units Received',
    ratioPlaceholder:'',
    showRatio:false, showToUnits:true, showAlloc:true, showFromUnits:true,
    toSymPlaceholder:'e.g. SPINCO',
  },
  worthless: {
    fromLabel:'Symbol (delisted/bankrupt)', toLabel:'',
    ratioLabel:'', ratioPlaceholder:'',
    showRatio:false, showToUnits:false, showAlloc:false, showFromUnits:true,
    toSymPlaceholder:'',
  },
};

function setCaType(t){
  caType = t;
  document.querySelectorAll('.ca-pill').forEach(p=>{
    p.classList.toggle('active', p.textContent.toLowerCase().includes(
      {merger:'merger',split:'split',rename:'rename',spinoff:'spin',worthless:'write'}[t]||t
    ));
  });
  const cfg = CA_CONFIG[t];
  $('ca-from-label').textContent    = cfg.fromLabel;
  $('ca-to-label').textContent      = cfg.toLabel;
  $('ca-to-sym').placeholder        = cfg.toSymPlaceholder;
  $('ca-ratio-label').textContent   = cfg.ratioLabel;
  $('ca-ratio').placeholder         = cfg.ratioPlaceholder;
  $('ca-ratio-wrap').style.display    = cfg.showRatio   ? '' : 'none';
  $('ca-to-units-wrap').style.display = cfg.showToUnits ? '' : 'none';
  $('ca-alloc-wrap').style.display    = cfg.showAlloc   ? '' : 'none';
  // Show override for merger/rename/spinoff — not split (cost basis can't change in a split)
  $('ca-override-wrap').style.display = (t!=='split') ? '' : 'none';
  // For split: to-sym mirrors from-sym
  if(t==='split'){
    $('ca-to-sym').value = $('ca-from-sym').value;
    $('ca-to-sym').readOnly = true;
    $('ca-to-sym').style.opacity = '0.5';
  } else if(t==='worthless'){
    // Hide to-symbol row entirely for write-off
    $('ca-to-sym').value = '';
    $('ca-to-sym').readOnly = true;
    $('ca-to-sym').style.opacity = '0';
    $('ca-override-wrap').style.display = 'none';
  } else {
    $('ca-to-sym').readOnly = false;
    $('ca-to-sym').style.opacity = '';
  }
  // Auto-fill from-units from holdings
  caAutoFillUnits();
  caPreview();
}

function caAutoFillUnits(){
  const sym = $('ca-from-sym').value.trim();
  if(!sym) return;
  const h = calcH().find(x=>x.symbol===sym);
  if(h){
    $('ca-from-units').value = h.units;
    $('ca-from-units').placeholder = h.units + ' (from holdings)';
  }
}

function caPreview(){
  const fromSym  = $('ca-from-sym').value.trim();
  const toSym    = caType==='split' ? fromSym : $('ca-to-sym').value.trim();
  const fromUnits= parseFloat($('ca-from-units').value)||0;
  const ratio    = parseFloat($('ca-ratio').value)||0;
  const toUnits  = caType==='spinoff'
    ? (parseFloat($('ca-to-units').value)||0)
    : caType==='rename' ? fromUnits
    : (fromUnits * ratio);
  const alloc    = parseFloat($('ca-alloc').value)||0;

  if(!fromSym){ $('ca-preview').style.display='none'; return; }

  const h = calcH().find(x=>x.symbol===fromSym);
  const costBasis = h ? h.costBasis : 0;
  const newCostBasis = caType==='spinoff' ? costBasis*(alloc/100) : costBasis;
  const remainCost   = caType==='spinoff' ? costBasis*(1-alloc/100) : 0;

  let lines = [];
  const overrideVal = parseFloat($('ca-override')?.value)||0;
  const effectiveCost = overrideVal>0 ? overrideVal : costBasis;
  if(caType==='merger'){
    lines = [
      `<b>${fromSym}</b> — ${nN(fromUnits,4)} units → <span style="color:var(--neg)">retired</span>`,
      `<b>${toSym}</b> — receive ${nN(toUnits,4)} units (ratio ${ratio}:1)`,
      overrideVal>0
        ? `Cost basis: <span style="color:var(--gold)">overridden to ${n2(overrideVal)}</span> → <b>${toSym}</b> @ ${toUnits>0?n2(overrideVal/toUnits,4):'-'}/unit`
        : `Cost basis transfers: ${n2(costBasis)} → <b>${toSym}</b> @ implied ${toUnits>0?n2(costBasis/toUnits,4):'-'}/unit`,
    ];
  } else if(caType==='split'){
    lines = [
      `<b>${fromSym}</b> — ${nN(fromUnits,4)} units → <b>${nN(toUnits,4)} units</b> (${ratio}:1 split)`,
      `Cost basis unchanged: ${n2(costBasis)} total, new avg ${toUnits>0?n2(costBasis/toUnits,4):'-'}/unit`,
    ];
  } else if(caType==='rename'){
    lines = [
      `<b>${fromSym}</b> — ${nN(fromUnits,4)} units renamed to <b>${toSym}</b>`,
      `Cost basis transfers unchanged: ${n2(costBasis)}`,
    ];
  } else if(caType==='spinoff'){
    lines = [
      `<b>${fromSym}</b> keeps ${(100-alloc).toFixed(1)}% of cost basis → ${n2(remainCost)}`,
      `<b>${toSym}</b> receives ${nN(toUnits,4)} units + ${alloc.toFixed(1)}% cost basis → ${n2(newCostBasis)}`,
    ];
  }
  $('ca-preview-text').innerHTML = lines.join('<br>');
  $('ca-preview').style.display = '';
}

function addCorporateAction(){
  const date     = $('ca-date').value;
  const fromSym  = $('ca-from-sym').value.trim().toUpperCase();
  const toSym    = caType==='split' ? fromSym : $('ca-to-sym').value.trim().toUpperCase();
  const fromUnits= parseFloat($('ca-from-units').value);
  const ratio    = parseFloat($('ca-ratio').value)||0;
  const toUnitsField = parseFloat($('ca-to-units').value)||0;
  const alloc    = parseFloat($('ca-alloc').value)||0;
  const assetType= $('ca-at').value;
  const notes    = $('ca-notes').value.trim();

  if(!date||!fromSym){ notify('Date and From Symbol are required.','err'); return; }
  if(caType==='worthless'){
    // Write-off: record a $0 sell for all units → crystallises capital loss
    const h = calcH().find(x=>x.symbol===fromSym);
    const units = h ? h.units : (parseFloat($('ca-from-units').value)||0);
    if(!units){ notify(`No holdings found for ${fromSym}.`,'err'); return; }
    const writeOff = {
      id:uid(), date, type:'sell', symbol:fromSym,
      assetType: $('ca-at').value||'asx_stock',
      units, price:0, fees:0, source:'manual',
      notes:`Capital loss write-off — ${fromSym} delisted/worthless. Cost basis: ${n2(h?h.costBasis:0)}.`,
      subtype:'', caLabel:'Write-off (Worthless)',
    };
    trades.push(writeOff);
    save(); clearCaForm(); renderH(); renderT(); renderR();
    notify(`✓ ${fromSym} written off — ${units.toFixed(4)} units at $0. Capital loss: ${n2(h?h.costBasis:0)}.`);
    return;
  }
  if(caType!=='rename'&&caType!=='spinoff'&&!ratio){ notify('Enter a conversion ratio.','err'); return; }
  if(caType==='spinoff'&&(!toUnitsField||!alloc)){ notify('Enter new units and cost basis % for spin-off.','err'); return; }
  if(!toSym&&caType!=='split'){ notify('Enter the new symbol.','err'); return; }

  const h = calcH().find(x=>x.symbol===fromSym);
  const actualFromUnits = (!isNaN(fromUnits)&&fromUnits>0) ? fromUnits : (h?h.units:0);
  if(!actualFromUnits){ notify(`No holdings found for ${fromSym}. Check symbol or enter units manually.`,'err'); return; }

  const toUnits = caType==='spinoff' ? toUnitsField
                : caType==='rename'  ? actualFromUnits
                : actualFromUnits * ratio;

  // The implied price for the to-side is costBasis/toUnits (preserves cost basis)
  const costBasis = h ? h.costBasis : 0;
  const overrideCost = parseFloat($('ca-override')?.value)||0;
  const effectiveCostBasis = overrideCost>0 ? overrideCost : costBasis;
  const impliedPrice = toUnits>0 ? effectiveCostBasis/toUnits : 0;

  const baseFields = { date, assetType, source:'manual', notes, fromSymbol:fromSym,
                       fromUnits:actualFromUnits };

  const fromTrade = {
    ...baseFields,
    id:uid(), type:'corporate_action',
    subtype: caType+'_from',
    symbol: fromSym,
    units: actualFromUnits,
    price: 0,
    fees: 0,
    caLabel: CA_LABELS[caType],
  };

  const toTrade = {
    ...baseFields,
    id:uid(), type:'corporate_action',
    subtype: caType+'_to',
    symbol: toSym,
    units: toUnits,
    price: impliedPrice,
    fees: 0,
    caLabel: CA_LABELS[caType],
    ...(caType==='spinoff' ? {allocPct:alloc} : {}),
    ...(overrideCost>0 ? {overrideCostBasis:overrideCost} : {}),
  };

  // Warn if a _from trade already exists for this symbol on same date
  const existingFrom = trades.find(t=>
    t.type==='corporate_action' && t.symbol===fromSym &&
    (t.subtype||'').endsWith('_from') && t.date===date);
  if(existingFrom){
    if(!confirm(`⚠ There is already a ${CA_LABELS[caType]} recorded for ${fromSym} on ${date}.\n\nAdding another may cause duplicate cost basis issues.\n\nContinue anyway?`))
      return;
  }
  trades.push(fromTrade);
  if(caType!=='split') trades.push(toTrade);
  else {
    // Split: just adjust units in-place via a special from record only
    fromTrade.subtype = 'split_from';
    fromTrade.splitRatio = ratio;
    const splitToTrade = { ...toTrade, subtype:'split_to', symbol:fromSym };
    trades.push(splitToTrade);
  }

  save(); clearCaForm(); renderH(); renderT(); renderR();
  notify(`Corporate action recorded: ${CA_LABELS[caType]} — ${fromSym}${caType!=='split'?' → '+toSym:''}`);
}

const CA_LABELS = {
  merger:'Merger/Conversion', split:'Stock Split',
  rename:'Ticker Rename',     spinoff:'Spin-off',
  worthless:'Write-off (Worthless)',
};

function clearCaForm(){
  ['ca-date','ca-from-sym','ca-from-units','ca-to-sym','ca-ratio','ca-to-units','ca-alloc','ca-override','ca-notes']
    .forEach(id=>{ const el=$(id); if(el) el.value=''; });
  $('ca-preview').style.display = 'none';
  setCaType(caType); // re-apply layout
}

// ── TABS ─────────────────────────────────────────────────────────────
