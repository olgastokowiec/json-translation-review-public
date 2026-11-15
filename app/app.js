/* Translation Review: the screen. All file-format logic is in lib.js (window.TR). */
'use strict';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const LABEL = { todo: 'to review', approved: 'approved', flagged: 'flagged' };

let file = null; // the parsed translation file
let handle = null; // where it lives on disk (Chrome), or null when the browser can't save over files
let lastModified = 0; // when we last read or wrote it, to notice changes made by something else
let fileName = '';
let sel = 0;
let dirty = false; // the text box has edits that aren't saved yet
let unsavedDownload = false; // no-save browsers: edits not downloaded yet
let writing = Promise.resolve();

const canSave = typeof window.showOpenFilePicker === 'function';
const D = () => file.entries;
const st = (e) => TR.statusOf(e);

/* ---------- Remembering the last file (Chrome only; just a shortcut, the file itself holds all progress) ---------- */

function idb(mode, fn) {
  return new Promise((ok, fail) => {
    const req = indexedDB.open('translation-review', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => fail(req.error);
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction('kv', mode);
        const r = fn(tx.objectStore('kv'));
        tx.oncomplete = () => ok(r && r.result);
        tx.onerror = () => fail(tx.error);
        tx.onabort = () => fail(tx.error);
      } catch (err) {
        fail(err);
      }
    };
  });
}
const remember = (h) => idb('readwrite', (s) => s.put(h, 'recent')).catch(() => {});
const recall = () => idb('readonly', (s) => s.get('recent')).catch(() => null);

/* ---------- Opening ---------- */

function showStartError(err) {
  $('#start-msg').textContent = err && err.message ? err.message : String(err);
}

async function openWithPicker() {
  $('#start-msg').textContent = '';
  if (!confirmLeave()) return;
  if (!canSave) return $('#file-input').click();
  let h;
  try {
    [h] = await window.showOpenFilePicker({
      types: [{ description: 'Translation file', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    });
  } catch (err) {
    if (err.name === 'AbortError') return; // closed the file picker
    return showStartError(err);
  }
  await openHandle(h);
}

async function openHandle(h) {
  try {
    if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') {
      throw new Error('The app needs permission to save into the file. Open it again and choose "Save changes" (or "Allow").');
    }
    const f = await h.getFile();
    const parsed = TR.parse(await f.text());
    handle = h;
    lastModified = f.lastModified;
    remember(h); // a shortcut only; never wait for it
    start(parsed, f.name);
  } catch (err) {
    showStartError(err);
    showReview(false);
  }
}

$('#file-input').onchange = async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  try {
    handle = null;
    start(TR.parse(await f.text()), f.name);
  } catch (err) {
    showStartError(err);
    showReview(false);
  }
};

function start(parsed, name) {
  file = parsed;
  fileName = name;
  dirty = false;
  unsavedDownload = false;
  sel = D().findIndex((e) => st(e) === 'todo');
  if (sel < 0) sel = 0;
  $('#lang').textContent = file.targetLanguage;
  $('#fname').textContent = '· ' + name;
  $('#download').hidden = !!handle;
  $('#saved').textContent = handle ? 'Saves automatically' : '';
  document.title = name + ' · Translation Review';
  showReview(true);
  render();
}

function showReview(on) {
  $('#start').hidden = on;
  $('#review').hidden = !on;
}

function confirmLeave() {
  if (dirty && !confirm('The string you are editing has unsaved changes. Discard them?')) return false;
  if (unsavedDownload && !confirm('Your edits are not downloaded yet. Open another file anyway?')) return false;
  return true;
}

$('#open').onclick = openWithPicker;
$('#other').onclick = openWithPicker;

(async function offerRecent() {
  if (!canSave) {
    $('#no-save').hidden = false;
    return;
  }
  const h = await recall();
  if (!h) return;
  const b = $('#reopen');
  b.textContent = 'Reopen ' + h.name;
  b.hidden = false;
  b.onclick = () => openHandle(h);
})();

/* ---------- Saving ---------- */

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Saves one string into the file. Writes run one at a time, in order. */
function persist(key, target, status) {
  const run = writing.then(async () => {
    if (!handle) {
      TR.applySave(file, key, target, status);
      unsavedDownload = true;
      $('#saved').textContent = 'Not downloaded yet';
      return '';
    }
    let note = '';
    const disk = await handle.getFile();
    if (disk.lastModified !== lastModified) {
      // Something else changed the file (for example a script refreshed it). Start from that version, then apply this edit.
      file = TR.parse(await disk.text());
      note = 'The file was changed outside the app, so it was reloaded before saving this string.';
    }
    TR.applySave(file, key, target, status);
    const w = await handle.createWritable();
    await w.write(TR.serialize(file));
    await w.close();
    lastModified = (await handle.getFile()).lastModified;
    $('#saved').textContent = 'Saved ' + timeNow();
    return note;
  });
  writing = run.catch(() => {});
  return run;
}

