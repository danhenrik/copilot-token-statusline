'use strict';

// ---- "Dumb zone" model map -------------------------------------------------
// Research consensus (2025-2026): an LLM's accuracy, instruction-following and
// reasoning silently degrade well before the advertised context limit — the
// "dumb zone" / "context rot". Onset tracks an ABSOLUTE token count more than a
// % of the window:
//   - Coding agents: practitioner guidance is to compact well before the window
//     fills (~50k-100k working tokens; HumanLayer's coding-agent context-
//     engineering talk). Chroma "Context Rot" (Jun 2025) finds coding worst-hit.
//   - RULER: effective context ~1/3 of advertised; reasoning-heavy ~10-20%.
//   - "Lost in the Middle" (Liu et al.) + NoLiMa: recall craters by ~32k even
//     for strong models once lexical cues are removed.
//   - Newer frontier models push the onset out (Opus > Sonnet > Haiku;
//     GPT-5 / Gemini-3-Pro large-window) but never remove it.
// PROVENANCE: the GENERAL ranges above are corroborated across many independent
// studies — RULER (17 models; effective context often ~50% for the best, ~1/3 on
// hard tasks; GPT-4 128k->64k, Claude 3 Opus 200k->~32-64k, Yi-34B 200k->32k),
// Chroma "Context Rot" (18 models, Jun 2025; coding worst-hit), NoLiMa (10/12
// models <50% by 32k), Lost-in-the-Middle (Liu et al.), HumanLayer's coding-agent
// context-engineering talk (practitioner: compact before ~50-100k), and
// Anthropic's context-engineering guide. The specific
// per-FAMILY numbers below are NOT a direct measurement of these exact 2026
// models (public benchmarks tested older gens); they are an EXTRAPOLATION of the
// recurring ranges scaled by each family's generation/long-context reputation.
// Treat them as tunable defaults, not measured constants.
// Per model FAMILY we set two absolute anchors (tokens):
//   smartUntil = still-reliable ceiling  -> stays green up to here
//   dumbFrom   = clearly inside dumb zone -> full red at/after here
// The context segment fades green -> yellow -> orange -> red between them.
// Unmatched models fall back to a WINDOW-RELATIVE default (see defaultZone).
// Override any model at runtime with COPILOT_STATUSLINE_ZONES="smartUntil,dumbFrom".
const MODEL_ZONES = [
  [/codex/, { smartUntil: 90000, dumbFrom: 220000, tier: 'gpt-codex' }],
  [/opus/, { smartUntil: 80000, dumbFrom: 180000, tier: 'claude-opus' }],
  [/sonnet/, { smartUntil: 60000, dumbFrom: 150000, tier: 'claude-sonnet' }],
  [/haiku/, { smartUntil: 40000, dumbFrom: 100000, tier: 'claude-haiku' }],
  [/\bmini\b/, { smartUntil: 45000, dumbFrom: 110000, tier: 'gpt-mini' }],
  [/gpt-?5|gpt5/, { smartUntil: 80000, dumbFrom: 200000, tier: 'gpt-5' }],
  [/flash/, { smartUntil: 50000, dumbFrom: 130000, tier: 'flash' }],
  [/gemini/, { smartUntil: 100000, dumbFrom: 250000, tier: 'gemini-pro' }],
  [/mai/, { smartUntil: 40000, dumbFrom: 100000, tier: 'mai' }],
];
// Fallback for UNMATCHED models: window-relative (RULER's "effective context
// ~= 50% of advertised" for the strongest models) but capped in absolute terms,
// because NoLiMa/Chroma/HumanLayer show the degradation onset is an absolute
// band (~32k-100k) that does NOT scale with window size -- a flat percentage
// would hand a very large window a free pass. Known families above keep their
// absolute anchors. When the window size is unknown we use DEFAULT_STATIC.
const DEFAULT_STATIC = { smartUntil: 50000, dumbFrom: 120000, tier: 'default' };
function defaultZone(limit) {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_STATIC;
  return {
    smartUntil: Math.min(Math.round(0.5 * limit), 128000),
    dumbFrom: Math.min(Math.round(0.9 * limit), 400000),
    tier: 'default',
  };
}

function zonesFor(modelId, limit) {
  const ov = (process.env.COPILOT_STATUSLINE_ZONES || '').trim();
  const m = ov.match(/^(\d+)\s*[,:/]\s*(\d+)$/);
  if (m) return { smartUntil: +m[1], dumbFrom: +m[2], tier: 'override' };
  const id = String(modelId || '').toLowerCase();
  for (const [re, z] of MODEL_ZONES) if (re.test(id)) return z;
  return defaultZone(limit);
}

// Danger score: 0 (smart / green) .. 1 (deep dumb zone / red).
function dangerFor(cur, limit, z) {
  let dAbs = 0;
  if (z.dumbFrom > z.smartUntil) {
    dAbs = (cur - z.smartUntil) / (z.dumbFrom - z.smartUntil);
  } else if (cur >= z.dumbFrom) {
    dAbs = 1;
  }
  dAbs = Math.max(0, Math.min(1, dAbs));
  // Safety: a nearly-full window is its own hazard (overflow / forced
  // compaction), so push toward red near the top regardless of the anchors.
  let dWin = 0;
  if (limit > 0) {
    dWin = (cur / limit - 0.7) / (0.98 - 0.7); // 0 at 70% .. 1 at 98%
    dWin = Math.max(0, Math.min(1, dWin));
  }
  return Math.max(dAbs, dWin);
}

module.exports = { zonesFor, dangerFor };
