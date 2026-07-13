#!/usr/bin/env node
'use strict';

/*
 * Copilot CLI custom status line: per-session token usage.
 *
 * The CLI pipes a JSON "status object" to this script on stdin and renders
 * whatever this script prints to stdout as the custom status-line item.
 * (Enable display with footer.showCustom = true.)
 *
 * It also appends/updates a per-session ledger on disk so you can review how
 * many tokens each session consumed after the fact:
 *   <COPILOT_HOME>/statusline/sessions/<session_id>.json
 *
 * Contract fields used (Copilot CLI 1.0.71): context_window.{current_context_tokens,
 * displayed_context_limit, current_context_used_percentage, context_window_size,
 * used_percentage, total_tokens, total_input_tokens, total_output_tokens,
 * total_cache_read_tokens, total_cache_write_tokens, total_reasoning_tokens},
 * ai_used.{formatted,total_nano_aiu}, model.{id,display_name}, session_id,
 * session_name, cwd.
 *
 * The context segment is colored by a per-model "dumb zone" gradient
 * (green -> yellow -> orange -> red). See MODEL_ZONES below.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function fmt(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

// ---- Color -----------------------------------------------------------------
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

(async () => {
  let out = '';
  try {
    const raw = await readStdin();
    const s = JSON.parse(raw);
    const cw = s.context_window || {};

    // Cumulative (billed) input/output across every call this session — grows
    // without bound because each turn re-sends the whole context as input.
    const inTok = cw.total_input_tokens || 0;
    const outTok = cw.total_output_tokens || 0;
    const cacheRead = cw.total_cache_read_tokens || 0;
    const cumTotal = cw.total_tokens != null ? cw.total_tokens : inTok + outTok;

    // Live context-window occupancy — this is what `/context` shows.
    const ctxCur =
      typeof cw.current_context_tokens === 'number'
        ? cw.current_context_tokens
        : null;
    const ctxLimit =
      cw.displayed_context_limit != null
        ? cw.displayed_context_limit
        : cw.context_window_size != null
        ? cw.context_window_size
        : null;
    let ctxPct = cw.current_context_used_percentage;
    if (ctxPct == null && ctxCur != null && ctxLimit > 0) {
      ctxPct = Math.min(100, Math.round((ctxCur / ctxLimit) * 100));
    }

    const aiu = s.ai_used && s.ai_used.formatted ? s.ai_used.formatted : null;
    // The CLI labels this unit "AIC" (AI Credits) — its own footer renders
    // `Session: <cO(total_nano_aiu)> AIC used`, where cO = total_nano_aiu / 1e9
    // (already weighted by the model's request_multiplier). Money = credits x
    // the AI-credit price; GitHub set 1 AI Credit = $0.01 USD in the 2026-06
    // billing change. Override the rate with COPILOT_STATUSLINE_USD_PER_AIC.
    const aiuNano =
      s.ai_used && typeof s.ai_used.total_nano_aiu === 'number'
        ? s.ai_used.total_nano_aiu
        : null;
    const aiuNum =
      aiuNano != null ? aiuNano / 1e9 : aiu != null ? parseFloat(aiu) : null;
    const usdPerAic = (() => {
      const v = parseFloat(process.env.COPILOT_STATUSLINE_USD_PER_AIC);
      return Number.isFinite(v) && v >= 0 ? v : 0.01;
    })();
    const estUsd = aiuNum != null ? aiuNum * usdPerAic : null;
    const base = baseSgr();
    const home =
      process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');

    // The context segment now shows by default (turn off the built-in one via
    // footer.showContextWindow=false). Hide ours with
    // COPILOT_STATUSLINE_HIDE_CONTEXT=1; disable the color gradient with
    // COPILOT_STATUSLINE_NO_GRADIENT=1.
    const hideCtx = /^(1|true|yes|on)$/i.test(
      process.env.COPILOT_STATUSLINE_HIDE_CONTEXT || ''
    );
    const noGradient = /^(1|true|yes|on)$/i.test(
      process.env.COPILOT_STATUSLINE_NO_GRADIENT || ''
    );

    // Map the model to its "dumb zone" and score how deep the context is (0..1).
    const modelId = (s.model && (s.model.id || s.model.display_name)) || '';
    const zone = zonesFor(modelId, ctxLimit);
    const curForDanger =
      ctxCur != null
        ? ctxCur
        : ctxPct != null && ctxLimit > 0
        ? Math.round((ctxPct / 100) * ctxLimit)
        : null;
    const danger =
      curForDanger != null ? dangerFor(curForDanger, ctxLimit, zone) : null;

    const segs = [];
    if (!hideCtx) {
      let seg = null;
      if (ctxCur != null) {
        seg = `ctx ${fmt(ctxCur)}`;
        if (ctxLimit > 0) seg += `/${fmt(ctxLimit)}`;
        if (ctxPct != null) seg += ` (${ctxPct}%)`;
      } else if (ctxPct != null) {
        seg = `ctx ${ctxPct}%`;
      }
      if (seg) {
        const sgr =
          danger != null && colorEnabled() && !noGradient
            ? dangerSgr(danger)
            : base;
        segs.push(paint(seg, sgr));
      }
    }
    // Near auto-compaction headroom. Counts live context down to the 0.80
    // background-compaction point (floor(promptTokenLimit * 0.80)), where the CLI
    // silently compacts to reclaim space. promptTokenLimit is recovered per
    // model/tier as displayed_context_limit - outputTokenLimit(model) -- NOT a
    // flat % of the displayed window (the reserved buffer is 11-37% of it,
    // depending on tier, so displayed-% would be wrong). Shown only in the final
    // stretch before compaction (>= COMPACT_WARN * promptTokenLimit). Hide with
    // COPILOT_STATUSLINE_HIDE_COMPACT=1.
    const hideCompact = /^(1|true|yes|on)$/i.test(
      process.env.COPILOT_STATUSLINE_HIDE_COMPACT || ''
    );
    let promptLimit = null,
      compactAt = null,
      compactHead = null;
    if (ctxCur != null) {
      // Use displayed_context_limit ONLY (tier-correct); the context_window_size
      // fallback is the raw model window and would break the derivation.
      const displayedLimit = cw.displayed_context_limit;
      const outLimit = outputTokensFor(modelId);
      if (displayedLimit > 0 && outLimit != null && displayedLimit > outLimit) {
        promptLimit = displayedLimit - outLimit;
        compactAt = Math.floor(promptLimit * COMPACT_AT);
        compactHead = compactAt - ctxCur;
      }
    }
    if (!hideCompact && compactAt != null) {
      const warnAt = Math.floor(promptLimit * compactWarnRatio());
      if (ctxCur >= warnAt) {
        const label =
          compactHead > 0 ? `\u26A0 compact ${fmt(compactHead)}` : '\u26A0 compacting';
        // Escalate mild -> red across warn..target; hard red once past target.
        let d = 1;
        if (ctxCur < compactAt) {
          d = 0.4 + 0.6 * ((ctxCur - warnAt) / Math.max(1, compactAt - warnAt));
        }
        const sgr = colorEnabled() && !noGradient ? dangerSgr(Math.min(1, d)) : base;
        segs.push(paint(label, sgr));
      }
    }
    // Transient "output strike" marker. The companion token-spike extension
    // (an onPostToolUse hook) records big tool results — the #1 source of
    // context bloat, and something this status line can't see on its own — to a
    // shared activity file. We surface the most recent spike briefly so you
    // notice the hit and can decide whether to prune/handoff. Objective size
    // (approx tokens), no dumb-zone thresholds. Hide with
    // COPILOT_STATUSLINE_HIDE_SPIKE=1; adjust how long it stays visible with
    // COPILOT_STATUSLINE_SPIKE_WINDOW_MS (default 90000).
    const hideSpike = /^(1|true|yes|on)$/i.test(
      process.env.COPILOT_STATUSLINE_HIDE_SPIKE || ''
    );
    if (!hideSpike && s.session_id) {
      try {
        const safe = String(s.session_id).replace(/[^A-Za-z0-9._-]/g, '_');
        const af = path.join(home, 'statusline', 'tool-activity', `${safe}.json`);
        const act = JSON.parse(fs.readFileSync(af, 'utf8'));
        const sp = act && act.spike;
        if (sp && typeof sp.at === 'number') {
          const winMs = (() => {
            const v = parseInt(
              process.env.COPILOT_STATUSLINE_SPIKE_WINDOW_MS || '',
              10
            );
            return Number.isFinite(v) && v > 0 ? v : 90000;
          })();
          if (Date.now() - sp.at <= winMs) {
            const sgr = colorEnabled() && !noGradient ? dangerSgr(0.72) : base;
            const tool = String(sp.tool || 'tool').slice(0, 16);
            segs.push(paint(`\u25B2 ${tool} ${fmt(sp.tokens)}`, sgr));
          }
        }
      } catch (_) {
        // No activity file (extension not installed / no recent spike) -> no marker.
      }
    }
    // Cumulative tokens billed through the API this session — input + output
    // across every call, i.e. the real usage/cost, distinct from context size.
    // Shown by default; hide with COPILOT_STATUSLINE_HIDE_CUMULATIVE=1.
    const hideCum = /^(1|true|yes|on)$/i.test(
      process.env.COPILOT_STATUSLINE_HIDE_CUMULATIVE || ''
    );
    if (!hideCum && cumTotal > 0) {
      // Keep the input/output split so the cost breakdown is visible (input and
      // output are priced differently).
      let cseg = `\u03A3${fmt(cumTotal)}`;
      if (inTok > 0 || outTok > 0) {
        cseg += ` (in ${fmt(inTok)}/out ${fmt(outTok)})`;
      }
      segs.push(paint(cseg, base));
    }
    // Cache-hit rate: share of INPUT tokens served from the prompt cache (cheap
    // reads) vs freshly processed. High = your stable prefix is being reused
    // well. Objective — straight from the payload, no thresholds. Hide with
    // COPILOT_STATUSLINE_HIDE_CACHE=1.
    const hideCache = /^(1|true|yes|on)$/i.test(
      process.env.COPILOT_STATUSLINE_HIDE_CACHE || ''
    );
    if (!hideCache && inTok > 0 && cacheRead > 0) {
      segs.push(paint(`cache ${Math.round((cacheRead / inTok) * 100)}%`, base));
    }
    // Credits used this session + estimated real money. Hide the $ estimate
    // with COPILOT_STATUSLINE_HIDE_USD=1.
    if (aiuNum != null) {
      const hideUsd = /^(1|true|yes|on)$/i.test(
        process.env.COPILOT_STATUSLINE_HIDE_USD || ''
      );
      // Prefer the CLI's own formatted credit figure; if it rounds to 0 while
      // there is real (tiny) usage, fall back to a "<0.01" hint.
      let credStr;
      if (aiu != null && parseFloat(aiu) > 0) credStr = aiu;
      else if (aiuNum > 0) credStr = aiuNum < 0.01 ? '<0.01' : String(Math.round(aiuNum * 100) / 100);
      else credStr = '0';
      let aseg = `${credStr} AIC`;
      if (!hideUsd && estUsd != null) {
        const two = estUsd.toFixed(2);
        aseg += ' ' + (estUsd > 0 && two === '0.00' ? '<$0.01' : `\u2248$${two}`);
      }
      segs.push(paint(aseg, base));
    }
    // Fallback so the line is never empty (e.g. everything above suppressed).
    if (segs.length === 0 && cumTotal > 0) {
      segs.push(paint(`\u03A3${fmt(cumTotal)}`, base));
    }
    out = segs.join(paint(' | ', base));

    if (s.session_id) {
      const dir = path.join(home, 'statusline', 'sessions');
      fs.mkdirSync(dir, { recursive: true });
      const rec = {
        session_id: s.session_id,
        session_name: s.session_name || null,
        model:
          (s.model && (s.model.display_name || s.model.id)) || null,
        cwd: s.cwd || null,
        // Live context-window occupancy (matches `/context`).
        current_context_tokens: ctxCur,
        context_limit: ctxLimit,
        context_used_percentage: ctxPct != null ? ctxPct : null,
        // "Dumb zone" model map + how deep we are (0 = smart .. 1 = deep).
        model_tier: zone ? zone.tier : null,
        dumb_zone_smart_until: zone ? zone.smartUntil : null,
        dumb_zone_from: zone ? zone.dumbFrom : null,
        dumb_zone_danger: danger != null ? Math.round(danger * 100) / 100 : null,
        // Near auto-compaction: promptTokenLimit (recovered), the 0.80 target,
        // and live headroom to it. Null when the model's output limit is unknown.
        compaction_prompt_limit: promptLimit,
        compaction_at: compactAt,
        compaction_headroom: compactHead,
        // Cumulative billed usage across all calls this session.
        cumulative_input_tokens: inTok,
        cumulative_output_tokens: outTok,
        cumulative_cache_read_tokens: cw.total_cache_read_tokens || 0,
        cumulative_cache_write_tokens: cw.total_cache_write_tokens || 0,
        cumulative_reasoning_tokens: cw.total_reasoning_tokens || 0,
        cumulative_total_tokens: cumTotal,
        ai_credits_used: aiuNum,
        ai_used_nano_aiu: aiuNano != null ? aiuNano : 0,
        estimated_usd: estUsd != null ? Math.round(estUsd * 10000) / 10000 : null,
        usd_per_aic: usdPerAic,
        updated_at: new Date().toISOString(),
      };
      const safeId = String(s.session_id).replace(/[^A-Za-z0-9._-]/g, '_');
      const file = path.join(dir, `${safeId}.json`);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
      fs.renameSync(tmp, file);
    }
  } catch (_) {
    // Never break the status line: emit whatever we have (possibly empty).
  }
  // Segments are already individually painted; write as-is.
  process.stdout.write(out);
  process.exit(0);
})();
