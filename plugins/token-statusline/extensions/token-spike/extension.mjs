// token-spike — a Copilot CLI extension that observes successful tool results
// and records big "output strikes" (the #1 source of context bloat) to
// <COPILOT_HOME>/statusline/tool-activity/<sessionId>.json.
//
// The token-usage.js status line reads that file and shows a transient marker
// like "⤒ powershell 42k" right after a large tool output lands, so you can
// notice (and clear) the bloat before it degrades the context.
//
// This is the "analysis" half of the two-layer design: the status line can only
// see aggregate context size, never individual tool outputs — but an onPostToolUse
// hook receives the full tool result, so it can size each one. The two halves
// communicate through the shared activity file.
//
// Install: place this directory at ~/.copilot/extensions/token-spike/ (user) or
// .github/extensions/token-spike/ (project), then run `/clear` or reload extensions.
import { joinSession } from '@github/copilot-sdk/extension';
import { recordToolUse } from './spike-core.mjs';

// Captured from the session object as a fallback in case a future runtime
// stops passing invocation.sessionId to the hook.
let sessionId;
const session = await joinSession({
  hooks: {
    // Pure observation — we never modify the tool result (return nothing).
    onPostToolUse: async (input, invocation) => {
      recordToolUse(input, {
        sessionId: (invocation && invocation.sessionId) || sessionId,
      });
    },
  },
});
sessionId = session.sessionId;
