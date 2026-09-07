// ── excitement.js ─────────────────────────────────────────────────────
// Animated count-up/down, flash pulse, mini sparkline, and all-time-high
// milestone moment for the Portfolio summary cards. Purely presentational
// — reads pfSnapshots/prices that portfolio.js already maintains, never
// writes trade/holding data. Safe to remove this file and its <script>
// tag with zero effect on core functionality.

// ── Animated count-up/down with flash pulse ────────────────────────────
// el.dataset.rawVal remembers the last numeric value painted so repeat
// calls (every renderH()) tween from where the number actually was,
// rather than re-animating from zero each time.
function animateValue(el, target, opts = {}) {
  if (!el) return;
  const fmt = opts.format || (n => n.toFixed(opts.decimals ?? 2));
  if (target == null) {
    el.dataset.rawVal = '';
    el.textContent = '—';
    return;
  }
  const prevRaw = el.dataset.rawVal !== '' && el.dataset.rawVal != null
    ? parseFloat(el.dataset.rawVal) : null;
  el.dataset.rawVal = String(target);

  // First paint or negligible change — no animation needed.
  if (prevRaw == null || !isFinite(prevRaw) || Math.abs(target - prevRaw) < 0.005) {
    el.textContent = fmt(target);
    return;
  }

  const card = opts.flash !== false ? el.closest('.card') : null;
  if (card) {
    card.classList.remove('flash-pos', 'flash-neg');
    void card.offsetWidth; // restart CSS animation
    card.classList.add(target >= prevRaw ? 'flash-pos' : 'flash-neg');
    clearTimeout(card._flashT);
    card._flashT = setTimeout(() => card.classList.remove('flash-pos', 'flash-neg'), 900);
  }

  const start = prevRaw, delta = target - start, dur = 650, t0 = performance.now();
  cancelAnimationFrame(el._raf);
  (function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
    el.textContent = fmt(start + delta * eased);
    if (p < 1) el._raf = requestAnimationFrame(tick);
    else el.textContent = fmt(target);
  })(t0);
}

// ── All-time-high milestone ─────────────────────────────────────────
// Only fires for the unfiltered ("All") view, so switching to Stocks/
// Crypto never triggers a false milestone off a subset total.
function checkAthMilestone(tv, portfolioView) {
  if (portfolioView !== 0 || tv == null || tv <= 0) return;
  let ath = null;
  try { ath = parseFloat(localStorage.getItem('pt_ath')); } catch (e) {}
  const hadPrior = ath != null && isFinite(ath);
  if (!hadPrior || tv > ath + 0.01) {
    localStorage.setItem('pt_ath', String(tv));
    if (hadPrior) {
      const card = document.getElementById('cv') && document.getElementById('cv').closest('.card');
      if (card) {
        card.classList.remove('flash-ath');
        void card.offsetWidth;
        card.classList.add('flash-ath');
        clearTimeout(card._athT);
        card._athT = setTimeout(() => card.classList.remove('flash-ath'), 1400);
      }
      if (typeof notify === 'function') notify('🎉 New all-time high — ' + n2(tv), 'ok');
    }
  }
}

// ── Market Value sparkline ──────────────────────────────────────────
// Reads the last 14 days of pfSnapshots for whichever view (All/Stocks/
// Crypto) is currently active. Needs at least 2 priced days to draw.
let _mvSparkChart = null;
function renderMvSparkline(portfolioView) {
  const canvas = document.getElementById('mv-spark');
  if (!canvas || typeof pfSnapshots === 'undefined' || typeof Chart === 'undefined') return;
  const key = portfolioView === 1 ? 'stocks' : portfolioView === 2 ? 'crypto' : 'all';
  const dates = Object.keys(pfSnapshots).sort();
  const points = dates
    .map(d => pfSnapshots[d] && pfSnapshots[d][key])
    .filter(v => v != null)
    .slice(-14);

  if (_mvSparkChart) { _mvSparkChart.destroy(); _mvSparkChart = null; }
  if (points.length < 2) { canvas.style.visibility = 'hidden'; return; }
  canvas.style.visibility = 'visible';

  const up = points[points.length - 1] >= points[0];
  const lineColor = up
    ? getComputedStyle(document.documentElement).getPropertyValue('--green').trim()
    : getComputedStyle(document.documentElement).getPropertyValue('--red').trim();

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 28);
  gradient.addColorStop(0, lineColor + '33');
  gradient.addColorStop(1, lineColor + '00');

  _mvSparkChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: points.map((_, i) => i),
      datasets: [{
        data: points,
        borderColor: lineColor,
        backgroundColor: gradient,
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        tension: 0.35,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false },
      scales: {
        x: { display: false },
        y: { display: false },
      },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      elements: { line: { capBezierPoints: true } },
    },
  });
}
