'use strict';

// Regenerate the golden files in test/golden/ from the current status-line
// behavior. Run this ONLY after an intentional change to the rendered output or
// ledger, then review the golden diff before committing.
//
//   node tools/generate-goldens.js     (or: npm run test:update)
//
// This lives in tools/ (not test/) so `node --test` never discovers it: the
// test runner executes every file under test/ in its own child process, which
// would run this generator and silently overwrite the goldens.

const fs = require('fs');
const path = require('path');
const { loadCases, freshHome, runCase, GOLDEN_DIR } = require('./harness');

function main() {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  const cases = loadCases();
  for (const c of cases) {
    const { stdout, ledger } = runCase(freshHome(), c);
    fs.writeFileSync(path.join(GOLDEN_DIR, c.name + '.out'), stdout);
    fs.writeFileSync(
      path.join(GOLDEN_DIR, c.name + '.ledger.json'),
      JSON.stringify(ledger, null, 2) + '\n'
    );
  }
  console.log('Regenerated goldens for ' + cases.length + ' case(s) in ' + GOLDEN_DIR);
}

if (require.main === module) main();
