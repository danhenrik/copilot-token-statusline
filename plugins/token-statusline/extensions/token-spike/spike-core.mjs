// spike-core: pure, testable logic for the token-spike extension.
//
// It measures how many tokens a successful tool result adds to the context and
// records it to a small per-session ledger that the token-usage.js status line
// reads. Kept SDK-free so it can be unit-tested without a live CLI session.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
const ACT_DIR = path.join(HOME, 'statusline', 'tool-activity');
const MAX_HISTORY = 50;

// A tool result at/above this many (approx) tokens is a "spike" worth flagging.
// Tool outputs are the #1 source of context bloat. Note: Copilot CLI truncates
// very large tool results to a short preview (offloading the full text to a temp
// file), so a single result contributes at most ~5-7k tokens to the context
// before that kicks in — anything bigger doesn't actually bloat the window. The
// 4000 default sits in the "large but still fully in-context" band, flagging the
// genuinely heavy results without firing on routine ones. Tunable.
export function spikeThreshold() {
  const v = parseInt(process.env.COPILOT_STATUSLINE_SPIKE_TOKENS || '', 10);
  return Number.isFinite(v) && v > 0 ? v : 4000;
}

// Rough chars/4 heuristic — good enough to spot a big strike, not billing-grade.
function approxTokens(str) {
  return str ? Math.ceil(str.length / 4) : 0;
}

// Estimate the token footprint a tool result adds to the model's context.
export function measureToolResult(toolResult) {
  let text = '';
  let images = 0;
  if (typeof toolResult === 'string') {
    text = toolResult;
  } else if (toolResult && typeof toolResult === 'object') {
    if (typeof toolResult.textResultForLlm === 'string') text = toolResult.textResultForLlm;
    if (Array.isArray(toolResult.binaryResultsForLlm)) images = toolResult.binaryResultsForLlm.length;
  }
  // Images are hard to size precisely; charge a flat ~1k tokens each as a proxy.
  return { tokens: approxTokens(text) + images * 1000, chars: text.length, images };
}

function safeId(id) {
  return String(id || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');
}

// Record one successful tool use into the per-session activity ledger and flag
// spikes. Fully defensive: any failure is swallowed so a hook can never disturb
// the session.
export function recordToolUse(input, invocation, now = Date.now()) {
  try {
    const sessionId = (invocation && invocation.sessionId) || 'unknown';
    const toolName = (input && input.toolName) || 'tool';
    const m = measureToolResult(input && input.toolResult);
    const file = path.join(ACT_DIR, `${safeId(sessionId)}.json`);

    let rec = null;
    try {
      rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      rec = null;
    }
    if (!rec || typeof rec !== 'object') rec = {};
    if (!Array.isArray(rec.events)) rec.events = [];

    const ev = { tool: toolName, tokens: m.tokens, chars: m.chars, images: m.images, at: now };
    rec.session_id = sessionId;
    rec.events.push(ev);
    if (rec.events.length > MAX_HISTORY) rec.events = rec.events.slice(-MAX_HISTORY);
    rec.session_tool_tokens = (rec.session_tool_tokens || 0) + m.tokens;
    rec.last = ev;
    rec.spike_threshold = spikeThreshold();
    if (m.tokens >= rec.spike_threshold) rec.spike = ev; // most recent spike wins
    rec.updated_at = new Date(now).toISOString();

    fs.mkdirSync(ACT_DIR, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
    fs.renameSync(tmp, file);
    return rec;
  } catch {
    return null;
  }
}
