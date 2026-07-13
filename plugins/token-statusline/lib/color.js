'use strict';

// ANSI/SGR coloring: whether color is on, the grey "base" text color, the
// green->red danger gradient, and the small helper that chooses between them.

// Honor the de-facto NO_COLOR standard (https://no-color.org).
function colorEnabled() {
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== '') return false;
  const v = (process.env.COPILOT_STATUSLINE_COLOR || '').trim().toLowerCase();
  if (v === 'none' || v === 'off') return false;
  return true;
}

// Base SGR for ordinary status text — matches the CLI's grey built-in statuses
// (theme `textSecondary`). Override with COPILOT_STATUSLINE_COLOR: "auto"
// (default, dark #9198A1), "light" (#59636e), "dim", "none", bare SGR, "R;G;B".
function baseSgr() {
  if (!colorEnabled()) return null;
  const v = (process.env.COPILOT_STATUSLINE_COLOR || 'auto').trim().toLowerCase();
  if (v === 'dim') return '2';
  if (v === 'light') return '38;2;89;99;110'; // #59636e
  if (v === 'auto' || v === 'github' || v === 'dark' || v === '')
    return '38;2;145;152;161'; // #9198A1
  if (/^\d+(;\d+){0,3}$/.test(v)) return v; // bare SGR or R;G;B
  return '38;2;145;152;161';
}

function paint(text, sgr) {
  if (!text || !sgr) return text;
  return `\x1b[${sgr}m${text}\x1b[0m`;
}

// Green -> yellow -> orange -> red gradient (GitHub Primer hues).
const DANGER_STOPS = [
  [0.0, [63, 185, 80]], // #3FB950 green
  [0.45, [210, 153, 34]], // #D29922 yellow
  [0.75, [219, 109, 40]], // #DB6D28 orange
  [1.0, [248, 81, 73]], // #F85149 red
];
function dangerSgr(d) {
  d = Math.max(0, Math.min(1, Number(d) || 0));
  let rgb = DANGER_STOPS[DANGER_STOPS.length - 1][1];
  for (let i = 1; i < DANGER_STOPS.length; i++) {
    const [a, ca] = DANGER_STOPS[i - 1];
    const [b, cb] = DANGER_STOPS[i];
    if (d <= b) {
      const t = b === a ? 0 : (d - a) / (b - a);
      rgb = ca.map((c, k) => Math.round(c + (cb[k] - c) * t));
      break;
    }
  }
  return `38;2;${rgb[0]};${rgb[1]};${rgb[2]}`;
}

// Pick the gradient color for a danger score, or fall back to `base` when the
// gradient is off/unavailable. Centralizes the repeated
// "danger != null && colorEnabled() && !noGradient ? dangerSgr(d) : base"
// decision used by the ctx / compaction / spike segments. A null danger (no
// score) also falls back to base.
function gradientSgr(danger, base, noGradient) {
  return danger != null && colorEnabled() && !noGradient
    ? dangerSgr(danger)
    : base;
}

module.exports = { colorEnabled, baseSgr, paint, dangerSgr, gradientSgr };
