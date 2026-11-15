# PUBLISH: put reviewed translations into your project

Reads the review file and writes translated JSON files in the same shape as your English ones. The structure of the English (nesting, order, arrays, non-text values) is copied exactly; only the text values are replaced.

Set up the helper files first: see `generic-scripts-README.md`.

## Usage

Always look first with a dry run, which writes nothing:

```sh
node l10n-tools/publish.mjs --review review/de.json --source locales/en --out locales/de --dry-run
```

Then write the files:

```sh
node l10n-tools/publish.mjs --review review/de.json --source locales/en --out locales/de
```

| Option | Meaning |
|---|---|
| `--review` | Required. The review file you worked on in Translation Review. |
| `--source` | Required. The same English file or folder you gave `prepare.mjs`. It provides the structure. |
| `--out` | Required. Where to write. A file if the source is a file, a folder if the source is a folder. |
| `--only-approved` | Optional. Publish only strings you marked **approved**. Everything else keeps what is already in `--out`, or English if there is nothing there yet. Without this option, every string that has a translation goes live, whatever its status. |
| `--dry-run` | Optional. Check and report, write nothing. |

## What it checks

- If a translation uses different placeholders than the English (a missing or misspelled `{{name}}`), **nothing is written** and the script lists the strings to fix.
- Strings with no translation stay in English, and the script says how many.
- The summary tells you how many strings go live, and how many of those are flagged or not yet approved, so you can decide whether to continue.

## `publish.mjs`

```js
#!/usr/bin/env node
// Write reviewed translations from a Translation Review file back into your project's JSON files.
// Usage: node publish.mjs --review <review file> --source <en.json | en-folder> --out <file | folder>
//                         [--only-approved] [--dry-run]
// The structure of your English files is copied exactly (nesting, order, arrays, non-text values);
// only the text values are replaced with the translations.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { listSource, parseArgs, readJson, samePlaceholders } from './common.mjs';

const args = parseArgs(process.argv.slice(2), ['only-approved', 'dry-run']);
if (!args.review || !args.source || !args.out) {
  console.error('Usage: node publish.mjs --review <review file> --source <en.json | en-folder> --out <file | folder> [--only-approved] [--dry-run]');
  process.exit(1);
}

const review = readJson(args.review);
const byKey = new Map((review.entries ?? []).map((e) => [e.key, e]));
const sources = listSource(args.source);
const isFolder = sources.length > 0 && sources[0].ns !== '';

const errors = [];
const stats = { live: 0, english: 0, notApproved: 0, flagged: 0 };

/** Copies the English structure, replacing every text value with its translation. */
function translate(node, ns, path, existing) {
  if (typeof node === 'string') {
    const key = ns ? `${ns}:${path}` : path;
    const e = byKey.get(key);
    const old = typeof existing === 'string' ? existing : undefined;
    if (!e) return old ?? node; // not in the review file: keep what is there
    if (e.target && !samePlaceholders(e.source, e.target)) errors.push(`${key}: the translation's placeholders don't match the English`);
    if (args['only-approved'] && e.status !== 'approved') return old ?? node;
    if (!e.target) { stats.english++; return old ?? node; }
    stats.live++;
    if (e.status === 'flagged') stats.flagged++;
    else if (e.status !== 'approved') stats.notApproved++;
    return e.target;
  }
  if (Array.isArray(node)) return node.map((x, i) => translate(x, ns, path ? `${path}.${i}` : String(i), existing?.[i]));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, x]) => [k, translate(x, ns, path ? `${path}.${k}` : k, existing?.[k])]));
  }
  return node; // numbers, booleans, null stay as they are
}

const outputs = sources.map(({ ns, file }) => {
  const dest = isFolder ? join(args.out, `${ns}.json`) : args.out;
  const existing = existsSync(dest) ? readJson(dest) : undefined;
  return { dest, text: JSON.stringify(translate(readJson(file), ns, '', existing), null, 2) + '\n' };
});

if (errors.length) {
  console.error(`Nothing was written. ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('Fix them in Translation Review (or in the file) and run this again.');
  process.exit(1);
}
console.log(`${stats.live} strings go live (${stats.flagged} flagged, ${stats.notApproved} not yet approved), ${stats.english} have no translation and stay in English.`);
if (args['dry-run']) {
  console.log('Dry run: nothing was written.');
} else {
  for (const { dest, text } of outputs) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
    console.log(`Wrote ${dest}`);
  }
}
```
