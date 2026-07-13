'use strict';

// Golden regression tests for the status line. Each case in cases.json is run
// against the real entry point in an isolated COPILOT_HOME; its stdout and
// per-session ledger are compared byte-for-byte against the checked-in goldens
// in test/golden/. Regenerate goldens after an INTENTIONAL behavior change with:
//   node tools/generate-goldens.js        (or: npm run test:update)
//
// Run with:  node --test test/statusline.test.js   (or: npm test)

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadCases, freshHome, runCase, GOLDEN_DIR } = require('../tools/harness');

for (const c of loadCases()) {
  test(c.name, () => {
    const outFile = path.join(GOLDEN_DIR, c.name + '.out');
    const ledgerFile = path.join(GOLDEN_DIR, c.name + '.ledger.json');
    assert.ok(
      fs.existsSync(outFile),
      'missing golden for "' + c.name + '" — run: node tools/generate-goldens.js'
    );

    const { stdout, ledger } = runCase(freshHome(), c);

    assert.strictEqual(
      stdout,
      fs.readFileSync(outFile, 'utf8'),
      'stdout mismatch for "' + c.name + '"'
    );

    const goldenLedger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    assert.deepStrictEqual(
      ledger,
      goldenLedger,
      'ledger mismatch for "' + c.name + '"'
    );
  });
}
