'use strict';

const fs = require('fs');
const path = require('path');

// Persist a per-session ledger record to
// <COPILOT_HOME>/statusline/sessions/<session_id>.json, written atomically
// (temp file + rename) so a concurrent reader never sees a half-written file.
function writeLedger(home, sessionId, rec) {
  const dir = path.join(home, 'statusline', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  const safeId = String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_');
  const file = path.join(dir, `${safeId}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { writeLedger };
