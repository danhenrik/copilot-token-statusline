#!/usr/bin/env node
'use strict';

/*
 * Uninstaller for the "token-statusline" custom status line.
 *
 * Reverts what install.js did, conservatively:
 *   - footer.showCustom -> false
 *   - removes statusLine only if its command points at our token-usage.js
 *   - deletes the installed <COPILOT_HOME>/statusline/token-usage.js
 *
 * It never deletes settings keys it doesn't recognise. A settings.json.bak is
 * written before changes.
 *
 * Usage: node uninstall.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const dryRun = process.argv.slice(2).some(function (a) {
  return a === '--dry-run' || a === '-n';
});

function log() {
  const a = Array.prototype.slice.call(arguments);
  console.log.apply(console, ['[token-statusline]'].concat(a));
}

const home = process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
const destScript = path.join(home, 'statusline', 'token-usage.js');
const settingsPath = path.join(home, 'settings.json');

if (fs.existsSync(settingsPath)) {
  let settings = {};
  const raw = fs.readFileSync(settingsPath, 'utf8').trim();
  if (raw) {
    try {
      settings = JSON.parse(raw);
    } catch (e) {
      log('WARNING: ' + settingsPath + ' is not valid JSON; leaving it untouched.');
      settings = null;
    }
  }
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    if (!dryRun) fs.copyFileSync(settingsPath, settingsPath + '.bak');

    if (settings.footer && typeof settings.footer === 'object') {
      settings.footer.showCustom = false;
    }
    const cmd = settings.statusLine && settings.statusLine.command;
    if (typeof cmd === 'string' && cmd.indexOf('token-usage.js') !== -1) {
      delete settings.statusLine;
      log('removed statusLine (pointed at token-usage.js)');
    } else if (cmd) {
      log('left statusLine in place (its command does not reference token-usage.js)');
    }

    const out = JSON.stringify(settings, null, 2) + '\n';
    if (dryRun) {
      log('DRY RUN — would write ' + settingsPath + ':\n' + out);
    } else {
      fs.writeFileSync(settingsPath, out, 'utf8');
      log('updated ' + settingsPath);
    }
  }
} else {
  log('no settings.json found at ' + settingsPath);
}

if (fs.existsSync(destScript)) {
  if (dryRun) log('DRY RUN — would delete ' + destScript);
  else {
    fs.unlinkSync(destScript);
    log('deleted ' + destScript);
  }
}

// remove the companion token-spike extension if it was installed
const extDir = path.join(home, 'extensions', 'token-spike');
for (const f of ['extension.mjs', 'spike-core.mjs']) {
  const p = path.join(extDir, f);
  if (fs.existsSync(p)) {
    if (dryRun) log('DRY RUN — would delete ' + p);
    else {
      fs.unlinkSync(p);
      log('deleted ' + p);
    }
  }
}
if (!dryRun && fs.existsSync(extDir)) {
  try {
    fs.rmdirSync(extDir);
    log('removed ' + extDir);
  } catch (_) {
    // directory not empty (user added files) -> leave it
  }
}

log('done. Restart Copilot CLI (/restart) to apply.');
