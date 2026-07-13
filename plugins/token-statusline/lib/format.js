'use strict';

// Small, dependency-free helpers shared across the status-line modules:
// stdin reading, compact number formatting, and env-flag parsing.

// Read the full JSON "status object" the CLI pipes to us on stdin.
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

// Compact human token count: 1.2M / 8.5k / 512.
function fmt(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

// Truthy env flag: 1 / true / yes / on (case-insensitive). Used by every
// COPILOT_STATUSLINE_HIDE_* / _NO_GRADIENT toggle so they parse identically.
function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(process.env[name] || '');
}

module.exports = { readStdin, fmt, envFlag };
