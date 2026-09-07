// ── kbd.js ───────────────────────────────────────────────────────────
// Keyboard shortcuts:
//   1–9, 0   Jump to tab (0 = 10th tab). Matches the order they appear
//            in the .tabs bar, so this stays correct if tabs are
//            reordered without needing any change here.
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

  if(/^[0-9]$/.test(e.key)){
    const idx = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
    const tabs = document.querySelectorAll('.tabs .tab');
    const el = tabs[idx];
    if(!el) return;
    const m = (el.getAttribute('onclick') || '').match(/switchTab\('([^']+)'/);
    if(m && typeof switchTab === 'function'){ switchTab(m[1], el); e.preventDefault(); }
    return;
  }

  if(e.key === '/'){
    const active = document.querySelector('.panel.active');
    const input = active && active.querySelector('input#hs, input#hd-search');
    if(input){ e.preventDefault(); input.focus(); input.select(); }
  }
});
