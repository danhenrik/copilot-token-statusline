#!/usr/bin/env node
'use strict';

/*
 * Installer for the "token-statusline" Copilot CLI custom status line.
 *
 * Cross-platform (pure Node — no jq/PowerShell modules needed). It:
 *   1. Copies token-usage.js and its lib/ modules (bundled next to this
 *      installer) into <COPILOT_HOME>/statusline/
 *   2. Wires it into <COPILOT_HOME>/settings.json:
 *        statusLine.type    = "command"
 *        statusLine.command = node "<installed script path>"
 *        statusLine.padding = 2   (only if not already set)
 *        footer.showCustom  = true
 *   3. Backs up settings.json to settings.json.bak before writing.
 *
 * COPILOT_HOME defaults to <home>/.copilot (matches the status-line script).
 *
 * Usage:
 *   node install.js [options]
 * Options:
 *   --hide-builtin-context   also set footer.showContextWindow = false
 *                            (avoids showing context usage twice)
 *   --hide-builtin-aiused    also set footer.showAiUsed = false
 *   --dry-run, -n            print what would change, write nothing
 *   --help, -h               show this help
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const argv = process.argv.slice(2);
const args = new Set(argv);
if (args.has('--help') || args.has('-h')) {
  console.log(
    [
      'Install the token-statusline custom status line for Copilot CLI.',
      '',
      'Usage: node install.js [--hide-builtin-context] [--hide-builtin-aiused] [--dry-run]',
      '',
      '  --hide-builtin-context   set footer.showContextWindow=false (avoid double context)',
      '  --hide-builtin-aiused    set footer.showAiUsed=false',
      '  --with-spike-extension   also install the token-spike extension (an',
      '                           onPostToolUse hook that flags big tool outputs)',
      '  --dry-run, -n            show changes without writing',
      '  --help, -h               this help',
    ].join('\n')
  );
  process.exit(0);
}

const dryRun = args.has('--dry-run') || args.has('-n');
const hideCtx = args.has('--hide-builtin-context');
const hideAiu = args.has('--hide-builtin-aiused');
const withSpike = args.has('--with-spike-extension');

function log() {
  const a = Array.prototype.slice.call(arguments);
  console.log.apply(console, ['[token-statusline]'].concat(a));
}
function die(msg) {
  console.error('[token-statusline] ERROR: ' + msg);
  process.exit(1);
}

const home = process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
const statusDir = path.join(home, 'statusline');
const destScript = path.join(statusDir, 'token-usage.js');
const srcScript = path.join(__dirname, 'token-usage.js');
const destLib = path.join(statusDir, 'lib');
const srcLib = path.join(__dirname, 'lib');
const settingsPath = path.join(home, 'settings.json');

// 1) locate bundled script + its lib/ modules
if (!fs.existsSync(srcScript)) {
  die('cannot find bundled token-usage.js next to this installer (' + srcScript + ').');
}
if (!fs.existsSync(srcLib)) {
  die('cannot find bundled lib/ modules next to this installer (' + srcLib + ').');
}

// 2) load + validate existing settings before touching anything
let settings = {};
if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, 'utf8').trim();
  if (raw) {
    try {
      settings = JSON.parse(raw);
    } catch (e) {
      die(
        settingsPath +
          ' is not valid JSON (' +
          e.message +
          '). Fix or remove it, then re-run. Nothing was changed.'
      );
    }
  }
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    die(settingsPath + ' does not contain a JSON object. Nothing was changed.');
  }
}

// 3) copy the status-line script + its lib/ modules. The entry point
// require()s ./lib/* relative to itself, so the modules must ship alongside it.
// lib/ is replaced wholesale so a stale module from a prior version can't linger.
if (dryRun) {
  log('DRY RUN — would copy\n    ' + srcScript + '\n  ->' + destScript);
  log('DRY RUN — would copy lib/ modules\n    ' + srcLib + '\n  ->' + destLib);
} else {
  fs.mkdirSync(statusDir, { recursive: true });
  fs.copyFileSync(srcScript, destScript);
  fs.rmSync(destLib, { recursive: true, force: true });
  fs.cpSync(srcLib, destLib, { recursive: true });
  log('copied status-line script -> ' + destScript);
  log('copied lib/ modules -> ' + destLib);
}

// 4) back up settings
if (!dryRun && fs.existsSync(settingsPath)) {
  const bak = settingsPath + '.bak';
  fs.copyFileSync(settingsPath, bak);
  log('backed up settings -> ' + bak);
}

// 4b) optionally install the companion token-spike extension. It runs an
// onPostToolUse hook on every successful tool call, so it's opt-in: it records
// large tool outputs to <COPILOT_HOME>/statusline/tool-activity/<session>.json,
// which the status line reads to show a transient "spike" marker.
const extDestDir = path.join(home, 'extensions', 'token-spike');
if (withSpike) {
  const extSrcDir = path.join(__dirname, 'extensions', 'token-spike');
  const extFiles = ['extension.mjs', 'spike-core.mjs'];
  const missing = extFiles.filter((f) => !fs.existsSync(path.join(extSrcDir, f)));
  if (missing.length) {
    die('cannot find bundled extension file(s): ' + missing.join(', ') + ' in ' + extSrcDir);
  }
  if (dryRun) {
    log('DRY RUN — would install token-spike extension ->\n    ' + extDestDir);
  } else {
    fs.mkdirSync(extDestDir, { recursive: true });
    for (const f of extFiles) {
      fs.copyFileSync(path.join(extSrcDir, f), path.join(extDestDir, f));
    }
    log('installed token-spike extension -> ' + extDestDir);
  }
}

// 5) patch settings (preserves all existing keys)
const nodeCmd = 'node "' + destScript + '"';
if (typeof settings.statusLine !== 'object' || settings.statusLine === null) {
  settings.statusLine = {};
}
settings.statusLine.type = 'command';
settings.statusLine.command = nodeCmd;
if (settings.statusLine.padding == null) settings.statusLine.padding = 2;

if (typeof settings.footer !== 'object' || settings.footer === null) {
  settings.footer = {};
}
settings.footer.showCustom = true;
if (hideCtx) settings.footer.showContextWindow = false;
if (hideAiu) settings.footer.showAiUsed = false;

const out = JSON.stringify(settings, null, 2) + '\n';

// 6) write
if (dryRun) {
  log('DRY RUN — would write ' + settingsPath + ':\n' + out);
} else {
  fs.writeFileSync(settingsPath, out, 'utf8');
  log('updated ' + settingsPath);
}

log('done. Restart Copilot CLI (/restart) to load the status line.');
if (withSpike) {
  log(
    'token-spike installed: run /clear (or reload extensions) so the hook loads. ' +
      'Tune it with COPILOT_STATUSLINE_SPIKE_TOKENS / COPILOT_STATUSLINE_SPIKE_WINDOW_MS; ' +
      'hide the marker with COPILOT_STATUSLINE_HIDE_SPIKE=1.'
  );
} else {
  log(
    'tip: the "spike" marker (flags big tool outputs) needs the companion ' +
      'extension — re-run with --with-spike-extension to enable it.'
  );
}
if (!hideCtx) {
  log(
    'tip: the built-in footer also shows context usage. Re-run with ' +
      '--hide-builtin-context (or set footer.showContextWindow=false) to avoid showing it twice.'
  );
}
