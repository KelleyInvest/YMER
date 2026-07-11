#!/usr/bin/env node
// build.js — assemble the single-file investor pitch.
//
// Takes the verified game in ../sims-lab (untouched), inlines its
// stylesheet and all ten modules into one HTML string, appends a small
// presentation shim (kiosk mode, telemetry, nav-key forwarding), and
// embeds the result into pitch/template.html as an iframe srcdoc string.
//
// Output: pitch/sticky-sims-pitch.html — no server, no network, no deps.
//
// Usage: node pitch/build.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GAME_DIR = path.join(ROOT, 'sims-lab');
const TEMPLATE = path.join(__dirname, 'template.html');
const OUT = path.join(__dirname, 'sticky-sims-pitch.html');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function mustReplace(haystack, needle, replacement, what) {
  if (!haystack.includes(needle)) {
    throw new Error('build: expected to find ' + what + ' — not found: ' + needle);
  }
  return haystack.replace(needle, replacement);
}

// ── 1. Assemble the game as one self-contained HTML document ──────────
let game = read(path.join(GAME_DIR, 'index.html'));

// Inline the stylesheet.
game = mustReplace(
  game,
  '<link rel="stylesheet" href="style.css" />',
  '<style>\n' + read(path.join(GAME_DIR, 'style.css')) + '\n</style>',
  'stylesheet link'
);

// Inline every module, preserving the load order index.html declares.
const scriptTags = game.match(/<script src="[^"]+\.js"><\/script>/g) || [];
if (scriptTags.length !== 10) {
  throw new Error('build: expected 10 module script tags, found ' + scriptTags.length);
}
for (const tag of scriptTags) {
  const file = tag.match(/src="([^"]+)"/)[1];
  const src = read(path.join(GAME_DIR, file));
  game = mustReplace(
    game,
    tag,
    '<script>\n/* ── ' + file + ' (inlined, unmodified) ── */\n' + src + '\n</script>',
    'module tag for ' + file
  );
}

// ── 2. Presentation shim — additive only; the game code is untouched ──
// shim.css restyles the runtime HUD ui.js builds (see file header for why);
// shim.js adds kiosk mode, click-to-select glue, nav-key forwarding, telemetry.
const shimCss = '<style>\n/* ── pitch shim styles (presentation only — pitch/shim.css) ── */\n'
  + read(path.join(__dirname, 'shim.css')) + '\n</style>';
const shimJs = '<script>\n' + read(path.join(__dirname, 'shim.js')) + '\n</script>';

game = mustReplace(game, '</head>', shimCss + '\n</head>', 'closing head tag');
game = mustReplace(game, '</body>', shimJs + '\n</body>', 'closing body tag');

// ── 3. Escape for embedding inside a <script> block ───────────────────
// JSON.stringify handles quotes/newlines/unicode. The three extra
// replacements neutralise sequences the HTML parser treats specially
// inside script data ("</", "<!--", "<script"); each backslash is an
// identity escape in a JS string, so the parsed value is unchanged.
const embedded = JSON.stringify(game)
  .replace(/<\//g, '<\\/')
  .replace(/<!--/g, '<\\!--')
  .replace(/<script/gi, '<\\script');

// ── 4. Inject into the template ───────────────────────────────────────
let out = read(TEMPLATE);
out = mustReplace(out, '"__GAME_SRC_PLACEHOLDER__"', embedded, 'GAME_SRC placeholder');

fs.writeFileSync(OUT, out);

const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log('built ' + path.relative(ROOT, OUT) + ' (' + kb + ' KB, game v1.1 inlined, zero external assets)');
