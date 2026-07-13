'use strict';

const { fmt, envFlag } = require('./format');

// ---- Near auto-compaction headroom ----------------------------------------
// The CLI compacts the LIVE context at objective fractions of the model's
// PROMPT budget (promptTokenLimit) -- NOT of the displayed window. Constants
// read straight from the CLI's native addon (runtime.node, 1.0.71):
//   0.75 static-context warning . 0.80 background auto-compaction
//   0.85 static-context block   . 0.95 buffer exhaustion (hard ceiling)
// and confirmed in app.js contextInfo(): compactionThreshold =
// floor(promptTokenLimit * 0.80); limit(displayed) = promptTokenLimit +
// outputTokenLimit; bufferTokens = outputTokenLimit + floor(promptTokenLimit *
// 0.05). We recover promptTokenLimit = displayed_context_limit -
// outputTokenLimit(model), which is tier-correct (the payload's displayed limit
// already reflects the active tier; outputTokenLimit is ~constant per model).
// The marker counts down to the 0.80 background compaction -- the first
// threshold that actually reclaims space. See THRESHOLDS.md.
const COMPACT_AT = 0.8; // contextBackgroundCompactionThreshold()
function compactWarnRatio() {
  // When the marker starts showing, as a fraction of promptTokenLimit. Default
  // 0.75 (the CLI's own static-context warning stage). Must be < COMPACT_AT.
  const v = parseFloat(process.env.COPILOT_STATUSLINE_COMPACT_WARN);
  return Number.isFinite(v) && v > 0 && v < COMPACT_AT ? v : 0.75;
}

// Per-model max_output_tokens (default tier) -- the ONLY unknown needed to turn
// the displayed window into promptTokenLimit. Sourced from the CLI's native
// catalog (catalogLookupModelLimits) and, for models it resolves from the API,
// from the "Applied model capabilities" lines in ~/.copilot/logs/process-*.log.
// Most-specific patterns first. Unknown/future models -> null (marker hidden,
// never guessed); override those with COPILOT_STATUSLINE_OUTPUT_TOKENS.
const OUTPUT_TOKENS = [
  [/codex/, 128000], // gpt-5.3-codex
  [/gpt-?5[.\-]\d/, 128000], // gpt-5.3/5.4/5.5/5.6 (+ their -mini/-nano)
  [/gpt-?5[ _-]?mini/, 64000], // plain gpt-5-mini (no minor version)
  [/gpt-?5/, 128000], // other gpt-5.x
  [/haiku/, 64000],
  [/opus-?4[.\-]?(7|8)|opus-?[5-9]/, 64000], // opus 4.7/4.8 and >=5
  [/opus/, 32000], // opus 4.6 and older
  [/sonnet-?(5|[6-9])/, 64000], // sonnet 5 and newer
  [/sonnet/, 32000], // sonnet 4.x
  [/gemini/, 64000], // gemini 3.1 pro + 3.5 flash (both contain "gemini")
];
function outputTokensFor(modelId) {
  const ov = parseInt(process.env.COPILOT_STATUSLINE_OUTPUT_TOKENS || '', 10);
  if (Number.isFinite(ov) && ov >= 0) return ov;
  const id = String(modelId || '').toLowerCase();
  for (const [re, n] of OUTPUT_TOKENS) if (re.test(id)) return n;
  return null; // unknown model -> caller hides the marker (never guesses)
}

// Recover promptTokenLimit and the 0.80 background-compaction point from the
// displayed window, and how much live headroom remains to it. Returns nulls
// when the live context or the model's output limit is unknown (marker hidden).
// `displayedLimit` MUST be the tier-correct displayed_context_limit (NOT the
// context_window_size fallback, which is the raw model window).
function computeCompaction(displayedLimit, ctxCur, modelId) {
  let promptLimit = null,
    compactAt = null,
    compactHead = null;
  if (ctxCur != null) {
    const outLimit = outputTokensFor(modelId);
    if (displayedLimit > 0 && outLimit != null && displayedLimit > outLimit) {
      promptLimit = displayedLimit - outLimit;
      compactAt = Math.floor(promptLimit * COMPACT_AT);
      compactHead = compactAt - ctxCur;
    }
  }
  return { promptLimit, compactAt, compactHead };
}

// Build the "near auto-compaction" segment descriptor { text, danger } from a
// computeCompaction() result, or null to render nothing. Shown only in the
// final stretch before compaction (>= COMPACT_WARN * promptTokenLimit) and
// suppressed by COPILOT_STATUSLINE_HIDE_COMPACT. Danger escalates mild -> red
// across warn..target, then hard red once past the target.
function compactionMarker(ctxCur, comp) {
  if (envFlag('COPILOT_STATUSLINE_HIDE_COMPACT') || comp.compactAt == null) {
    return null;
  }
  const warnAt = Math.floor(comp.promptLimit * compactWarnRatio());
  if (ctxCur < warnAt) return null;
  const text =
    comp.compactHead > 0
      ? `\u26A0 compact ${fmt(comp.compactHead)}`
      : '\u26A0 compacting';
  let d = 1;
  if (ctxCur < comp.compactAt) {
    d = 0.4 + 0.6 * ((ctxCur - warnAt) / Math.max(1, comp.compactAt - warnAt));
  }
  return { text, danger: Math.min(1, d) };
}

module.exports = {
  COMPACT_AT,
  compactWarnRatio,
  outputTokensFor,
  computeCompaction,
  compactionMarker,
};
