# Using Translation Review with your own project

Translation Review is only the **review** step. It opens a JSON file in a fixed format and saves your edits and approvals back into it. To use it on your own project you need two more steps around it:

```
your English JSON files
        │   PREPARE   (PREPARE.md)
        ▼
review/<lang>.json   ←→   Translation Review app   (edit, approve, flag)
        │   PUBLISH   (PUBLISH.md)
        ▼
your translated JSON files
```

The two scripts in this folder are generic: they work on ordinary JSON i18n files and have **no dependencies**. You need Node 20 or newer.

## Setup

1. Make a folder in your project, for example `l10n-tools/`.
2. Save the three code blocks as files in it:
   - `common.mjs` (below)
   - `prepare.mjs` (from `PREPARE.md`)
   - `publish.mjs` (from `PUBLISH.md`)
3. Run the commands in `PREPARE.md` and `PUBLISH.md` from your project folder.

## What your files should look like

Either of these works:

| Your project | `--source` points to | Keys in the review file |
|---|---|---|
| One English file, e.g. `locales/en.json` | that file | `home.title` |
| A folder of English files, one per section, e.g. `locales/en/home.json`, `locales/en/footer.json` | the folder | `home:title` (file name, a colon, then the path) |

- Nested objects and arrays are fine. Only **text values** are reviewed; numbers, booleans and so on are copied through untouched.
- Placeholders written like `{{name}}` are checked: a translation must use the same ones as the English. If your project writes them differently (for example `{name}` with single braces), change the `PLACEHOLDER` line in `common.mjs`.
- The review file always names `en` as the source language. The app doesn't check it, so a different source language still opens, but the label stays `en`.

## Getting the first translations into the file

Neither script translates. `prepare.mjs` creates the file with empty translations. You have three ways to fill them:

- **Type them in** the Translation Review app, one string at a time.
- **Seed from translations you already have** with `--translations` (see `PREPARE.md`).
- **Let an AI or machine translation draft them.** Give the review file to whatever you like, with your style guide, and ask it to fill each `target` (or to put three candidates in each `options` list, which the app shows as A, B, C to choose from). Never let it change `key`, `source` or `placeholders`. Then review everything in the app.

## The file format in short

```json
{
  "format": "translation-review/3",
  "sourceLanguage": "en",
  "targetLanguage": "de",
  "entries": [
    {
      "key": "home:title",
      "source": "Welcome, {{name}}",
      "target": "",
      "placeholders": ["name"]
    }
  ]
}
```

Optional per entry: `status` (`approved` or `flagged`; none means "to review"), `note` (context for the translator), `options` (up to three suggested translations), `previousSource` (the old English, set automatically when the English changes). The full definition is `schema/translation-review.schema.json`.

## `common.mjs`

Shared helpers used by both scripts.

```js
// Shared helpers for prepare.mjs and publish.mjs. Put this file next to them.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export const FORMAT = 'translation-review/3';

export function parseArgs(argv, flags = []) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const name = a.slice(2);
    if (flags.includes(name)) out[name] = true;
    else {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`--${name} needs a value`);
      out[name] = v;
    }
  }
  return out;
}

export const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`Can't read ${p} as JSON: ${e.message}`);
  }
};

/** A source is one JSON file (keys like "home.title") or a folder of JSON files (keys like "home:title", the file name is the namespace). */
export function listSource(p) {
  if (!existsSync(p)) throw new Error(`Can't find ${p}`);
  if (statSync(p).isDirectory()) {
    return readdirSync(p)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => ({ ns: basename(f, '.json'), file: join(p, f) }));
  }
  return [{ ns: '', file: p }];
}

/** { a: { b: 'x' }, list: ['y'] }  ->  Map { 'a.b' => 'x', 'list.0' => 'y' }. Only text values are kept. */
export function flatten(obj, ns = '') {
  const out = new Map();
  const walk = (v, path) => {
    if (typeof v === 'string') out.set(ns ? `${ns}:${path}` : path, v);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, path ? `${path}.${i}` : String(i)));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(obj, '');
  return out;
}

/** Placeholders like {{name}} (i18next style). Change the pattern here if your project uses another style, e.g. /\{(\w+)\}/g. */
export const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;
export const placeholders = (s) => [...new Set([...s.matchAll(PLACEHOLDER)].map((m) => m[1]))];
export const samePlaceholders = (a, b) => {
  const x = placeholders(a).sort().join('|');
  const y = placeholders(b).sort().join('|');
  return x === y;
};

/** Same field order and layout every time, so saving only changes what was edited. */
export function serialize(file) {
  const entries = file.entries.map((e) => {
    const o = { key: e.key, source: e.source };
    if (e.previousSource !== undefined) o.previousSource = e.previousSource;
    o.target = e.target;
    if (e.options?.length) o.options = e.options;
    if (e.note) o.note = e.note;
    o.placeholders = e.placeholders;
    if (e.status) o.status = e.status;
    return o;
  });
  return JSON.stringify({ ...file, entries }, null, 2) + '\n';
}
```
