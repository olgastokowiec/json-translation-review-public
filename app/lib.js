/**
 * The review app's logic, with no screen code, so it can be tested on its own (npm test).
 * Loaded as a plain script by index.html (window.TR) and with require() by the tests.
 * The file format is described in schema/translation-review.schema.json.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TR = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FORMAT = 'translation-review/3';
  /** Older files (no review status, or no options) still open; they are saved as version 3. */
  const ACCEPTED_FORMATS = ['translation-review/1', 'translation-review/2', FORMAT];
  const STATUSES = ['approved', 'flagged'];
  const ROUTE_WORD = /^[a-z0-9-]*$/;

  /** Sorted unique placeholder names: '{{b}} {{a}}' gives ['a', 'b']. Same rule as the prepare and publish scripts. */
  function placeholders(text) {
    const names = new Set();
    for (const m of String(text).matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)) names.add(m[1]);
    return [...names].sort();
  }

  const samePlaceholders = (a, b) => placeholders(a).join('|') === placeholders(b).join('|');

  /** Fixed field order, the same as the prepare and publish scripts write, so changes show up cleanly. */
  function normalizeEntry(e) {
    const out = { key: e.key, source: e.source };
    if (e.previousSource !== undefined) out.previousSource = e.previousSource;
    out.target = e.target;
    if (Array.isArray(e.options) && e.options.length) out.options = e.options;
    if (e.note) out.note = e.note;
    out.placeholders = Array.isArray(e.placeholders) ? e.placeholders : placeholders(e.source);
    if (e.status) out.status = e.status;
    return out;
  }

  /** Reads a file's text. Throws an Error with a message meant for the person using the app. */
  function parse(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error(`This file isn't valid JSON, so it can't be opened. (${err.message})`);
    }
    if (!raw || !ACCEPTED_FORMATS.includes(raw.format)) {
      throw new Error(
        `This isn't a Translation Review file. Its format is ${JSON.stringify(raw && raw.format)}; the app opens "${FORMAT}" files.`,
      );
    }
    if (!Array.isArray(raw.entries)) throw new Error('This file has no list of strings ("entries"), so it can\'t be opened.');
    raw.entries.forEach((e, i) => {
      if (!e || typeof e.key !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string') {
        throw new Error(`String number ${i + 1} is missing its key, English or translation text, so the file can't be opened.`);
      }
      if (e.status !== undefined && !STATUSES.includes(e.status)) {
        throw new Error(`String ${e.key} has an unknown review status "${e.status}", so the file can't be opened.`);
      }
      if (e.options !== undefined && (!Array.isArray(e.options) || e.options.some((o) => typeof o !== 'string'))) {
        throw new Error(`String ${e.key} has options that are not a list of texts, so the file can't be opened.`);
      }
    });
    return { ...raw, format: FORMAT, entries: raw.entries.map(normalizeEntry) };
  }

  function serialize(file) {
    return JSON.stringify({ ...file, entries: file.entries.map(normalizeEntry) }, null, 2) + '\n';
  }

  /** 'todo' means "to review". */
  const statusOf = (e) => e.status || 'todo';

  /**
   * Saves one string. status: 'approved', 'flagged' or null ("to review").
   * Approving also clears the old English, since the translation now matches the current English.
   * When that makes every string approved, the translation options are removed from all strings.
   */
  function applySave(file, key, target, status) {
    const e = file.entries.find((x) => x.key === key);
    if (!e) throw new Error(`The string ${key} is no longer in the file (it was probably removed when the file was refreshed). This edit wasn't saved.`);
    e.target = target;
    if (status) e.status = status;
    else delete e.status;
    if (status === 'approved') delete e.previousSource;
    // Once every string in the file is approved, the options have done their job and are removed everywhere.
    if (file.entries.every((x) => x.status === 'approved')) for (const x of file.entries) delete x.options;
    return e;
  }

  /** Lower case, with non-breaking spaces (used after single-letter words in some languages, for example Polish) read as ordinary spaces, so "o mnie" finds "o mnie". */
  const searchable = (s) => String(s).toLowerCase().replace(/[\u00a0\u202f]/g, ' ');

  /** Does a string match what was typed in the search box? Looks in the key, English and translation. */
  function matches(entry, query) {
    const q = searchable(query).trim();
    return !q || searchable(entry.key + '\n' + entry.source + '\n' + entry.target).includes(q);
  }

  /** The next string after position `from` in the list being shown (`shown` = the indexes on screen, in order), or -1 if there is none. */
  function nextIndex(shown, from) {
    const i = shown.find((n) => n > from);
    return i === undefined ? -1 : i;
  }

  /** A problem with a translation, as a message for the person, or null if none. */
  function problem(entry, target) {
    if (entry.key.startsWith('common:routes.') && !ROUTE_WORD.test(target)) return 'URL word: only a–z, 0–9 and hyphens.';
    if (!target.trim() && entry.source.trim()) return 'Empty translation. The English text will be shown here until it is translated.';
    if (!samePlaceholders(entry.source, target)) return "Placeholders differ from English. Publishing will refuse this file until they match.";
    return null;
  }

  function stats(file) {
    const n = file.entries.length;
    const count = (s) => file.entries.filter((e) => statusOf(e) === s).length;
    return {
      total: n,
      approved: count('approved'),
      flagged: count('flagged'),
      todo: count('todo'),
      englishChanged: file.entries.filter((e) => e.previousSource !== undefined).length,
    };
  }

  /** Word-level difference between two texts: [{ type: 'same' | 'del' | 'add', text }]. */
  function wordDiff(a, b) {
    const x = a.split(/(\s+)/).filter(Boolean);
    const y = b.split(/(\s+)/).filter(Boolean);
    if (x.length * y.length > 4e6) return [{ type: 'del', text: a }, { type: 'add', text: b }];
    const L = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    const push = (type, text) => {
      const last = out[out.length - 1];
      if (last && last.type === type) last.text += text;
      else out.push({ type, text });
    };
    let i = 0;
    let j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) (push('same', x[i]), i++, j++);
      else if (L[i + 1][j] >= L[i][j + 1]) push('del', x[i++]);
      else push('add', y[j++]);
    }
    while (i < x.length) push('del', x[i++]);
    while (j < y.length) push('add', y[j++]);
    return out;
  }

  return { FORMAT, ACCEPTED_FORMATS, placeholders, samePlaceholders, normalizeEntry, parse, serialize, statusOf, applySave, matches, nextIndex, problem, stats, wordDiff };
});
