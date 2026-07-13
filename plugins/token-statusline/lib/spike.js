'use strict';

const fs = require('fs');
const path = require('path');
const { fmt, envFlag } = require('./format');

// Transient "output strike" marker. The companion token-spike extension
// (an onPostToolUse hook) records big tool results — the #1 source of
// context bloat, and something this status line can't see on its own — to a
// shared activity file. We surface the most recent spike briefly so you
// notice the hit and can decide whether to prune/handoff. Objective size
// (approx tokens), no dumb-zone thresholds. Hide with
// COPILOT_STATUSLINE_HIDE_SPIKE=1; adjust how long it stays visible with
// COPILOT_STATUSLINE_SPIKE_WINDOW_MS (default 90000).
// Returns { text, danger } or null when there is no recent spike to show.
function spikeMarker(home, sessionId) {
  if (envFlag('COPILOT_STATUSLINE_HIDE_SPIKE') || !sessionId) return null;
  try {
    const safe = String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_');
    const af = path.join(home, 'statusline', 'tool-activity', `${safe}.json`);
    const act = JSON.parse(fs.readFileSync(af, 'utf8'));
    const sp = act && act.spike;
    if (sp && typeof sp.at === 'number') {
      const v = parseInt(
        process.env.COPILOT_STATUSLINE_SPIKE_WINDOW_MS || '',
        10
      );
      const winMs = Number.isFinite(v) && v > 0 ? v : 90000;
      if (Date.now() - sp.at <= winMs) {
        const tool = String(sp.tool || 'tool').slice(0, 16);
        return { text: `\u25B2 ${tool} ${fmt(sp.tokens)}`, danger: 0.72 };
      }
    }
  } catch (_) {
    // No activity file (extension not installed / no recent spike) -> no marker.
  }
  return null;
}

module.exports = { spikeMarker };
