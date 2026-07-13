'use strict';

const fs = require('fs');
const path = require('path');
const { envFlag } = require('./format');

// Optional capture of the raw stdin payload the CLI sends, so real payloads can
// be snapshotted as test fixtures. Both triggers are no-ops when absent and can
// never affect the status line (all failures swallowed). Nothing is captured by
// default.
//
//   * COPILOT_STATUSLINE_DEBUG_DUMP=<file>  — write EVERY render's raw payload to
//     <file>. Set it to 1/true/on/yes to use the default
//     <COPILOT_HOME>/statusline/debug/payload.json. Requires (re)launching the
//     CLI with the env var set, since the status-line command inherits the CLI's
//     environment.
//   * <COPILOT_HOME>/statusline/debug/capture-next  — a one-shot marker file:
//     when present, the NEXT render writes its raw payload to
//     <COPILOT_HOME>/statusline/debug/payload-<timestamp>.json and deletes the
//     marker. Lets you capture from an already-running CLI (no relaunch/env).
function dumpPayload(home, raw) {
  try {
    const debugDir = path.join(home, 'statusline', 'debug');
    const env = process.env.COPILOT_STATUSLINE_DEBUG_DUMP;
    if (env) {
      const target = envFlag('COPILOT_STATUSLINE_DEBUG_DUMP')
        ? path.join(debugDir, 'payload.json')
        : env;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, raw);
    }
    const marker = path.join(debugDir, 'capture-next');
    if (fs.existsSync(marker)) {
      fs.mkdirSync(debugDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(debugDir, `payload-${ts}.json`), raw);
      fs.rmSync(marker, { force: true });
    }
  } catch (_) {
    // Debug capture must never affect the status line.
  }
}

module.exports = { dumpPayload };
