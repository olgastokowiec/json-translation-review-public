const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const TR = require('../app/lib.js');

const sample = () => ({
  format: 'translation-review/3',
  sourceLanguage: 'en',
  targetLanguage: 'pl',
  guidelines: 'LOCALIZATION-GUIDELINES.md',
  entries: [
    { key: 'common:hi', source: 'Hello {{name}}', target: 'Cześć {{name}}', note: 'A greeting.', placeholders: ['name'], status: 'approved' },
    { key: 'about:body', source: 'New text', previousSource: 'Old text', target: 'Stary tekst', placeholders: [] },
    { key: 'common:routes.speaker', source: 'speaker', target: '', placeholders: [] },
  ],
});

test('opens version 3, 2 and 1 files, and saves them as version 3', () => {
  assert.equal(TR.parse(JSON.stringify(sample())).entries.length, 3);
  const v1 = { ...sample(), format: 'translation-review/1', entries: [{ key: 'a:b', source: 'x', target: 'y', placeholders: [] }] };
  assert.equal(TR.parse(JSON.stringify(v1)).format, 'translation-review/3');
  assert.equal(TR.parse(JSON.stringify({ ...sample(), format: 'translation-review/2' })).format, 'translation-review/3');
});

test('explains why a file cannot be opened', () => {
  assert.throws(() => TR.parse('{nope'), /isn't valid JSON/);
  assert.throws(() => TR.parse('{"format":"something/1","entries":[]}'), /isn't a Translation Review file/);
  assert.throws(() => TR.parse('{"format":"translation-review/2"}'), /no list of strings/);
  assert.throws(() => TR.parse('{"format":"translation-review/2","entries":[{"key":"a"}]}'), /String number 1/);
  assert.throws(() => TR.parse('{"format":"translation-review/2","entries":[{"key":"a","source":"","target":"","status":"done"}]}'), /unknown review status/);
});

test('saving keeps the fixed field order, 2-space indent and a final newline, and changes nothing else', () => {
  const text = JSON.stringify(sample(), null, 2) + '\n';
  assert.equal(TR.serialize(TR.parse(text)), text);
});

test('approve, flag and "to review" set the status in the file; approving clears the old English', () => {
  const f = TR.parse(JSON.stringify(sample()));
  TR.applySave(f, 'about:body', 'Nowy tekst', 'flagged');
  assert.equal(f.entries[1].status, 'flagged');
  assert.equal(f.entries[1].previousSource, 'Old text');
  TR.applySave(f, 'about:body', 'Nowy tekst', 'approved');
  assert.equal(f.entries[1].status, 'approved');
  assert.equal(f.entries[1].previousSource, undefined);
  TR.applySave(f, 'common:hi', 'Hej {{name}}', null);
  assert.equal(f.entries[0].status, undefined);
  assert.equal(f.entries[0].target, 'Hej {{name}}');
  assert.match(TR.serialize(f), /"key": "about:body",\n {6}"source": "New text",\n {6}"target": "Nowy tekst",\n {6}"placeholders": \[\],\n {6}"status": "approved"/);
  assert.throws(() => TR.applySave(f, 'gone:key', 'x', null), /no longer in the file/);
});

test('flags placeholder mismatches, empty translations and bad URL words', () => {
  const [hi, body, route] = sample().entries;
  assert.equal(TR.problem(hi, 'Cześć {{name}}'), null);
  assert.match(TR.problem(hi, 'Cześć {{imie}}'), /Placeholders differ/);
  assert.match(TR.problem(body, '  '), /Empty translation/);
  assert.match(TR.problem(route, 'mówczyni'), /URL word/);
  assert.equal(TR.problem(route, 'mowczyni'), null);
  assert.deepEqual(TR.placeholders('{{b}} and {{ a }} and {{b, format}}'), ['a', 'b']);
});

test('counts progress', () => {
  assert.deepEqual(TR.stats(TR.parse(JSON.stringify(sample()))), { total: 3, approved: 1, flagged: 0, todo: 2, englishChanged: 1 });
});

test('shows what changed in the English, word by word', () => {
  assert.deepEqual(TR.wordDiff('Make products multilingual', 'Make SaaS products global'), [
    { type: 'same', text: 'Make ' },
    { type: 'add', text: 'SaaS ' },
    { type: 'same', text: 'products ' },
    { type: 'del', text: 'multilingual' },
    { type: 'add', text: 'global' },
  ]);
  assert.deepEqual(TR.wordDiff('same', 'same'), [{ type: 'same', text: 'same' }]);
});

test('the format description is valid JSON and lists every field the app writes', () => {
  const schema = JSON.parse(readFileSync(join(__dirname, '..', 'schema', 'translation-review.schema.json'), 'utf8'));
  const fields = Object.keys(schema.properties.entries.items.properties).sort();
  assert.deepEqual(fields, ['key', 'note', 'options', 'placeholders', 'previousSource', 'source', 'status', 'target']);
});

test('next string is the one right after, even when it is already approved; none at the end', () => {
  assert.equal(TR.nextIndex([0, 1, 2, 3], 1), 2);
  assert.equal(TR.nextIndex([0, 1, 2, 3], 3), -1);
  assert.equal(TR.nextIndex([0, 4, 9], 4), 9); // a filtered list skips what is hidden
  assert.equal(TR.nextIndex([0, 4, 9], 5), 9); // the saved string may have left the list
});

test('search finds Polish text with non-breaking spaces when typed with an ordinary space', () => {
  const e = { key: 'nav:about', source: 'About me', target: 'O\u00a0mnie' };
  assert.ok(TR.matches(e, 'o mnie'));
  assert.ok(TR.matches(e, 'O MNIE'));
  assert.ok(TR.matches(e, 'o\u00a0mnie'));
  assert.ok(TR.matches(e, '  '));
  assert.ok(!TR.matches(e, 'w skrócie'));
});

test('options: kept in order, written after the translation, rejected when malformed', () => {
  const f = sample();
  f.entries[2].options = ['A', 'B', 'C'];
  const back = TR.parse(JSON.stringify(f));
  assert.deepEqual(back.entries[2].options, ['A', 'B', 'C']);
  assert.deepEqual(Object.keys(back.entries[2]), ['key', 'source', 'target', 'options', 'placeholders']);
  f.entries[2].options = 'nope';
  assert.throws(() => TR.parse(JSON.stringify(f)), /options that are not a list/);
});

test('options are removed everywhere once every string is approved, not before', () => {
  const f = TR.parse(JSON.stringify(sample()));
  f.entries[1].options = ['A', 'B', 'C'];
  f.entries[2].options = ['A', 'B', 'C'];
  TR.applySave(f, 'about:body', 'Nowy tekst', 'approved');
  assert.deepEqual(f.entries[2].options, ['A', 'B', 'C']); // one string is still not approved
  TR.applySave(f, 'common:routes.speaker', 'mowca', 'approved');
  assert.ok(f.entries.every((e) => e.options === undefined));
});

test('the example file opens, passes its own checks and is saved back unchanged', () => {
  const text = readFileSync(join(__dirname, '..', 'examples', 'de.json'), 'utf8');
  const file = TR.parse(text);
  assert.equal(file.entries.length, 6);
  assert.equal(TR.serialize(file), text);
  for (const e of file.entries) {
    if (e.status === 'approved') assert.equal(TR.problem(e, e.target), null);
  }
});
