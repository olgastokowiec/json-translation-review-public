# PREPARE: create or refresh the review file

Reads your English JSON and creates `review/<lang>.json`, ready to open in Translation Review. Run it again any time the English changes.

Set up the helper files first: see `generic-scripts-README.md`.

## Usage

```sh
node l10n-tools/prepare.mjs --source locales/en --lang de
```

| Option | Meaning |
|---|---|
| `--source` | Required. Your English file, or a folder of English files. |
| `--lang` | Required. The language code, e.g. `de`. |
| `--translations` | Optional. Your existing translations (a file or folder in the same shape as the source). They fill in strings that have no translation in the review file yet. |
| `--out` | Optional. Where to write the review file. Default: `review/<lang>.json`. |
| `--notes` | Optional. A JSON file of notes for translators: `{ "home.title": "Shown in the browser tab" }`. Notes appear in the app. |
| `--guidelines` | Optional. A text recorded in the file (for example the path of your style guide). The app doesn't read it. It's there for people and AI agents working on the file. |

## What it does when you run it again

- **Keeps** your edits, review statuses and suggested options for every string whose English hasn't changed.
- **English changed:** the string goes back to "to review", and the old English is stored in `previousSource`, so the app shows old and new side by side.
- **New strings** arrive with an empty translation.
- **Removed strings** are dropped from the review file.
- Once every string is approved, leftover `options` are cleaned out.

It prints how many strings are new, changed or removed, and how many still need work.

## `prepare.mjs`

```js
#!/usr/bin/env node
// Prepare a translation file for the Translation Review app.
// Usage: node prepare.mjs --source <en.json | en-folder> --lang <code> [--translations <file | folder>]
//                         [--out <review file>] [--notes <notes.json>] [--guidelines <path or text>]
// Safe to run again any time: edits, statuses and options in the existing review file are kept.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FORMAT, flatten, listSource, parseArgs, placeholders, readJson, serialize } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.source || !args.lang) {
  console.error('Usage: node prepare.mjs --source <en.json | en-folder> --lang <code> [--translations <file | folder>] [--out <file>] [--notes <notes.json>] [--guidelines <text>]');
  process.exit(1);
}
const out = args.out ?? join('review', `${args.lang}.json`);

// 1. The English strings, in file order.
const english = new Map();
for (const { ns, file } of listSource(args.source)) for (const [k, v] of flatten(readJson(file), ns)) english.set(k, v);

// 2. Translations that already exist in your project (optional). They seed new entries.
const existingTranslations = new Map();
if (args.translations && existsSync(args.translations)) {
  for (const { ns, file } of listSource(args.translations)) for (const [k, v] of flatten(readJson(file), ns)) existingTranslations.set(k, v);
}

// 3. Notes for translators (optional): { "home.title": "Shown in the browser tab" }
const notes = args.notes ? readJson(args.notes) : {};

// 4. The review file from last time (optional). Work in it is never overwritten.
const previous = new Map();
if (existsSync(out)) for (const e of readJson(out).entries ?? []) previous.set(e.key, e);

const report = { total: 0, added: 0, englishChanged: 0, removed: 0, translated: 0 };
const entries = [...english].map(([key, source]) => {
  const prev = previous.get(key);
  const seeded = existingTranslations.get(key);
  const target = prev?.target || (seeded && seeded !== source ? seeded : ''); // English used as a fallback doesn't count as a translation
  let status = prev?.status;
  let previousSource = prev?.previousSource;
  if (!prev) report.added++;
  else if (prev.source !== source) {
    report.englishChanged++;
    status = undefined; // the English changed: it needs another look
    if (target) previousSource ??= prev.source; // keep the old English so the app can show the difference
  }
  if (previousSource === source) previousSource = undefined; // the English went back to what was reviewed
  const options = prev && prev.source === source ? prev.options : undefined;
  if (target) report.translated++;
  return { key, source, previousSource, target, options, note: notes[key], placeholders: placeholders(source), status };
});
report.total = entries.length;
report.removed = [...previous.keys()].filter((k) => !english.has(k)).length;
if (entries.length && entries.every((e) => e.status === 'approved')) for (const e of entries) delete e.options;

const file = { format: FORMAT, sourceLanguage: 'en', targetLanguage: args.lang, ...(args.guidelines ? { guidelines: args.guidelines } : {}), entries };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, serialize(file));

const needWork = entries.filter((e) => !e.status && !e.options?.length).length;
console.log(`Wrote ${out}`);
console.log(`${report.total} strings: ${report.added} new, ${report.englishChanged} with changed English, ${report.removed} removed, ${report.translated} already have a translation.`);
console.log(`${needWork} strings are still waiting for a translation or review. Open ${out} in Translation Review.`);
```
