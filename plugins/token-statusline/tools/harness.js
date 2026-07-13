'use strict';

// Shared test harness: runs the status-line entry point against a case in an
// isolated COPILOT_HOME and returns its stdout + (normalized) ledger. Used by
// both the test runner (test/statusline.test.js) and the golden generator
// (tools/generate-goldens.js) so they stay in lockstep.
//
// This file lives OUTSIDE test/ on purpose: `node --test` auto-runs every file
// under a test/ directory in its own child process, which would execute helper
// and generator scripts as if invoked directly. Keeping them in tools/ means
// only *.test.js is ever discovered.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PLUGIN_DIR = path.resolve(__dirname, '..');
const TEST_DIR = path.join(PLUGIN_DIR, 'test');
const SCRIPT = path.join(PLUGIN_DIR, 'token-usage.js');
const GOLDEN_DIR = path.join(TEST_DIR, 'golden');
const CASES_FILE = path.join(TEST_DIR, 'cases.json');

function loadCases() {
  return JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
}

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sl-test-'));
}

function safeId(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '_');
}

// Run one case and return { stdout, ledger }. `ledger` is the parsed per-session
// record with the non-deterministic `updated_at` removed, or null when the case
// has no session_id / wrote no ledger.
function runCase(home, c) {
  fs.mkdirSync(home, { recursive: true });

  // Spike cases need a fresh tool-activity file (at = now, so it's in-window
  // regardless of when the test runs).
  if (c.spike && c.payload.session_id) {
    const dir = path.join(home, 'statusline', 'tool-activity');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, safeId(c.payload.session_id) + '.json'),
      JSON.stringify({ spike: Object.assign({ at: Date.now() }, c.spike) })
    );
  }

  // Hermetic env: strip anything that could perturb rendering (inherited
  // NO_COLOR, COPILOT_HOME, or any COPILOT_STATUSLINE_* from the dev's shell),
  // then apply only the case's declared env.
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'NO_COLOR' || k === 'COPILOT_HOME' || k.startsWith('COPILOT_STATUSLINE')) {
      continue;
    }
    env[k] = v;
  }
  env.COPILOT_HOME = home;
  Object.assign(env, c.env || {});

  let stdout;
  try {
    stdout = execFileSync(process.execPath, [SCRIPT], {
      input: JSON.stringify(c.payload),
      env,
      encoding: 'utf8',
    });
  } catch (e) {
    stdout = 'ERR:' + (e.stderr || e.message);
  }

  let ledger = null;
  if (c.payload.session_id) {
    const f = path.join(home, 'statusline', 'sessions', safeId(c.payload.session_id) + '.json');
    if (fs.existsSync(f)) {
      ledger = JSON.parse(fs.readFileSync(f, 'utf8'));
      delete ledger.updated_at; // non-deterministic timestamp
    }
  }
  return { stdout, ledger };
}

module.exports = { SCRIPT, GOLDEN_DIR, loadCases, freshHome, runCase };
