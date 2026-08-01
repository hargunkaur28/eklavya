// Which components are actually bilingual, and which only look it.
//
// Written because "no Hindi in the admin panel" is easy to observe and hard to scope:
// the parent panel turned out to be fully translated while the admin panel had no
// i18n wiring at all, and eyeballing components cannot tell those apart reliably.
// A component that imports translations but references a key missing from `hi` renders
// BLANK for a Hindi user, which looks like a layout bug rather than a translation gap.
//
//   node i18n-coverage.mjs            # every component
//   node i18n-coverage.mjs Admin      # only components whose name matches
import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');
const filter = process.argv[2] || '';

const raw = fs.readFileSync(path.join(SRC, 'data', 'translations.js'), 'utf8');
const lines = raw.split('\n');
const hiStart = lines.findIndex((l) => /^\s{2}hi:\s*\{/.test(l));
if (hiStart < 0) { console.error('Could not find the hi: section.'); process.exit(1); }

// Keys are collected per language half. Nested namespaces are flattened to bare key
// names: a duplicate name across namespaces is far less likely than a missed key, and
// this check exists to catch the missing ones.
// Matches EVERY `key:` on a line, not just the first. The line-anchored version of
// this reported 13 keys as missing from Hindi that were present — the file packs
// short keys together (`hShort: 'h', mShort: 'm', sShort: 's',`) and only the first
// was ever seen. A coverage tool that under-reports coverage sends you off fixing
// things that are not broken, which is worse than not having the tool.
const collect = (text) => {
  const s = new Set();
  // Both alternatives matter: `^\s*` for the usual one-key-per-line form, and
  // `[{,]\s*` for keys packed onto a shared line. Dropping the `\s*` after `^` while
  // adding the second case silently reintroduced the same class of false positive on
  // every indented key — which is the entire file.
  for (const m of text.matchAll(/(?:^\s*|[{,]\s*)([a-zA-Z][a-zA-Z0-9_]*)\s*:/gm)) s.add(m[1]);
  return s;
};
const enKeys = collect(lines.slice(0, hiStart).join('\n'));
const hiKeys = collect(lines.slice(hiStart).join('\n'));

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : (p.endsWith('.jsx') ? [p] : []);
});

const rows = [];
for (const file of walk(path.join(SRC, 'components'))) {
  const name = path.basename(file);
  if (filter && !name.toLowerCase().includes(filter.toLowerCase())) continue;
  const src = fs.readFileSync(file, 'utf8');

  const used = new Set();
  for (const m of src.matchAll(/\bt\.([a-zA-Z][a-zA-Z0-9_]*)/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) used.add(m[1].split('.').pop());

  const wired = /useLanguage|translations/.test(src);
  // Hardcoded UI text: a capitalised word inside JSX, or a label/placeholder literal.
  // Deliberately rough — it is a scope signal, not a lint rule.
  const hardcoded = (src.match(/>\s*[A-Z][a-z]+(?:\s+[a-z]+)+\s*</g) || []).length
    + (src.match(/(?:label|placeholder|title):\s*['"][A-Z]/g) || []).length;

  const missingHi = [...used].filter((k) => !hiKeys.has(k));
  rows.push({ name, wired, used: used.size, missingHi, hardcoded });
}

rows.sort((a, b) => (a.wired === b.wired ? b.hardcoded - a.hardcoded : a.wired ? 1 : -1));

let broken = 0;
console.log('\nComponent                        i18n  keys  missing-hi  hardcoded');
console.log('─'.repeat(74));
for (const r of rows) {
  if (!r.wired && r.hardcoded === 0 && r.used === 0) continue;   // nothing user-facing
  const flag = !r.wired && r.hardcoded > 0 ? 'NONE' : r.missingHi.length ? 'GAP ' : 'ok  ';
  if (flag !== 'ok  ') broken++;
  console.log(
    `${r.name.padEnd(32)} ${flag}  ${String(r.used).padStart(4)}  ${String(r.missingHi.length).padStart(10)}  ${String(r.hardcoded).padStart(9)}`
  );
  if (r.missingHi.length) console.log(`     missing: ${r.missingHi.join(', ')}`);
}
console.log('─'.repeat(74));
console.log(`${broken} component(s) need attention.  (en keys: ${enKeys.size}, hi keys: ${hiKeys.size})\n`);