$('#download').onclick = () => {
  const url = URL.createObjectURL(new Blob([TR.serialize(file)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  unsavedDownload = false;
  $('#saved').textContent = 'Downloaded ' + timeNow();
};

/* ---------- Text helpers (formatting marks, typographic quotes and dashes) ---------- */

const mark = (s) =>
  esc(s)
    .replace(/\{\{[^}]+?\}\}/g, (m) => '<span class="chip">' + m + '</span>')
    .replace(/ /g, '<span class="nb" title="non-breaking space">⍽</span>')
    .replace(/\n+/g, (m) =>
      m.length > 1 ? '<span class="para" title="paragraph break (blank line)">¶</span>' + m : '<span class="br" title="line break">↵</span>' + m,
    );

const fixNb = (s) => {
  let p;
  do {
    p = s;
    s = s.replace(/(^|[^\w\\])([aiouwzAIOUWZ]) (?=\S)/g, (m, a, b) => a + b + ' ');
  } while (p !== s);
  return s;
};

const diffHtml = (a, b) =>
  TR.wordDiff(a, b)
    .map((p) => (p.type === 'same' ? mark(p.text) : p.type === 'del' ? '<del>' + mark(p.text) + '</del>' : '<ins>' + mark(p.text) + '</ins>'))
    .join('');

// [button label, text before the selection, text after it, tooltip]
const RIB = [
  ['B', '**', '**', 'Bold: wraps the selected text'],
  ['I', '*', '*', 'Italic: wraps the selected text'],
  ['[ ]( )', '[', '](https://)', 'Link: selected text becomes the link text, then type the address'],
  ['• list', '* ', '', 'Bullet list item (at the cursor)'],
  ['1. list', '1\\. ', '', 'Numbered list item (the dot is escaped, as in the source)'],
  ['¶ paragraph', '\n\n', '', 'Paragraph break (blank line)'],
  ['↵ line break', '  \n', '', 'Line break: two spaces and a new line'],
  ['\\-', '\\-', '', 'Escaped hyphen, used for list dashes in some texts'],
  ['\\~', '\\~', '', 'Escaped tilde (means “about”)'],
  ['\\.', '\\.', '', 'Escaped dot, as in “21\\.”'],
  ['„ ”', '„', '”', 'Low-high quotes („ ”): wraps the selected text'],
  ['–', '–', '', 'En dash'],
  ['…', '…', '', 'Ellipsis'],
  ['→', '→', '', 'Arrow'],
  ['⍽', ' ', '', 'Non-breaking space'],
];

function wrap(a, b) {
  const t = $('#t');
  const s = t.selectionStart;
  const e = t.selectionEnd;
  const chosen = t.value.slice(s, e);
  t.setRangeText(a + chosen + b, s, e, 'preserve');
  const p = chosen ? s + a.length + chosen.length + b.length : s + a.length;
  t.setSelectionRange(p, p);
  t.focus();
  dirty = true;
  check();
}
function ins(txt) {
  const t = $('#t');
  t.setRangeText(txt, t.selectionStart, t.selectionEnd, 'end');
  t.focus();
  dirty = true;
  check();
}
function fit(t) {
  t.style.height = 'auto';
  t.style.height = Math.min(Math.max(t.scrollHeight + 4, 100), 600) + 'px';
}
const getH = () => {
  try {
    return localStorage.getItem('taH');
  } catch (_) {
    return null;
  }
};
const setH = (h) => {
  try {
    if (h === null) localStorage.removeItem('taH');
    else localStorage.setItem('taH', String(Math.round(h)));
  } catch (_) {}
};

/* ---------- Screen ---------- */

function progress() {
  const s = TR.stats(file);
  const n = s.total || 1;
  $('#bar').innerHTML = '<i class="b-ok" style="width:' + (s.approved / n) * 100 + '%"></i><i class="b-flag" style="width:' + (s.flagged / n) * 100 + '%"></i>';
  $('#stats').textContent =
    s.approved + ' / ' + s.total + ' approved (' + Math.round((s.approved / n) * 100) + '%) · ' + s.flagged + ' flagged · ' + s.todo + ' to review' +
    (s.englishChanged ? ' · ' + s.englishChanged + ' with changed English' : '');
}

function visible() {
  const q = $('#q').value;
  const f = $('#f').value;
  return D()
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => (f === 'all' || (f === 'changed' ? e.previousSource !== undefined : st(e) === f)) && TR.matches(e, q));
}

/** The left-hand list and progress bar only. Typing in the search box must not touch the detail pane (it would take the cursor away). */
function renderList() {
  progress();
  let h = '';
  let cur = '';
  const per = {};
  D().forEach((e) => {
    const n = e.key.split(':')[0];
    per[n] = per[n] || [0, 0];
    per[n][1]++;
    if (st(e) === 'approved') per[n][0]++;
  });
  for (const { e, i } of visible()) {
    const n = e.key.split(':')[0];
    if (n !== cur) {
      cur = n;
      h += '<div class="ns"><span>' + esc(n) + '</span><span>' + per[n][0] + '/' + per[n][1] + '</span></div>';
    }
    h +=
      '<div class="row' + (i === sel ? ' sel' : '') + '" data-i="' + i + '"><div class="dot ' + st(e) + '"></div><span>' + esc(e.target || e.source) +
      '<small>' + (e.previousSource !== undefined ? '<span class="changed">English changed · </span>' : '') +
      (e.options && e.options.length && st(e) !== 'approved' ? '<span class="changed">options · </span>' : '') + esc(e.key.split(':')[1] || '') + '</small></span></div>';
  }
  $('#list').innerHTML = h || '<p style="padding:12px" class="hint">Nothing matches.</p>';
  $('#list').querySelectorAll('.row').forEach((r) => (r.onclick = () => go(+r.dataset.i)));
}

function render() {
  renderList();
  detail();
  const s = $('#list .sel');
  if (s) s.scrollIntoView({ block: 'nearest' });
}

function go(i) {
  if (dirty && !confirm('Unsaved changes will be lost. Continue?')) return;
  sel = i;
  dirty = false;
  render();
}

function detail() {
  const e = D()[sel];
  if (!e) {
    $('#detail').innerHTML = '';
    return;
  }
  const changed =
    e.previousSource !== undefined
      ? '<div class="diffnote"><b>English changed since your last review.</b> <span class="hint">Removed words are struck through, new words are underlined. Approving clears this note.</span><div class="box">' +
        diffHtml(e.previousSource, e.source) + '</div></div>'
      : '';
  $('#detail').innerHTML =
    '<div class="ribbon">' + RIB.map((r, i) => '<button data-r="' + i + '" title="' + esc(r[3]) + '">' + esc(r[0]) + '</button>').join('') + '</div>' +
    '<div class="key">' + esc(e.key) + ' · #' + (sel + 1) + ' of ' + D().length + '</div>' +
    changed +
    '<label>English (source)</label><div class="box">' + mark(e.source) + '</div>' +
    (e.note ? '<div class="note">' + esc(e.note) + '</div>' : '') +
    optionsHtml(e) +
    '<label for="t">Translation</label>' +
    '<div class="tools">' + e.placeholders.map((p) => '<button class="chipbtn" data-ph="' + esc(p) + '" title="Insert at cursor">{{' + esc(p) + '}}</button>').join('') +
    '<button id="b-nb" title="Insert a non-breaking space at the cursor (Mac: Option+Space does the same)">⍽ Non-breaking space</button>' +
    '<button id="b-tall" title="Make the text box taller">▼ Taller</button><button id="b-short" title="Make the text box shorter">▲ Shorter</button>' +
    '<button id="b-auto" title="Fit the height to the text">Fit to text</button>' +
    '<button id="b-fix" title="Put a non-breaking space after single-letter words (a, i, o, u, w, z)">Fix single-letter words</button></div>' +
    '<textarea id="t" spellcheck="true" lang="' + esc(file.targetLanguage) + '">' + esc(e.target) + '</textarea>' +
    '<label>Preview with marks</label><div class="box" id="pv"></div><div class="msg" id="m"></div>' +
    '<div class="actions"><button class="primary" id="b-ok">Save &amp; approve → next</button><button id="b-save">Save (to review)</button>' +
    '<button id="b-flag">Flag for later</button><button id="b-prev">← Prev</button><button id="b-next">Next →</button></div>' +
    '<div class="hint">Ctrl/Cmd+Enter = save &amp; approve.' + (e.options && e.options.length ? ' Ctrl+1/2/3 = pick option A/B/C.' : '') + ' Status: <b>' + LABEL[st(e)] + '</b>. “Non-breaking space” characters are kept as typed.</div>';

  const t = $('#t');
  t.oninput = edited;
  document.querySelectorAll('[data-o]').forEach((b) => {
    b.onmousedown = (ev) => ev.preventDefault(); // keep the cursor in the text box
    b.onclick = () => pick(+b.dataset.o);
  });
  markPicked();
  check();
  const h0 = getH();
  if (h0) t.style.height = h0 + 'px';
  else fit(t);
  t.onmouseup = () => setH(t.offsetHeight);
  $('#b-auto').onclick = () => (setH(null), fit(t));
  $('#b-tall').onclick = () => {
    const h = t.offsetHeight + 80;
    t.style.height = h + 'px';
    setH(h);
  };
  $('#b-short').onclick = () => {
    const h = Math.max(60, t.offsetHeight - 80);
    t.style.height = h + 'px';
    setH(h);
  };
  document.querySelectorAll('[data-r]').forEach((b) => {
    b.onmousedown = (ev) => ev.preventDefault();
    b.onclick = () => {
      const r = RIB[+b.dataset.r];
      wrap(r[1], r[2]);
    };
  });
  document.querySelectorAll('[data-ph]').forEach((b) => (b.onclick = () => ins('{{' + b.dataset.ph + '}}')));
  $('#b-nb').onclick = () => ins(' ');
  $('#b-fix').onclick = () => {
    t.value = fixNb(t.value);
    dirty = true;
    check();
  };
  $('#b-ok').onclick = () => save('approved', true);
  $('#b-save').onclick = () => save(null, false);
  $('#b-flag').onclick = () => save('flagged', true);
  $('#b-prev').onclick = () => step(-1);
  $('#b-next').onclick = () => step(1);
  t.focus();
}

/* ---------- Translation options (three proposals per string; the reviewer picks one into the text box) ---------- */

function optionsHtml(e) {
  if (!e.options || !e.options.length) return '';
  return (
    '<label>Options (click one to use it, then edit if you like)</label><div class="opts">' +
    e.options.map((o, i) => '<button class="opt" data-o="' + i + '" title="Use option ' + 'ABC'[i] + ' (Ctrl+' + (i + 1) + ')"><b>' + 'ABC'[i] + '</b><span>' + mark(o) + '</span></button>').join('') +
    '</div>'
  );
}

/** Highlights the option whose text is currently in the text box. */
function markPicked() {
  const e = D()[sel];
  const t = $('#t');
  if (!e || !t) return;
  document.querySelectorAll('[data-o]').forEach((b) => b.classList.toggle('picked', (e.options || [])[+b.dataset.o] === t.value));
}

function edited() {
  const t = $('#t');
  dirty = true;
  check();
  if (!getH()) fit(t);
  markPicked();
}

function pick(i) {
  const e = D()[sel];
  const t = $('#t');
  if (!e || !t || !e.options || e.options[i] === undefined) return;
  t.focus();
  t.select();
  // insertText keeps Cmd+Z working, so a mis-click can be undone
  if (!document.execCommand('insertText', false, e.options[i])) t.value = e.options[i];
  if (t.value !== e.options[i]) t.value = e.options[i];
  edited();
}

function check() {
  const e = D()[sel];
  const t = $('#t').value;
  $('#pv').innerHTML = mark(t) || '&nbsp;';
  const p = TR.problem(e, t);
  $('#m').innerHTML = p ? '<span class="bad">' + esc(p) + '</span>' : '';
}

async function save(status, advance) {
  const key = D()[sel].key;
  const target = $('#t').value;
  let note;
  try {
    note = await persist(key, target, status);
  } catch (err) {
    $('#m').innerHTML = '<span class="bad">Not saved: ' + esc(err.message || err) + '</span>';
    return;
  }
  dirty = false;
  const i = D().findIndex((e) => e.key === key); // the file may have been reloaded
  sel = i < 0 ? 0 : i;
  const next = advance ? TR.nextIndex(visible().map((v) => v.i), sel) : -1;
  if (next >= 0) go(next);
  else render();
  if (note) $('#m').innerHTML = '<span class="good">' + esc(note) + '</span>';
  const p = i >= 0 && !advance ? TR.problem(D()[i], target) : null;
  if (p) $('#m').innerHTML = '<span class="bad">Saved, but: ' + esc(p) + '</span>';
}

function step(d) {
  const i = sel + d;
  if (i < 0 || i >= D().length) return render();
  go(i);
}

$('#q').oninput = () => file && renderList();
$('#f').onchange = () => file && renderList();
addEventListener('keydown', (e) => {
  if (file && !$('#review').hidden && e.ctrlKey && !e.metaKey && !e.altKey && /^Digit[1-3]$/.test(e.code)) {
    e.preventDefault();
    pick(+e.code.slice(-1) - 1);
    return;
  }
  if (file && !$('#review').hidden && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    save('approved', true);
  }
});
addEventListener('beforeunload', (e) => {
  if (dirty || unsavedDownload) e.preventDefault();
});
