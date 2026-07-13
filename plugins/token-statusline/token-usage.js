#!/usr/bin/env node
'use strict';

/*
 * Copilot CLI custom status line: per-session token usage (entry point).
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
 * This file only orchestrates: parse stdin -> build the colored segments ->
 * write the ledger. The reusable pieces live in ./lib (resolved relative to
 * this script, so it works from any cwd as long as lib/ ships alongside it):
 *   lib/format.js     readStdin, fmt, envFlag
 *   lib/color.js      colorEnabled, baseSgr, paint, dangerSgr, gradientSgr
 *   lib/zones.js      zonesFor, dangerFor   (per-model "dumb zone" gradient)
 *   lib/compaction.js computeCompaction, compactionMarker (near auto-compaction)
 *   lib/spike.js      spikeMarker           (token-spike extension bridge)
 *   lib/ledger.js     writeLedger           (atomic per-session ledger)
 */

const path = require('path');
const os = require('os');

const { readStdin, fmt, envFlag } = require('./lib/format');
const { colorEnabled, baseSgr, paint, gradientSgr } = require('./lib/color');
const { zonesFor, dangerFor } = require('./lib/zones');
const { computeCompaction, compactionMarker } = require('./lib/compaction');
const { spikeMarker } = require('./lib/spike');
const { writeLedger } = require('./lib/ledger');
const { dumpPayload } = require('./lib/debug');

(async () => {
  let out = '';
  try {
    const raw = await readStdin();
    const home =
      process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
    // Optional: snapshot the raw payload for building test fixtures (no-op
    // unless COPILOT_STATUSLINE_DEBUG_DUMP or a capture-next marker is set).
    dumpPayload(home, raw);
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

    // The context segment now shows by default (turn off the built-in one via
    // footer.showContextWindow=false). Hide ours with
    // COPILOT_STATUSLINE_HIDE_CONTEXT=1; disable the color gradient with
    // COPILOT_STATUSLINE_NO_GRADIENT=1.
    const hideCtx = envFlag('COPILOT_STATUSLINE_HIDE_CONTEXT');
    const noGradient = envFlag('COPILOT_STATUSLINE_NO_GRADIENT');

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

    // Near auto-compaction geometry — needed for BOTH the marker and the ledger,
    // so compute it once regardless of whether the marker is shown. Uses the
    // tier-correct displayed_context_limit only (not the context_window_size
    // fallback, which would break the derivation).
    const comp = computeCompaction(cw.displayed_context_limit, ctxCur, modelId);

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
      if (seg) segs.push(paint(seg, gradientSgr(danger, base, noGradient)));
    }

    // Near auto-compaction headroom: counts live context down to the 0.80
    // background-compaction point where the CLI silently reclaims space.
    const cMark = compactionMarker(ctxCur, comp);
    if (cMark) segs.push(paint(cMark.text, gradientSgr(cMark.danger, base, noGradient)));

    // Transient "output strike" marker from the companion token-spike extension.
    const sMark = spikeMarker(home, s.session_id);
    if (sMark) segs.push(paint(sMark.text, gradientSgr(sMark.danger, base, noGradient)));

    // Cumulative tokens billed through the API this session — input + output
    // across every call, i.e. the real usage/cost, distinct from context size.
    // Shown by default; hide with COPILOT_STATUSLINE_HIDE_CUMULATIVE=1.
    if (!envFlag('COPILOT_STATUSLINE_HIDE_CUMULATIVE') && cumTotal > 0) {
      // Keep the input/output split so the cost breakdown is visible (input and
      // output are priced differently).
      let cseg = `\u03A3${fmt(cumTotal)}`;
      if (inTok > 0 || outTok > 0) cseg += ` (in ${fmt(inTok)}/out ${fmt(outTok)})`;
      segs.push(paint(cseg, base));
    }

    // Cache-hit rate: share of INPUT tokens served from the prompt cache (cheap
    // reads) vs freshly processed. High = your stable prefix is being reused
    // well. Objective — straight from the payload, no thresholds. Hide with
    // COPILOT_STATUSLINE_HIDE_CACHE=1.
    if (!envFlag('COPILOT_STATUSLINE_HIDE_CACHE') && inTok > 0 && cacheRead > 0) {
      segs.push(paint(`cache ${Math.round((cacheRead / inTok) * 100)}%`, base));
    }

    // Credits used this session + estimated real money. Hide the $ estimate
    // with COPILOT_STATUSLINE_HIDE_USD=1.
    if (aiuNum != null) {
      const hideUsd = envFlag('COPILOT_STATUSLINE_HIDE_USD');
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
      writeLedger(home, s.session_id, {
        session_id: s.session_id,
        session_name: s.session_name || null,
        model: (s.model && (s.model.display_name || s.model.id)) || null,
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
        compaction_prompt_limit: comp.promptLimit,
        compaction_at: comp.compactAt,
        compaction_headroom: comp.compactHead,
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
      });
    }
  } catch (_) {
    // Never break the status line: emit whatever we have (possibly empty).
  }
  // Segments are already individually painted; write as-is.
  process.stdout.write(out);
  process.exit(0);
})();
