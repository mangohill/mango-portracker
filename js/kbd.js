// ── kbd.js ───────────────────────────────────────────────────────────
// Keyboard shortcuts:
//   1–9, 0   Jump to tab (0 = 10th tab). Matches the order they appear
//            in the .tabs bar, so this stays correct if tabs are
//            reordered without needing any change here.
//   ← / →    Step to the previous / next tab, wrapping at both ends.
//            Covers every tab, including any past the tenth.
//   /        Focus the search box in the currently active tab
//            (Portfolio's #hs or Holdings' #hd-search), like GitHub/Slack.
//   Escape   Blur out of a focused search box.
//
// Disabled while typing in any input/select/textarea, while a HUD popup
// is open (id ending in "-backdrop"), or when a modifier key (Cmd/Ctrl/
// Alt) is held, so this never fights the browser's own shortcuts.

document.addEventListener('keydown', function(e){
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

  if(e.key === 'Escape' && typing){ t.blur(); return; }
  if(typing) return;
  if(e.metaKey || e.ctrlKey || e.altKey) return;
  if(document.querySelector('[id$="-backdrop"]')) return; // a HUD popup is open

  // Activate the tab element by replaying its inline switchTab() call, so the
  // tab order only ever has to live in index.html.
  const go = el => {
    if(!el) return false;
    const m = (el.getAttribute('onclick') || '').match(/switchTab\('([^']+)'/);
    if(!m || typeof switchTab !== 'function') return false;
    switchTab(m[1], el);
    e.preventDefault();
    return true;
  };

  if(/^[0-9]$/.test(e.key)){
    const idx = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
    go(document.querySelectorAll('.tabs .tab')[idx]);
    return;
  }

  // ← / → walk the strip and wrap, so tabs past the tenth (Capital Gains,
  // Settings) are reachable without a dedicated digit.
  if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
    const tabs = [...document.querySelectorAll('.tabs .tab')];
    const cur = tabs.indexOf(document.querySelector('.tab.active'));
    if(cur < 0) return;
    go(tabs[(cur + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]);
    return;
  }

  if(e.key === '/'){
    const active = document.querySelector('.panel.active');
    const input = active && active.querySelector('input#hs, input#hd-search');
    if(input){ e.preventDefault(); input.focus(); input.select(); }
  }
});
