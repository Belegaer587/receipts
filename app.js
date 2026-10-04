import * as db from './db.js';
import * as lock from './lock.js';
import { loadSource, createCropper } from './crop.js';
import { warp } from './warp.js';
import { buildPdf } from './pdf.js';

const $ = (id) => document.getElementById(id);
const LOCK_AFTER_MS = 30000;

// ---------- settings (localStorage, wrapped: it can throw in private mode) ----------
const store = {
  get: (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

// ---------- state ----------
let items = [];
let tab = 'inbox';
const selected = new Set();
let pagesDraft = []; // {blob, w, h, url}
let cropper = null;
let sheetItem = null;
let urls = new Map();

// ---------- helpers ----------
const show = (id, on = true) => { $(id).hidden = !on; };
const fmt = (t) => new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fileName = (r) => { const d = new Date(r.created), p = (n) => String(n).padStart(2, '0'); return `receipt-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.pdf`; };
const toFile = (r) => new File([r.pdf], fileName(r), { type: 'application/pdf' });

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function confirmBox(text, yes, no = 'Cancel') {
  return new Promise((resolve) => {
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yes;
    $('confirm-no').textContent = no;
    show('confirm');
    const done = (v) => { show('confirm', false); $('confirm-yes').onclick = $('confirm-no').onclick = null; resolve(v); };
    $('confirm-yes').onclick = () => done(true);
    $('confirm-no').onclick = () => done(false);
  });
}

const blobToBytes = async (b) => new Uint8Array(await b.arrayBuffer());
const canvasToJpeg = (c, q) => new Promise((res) => c.toBlob(res, 'image/jpeg', q));

// ---------- lock ----------
let unlocked = false;
let hiddenAt = 0;

function showLock() {
  unlocked = false;
  show('main', false); show('crop', false); show('review', false); show('settings', false); show('sheet', false); show('confirm', false);
  show('lock');
  if (!lock.supported()) {
    $('lock-msg').textContent = 'This browser cannot do Face ID lock. Continue without lock?';
    $('lock-btn').textContent = 'Continue';
  } else if (lock.isSetUp()) {
    $('lock-msg').textContent = 'Locked';
    $('lock-btn').textContent = 'Unlock with Face ID';
  } else {
    $('lock-msg').textContent = 'First time here. Set up the Face ID lock to protect your receipts.';
    $('lock-btn').textContent = 'Set up Face ID lock';
  }
}

async function tryUnlock() {
  try {
    if (!lock.supported()) { /* no lock available, let the user decide */ }
    else if (!lock.isSetUp()) await lock.setup();
    else await lock.unlock();
  } catch (e) {
    $('lock-msg').textContent = 'Could not unlock. Try again.';
    return;
  }
  unlocked = true;
  show('lock', false);
  show('main');
  await refresh();
}

$('lock-btn').onclick = tryUnlock;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    if (unlocked) { show('lock'); $('lock-msg').textContent = ''; $('lock-btn').hidden = true; }
  } else if (unlocked) {
    $('lock-btn').hidden = false;
    if (Date.now() - hiddenAt > LOCK_AFTER_MS) showLock(); else show('lock', false);
  }
});

// ---------- list ----------
async function refresh() {
  items = (await db.all()).sort((a, b) => b.created - a.created);
  render();
}

function render() {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = new Map();
  const inbox = items.filter((r) => r.status === 'inbox');
  const sent = items.filter((r) => r.status === 'sent');
  $('count-inbox').textContent = inbox.length || '';
  $('count-sent').textContent = sent.length || '';
  $('tab-inbox').classList.toggle('active', tab === 'inbox');
  $('tab-sent').classList.toggle('active', tab === 'sent');
  $('title').textContent = tab === 'inbox' ? 'To send' : 'Sent';

  const rows = tab === 'inbox' ? inbox : sent;
  for (const id of [...selected]) if (!rows.some((r) => r.id === id)) selected.delete(id);

  const list = $('list');
  list.replaceChildren();
  show('empty', rows.length === 0);
  $('empty').textContent = tab === 'inbox' ? 'No receipts waiting. Tap the camera button to scan one.' : 'Nothing sent yet.';

  for (const r of rows) {
    const li = document.createElement('li');
    li.className = 'item';
    const sel = document.createElement('button');
    sel.className = 'sel' + (selected.has(r.id) ? ' on' : '');
    sel.textContent = selected.has(r.id) ? '✓' : '';
    sel.setAttribute('aria-label', 'Select');
    sel.onclick = () => { selected.has(r.id) ? selected.delete(r.id) : selected.add(r.id); render(); };
    const img = document.createElement('img');
    const u = URL.createObjectURL(r.preview); urls.set(r.id, u); img.src = u; img.alt = '';
    const meta = document.createElement('button');
    meta.className = 'meta';
    const b = document.createElement('b'); b.textContent = fmt(r.created);
    const s = document.createElement('span');
    s.textContent = `${r.pageCount} page${r.pageCount > 1 ? 's' : ''}` + (r.sentAt ? ` · sent ${fmt(r.sentAt)}` : '');
    meta.append(b, s);
    meta.onclick = () => openSheet(r);
    li.append(sel, img, meta);
    list.append(li);
  }

  const n = selected.size;
  show('sendbar', n > 0);
  $('btn-send').textContent = tab === 'inbox' ? `Send ${n} receipt${n > 1 ? 's' : ''}` : `Share ${n} again`;
}

$('tab-inbox').onclick = () => { tab = 'inbox'; selected.clear(); render(); };
$('tab-sent').onclick = () => { tab = 'sent'; selected.clear(); render(); };
$('btn-clear').onclick = () => { selected.clear(); render(); };

// ---------- sharing ----------
async function shareRecords(recs, { subject, text }) {
  const files = recs.map(toFile);
  if (!navigator.canShare?.({ files })) { toast('Sharing files is not supported here.'); return false; }
  const email = store.get('email');
  // Fire the clipboard write and the share in the same tick so iOS keeps the user gesture.
  if (email) navigator.clipboard?.writeText(email).catch(() => {});
  try {
    await navigator.share({ files, title: subject, text });
    return true;
  } catch (e) {
    if (e.name !== 'AbortError') toast('Sharing failed.');
    return false;
  }
}

function subjectFor(count) {
  const tpl = store.get('subject') || 'Receipts {date}';
  const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return tpl.replace('{date}', date).replace('{count}', String(count));
}

$('btn-send').onclick = async () => {
  const recs = items.filter((r) => selected.has(r.id));
  if (!recs.length) return;
  const ok = await shareRecords(recs, { subject: subjectFor(recs.length), text: `${recs.length} receipt${recs.length > 1 ? 's' : ''} attached.` });
  if (ok && tab === 'inbox') {
    const yes = await confirmBox(`Did the email go out? ${recs.length} receipt${recs.length > 1 ? 's' : ''} will move to Sent.`, 'Yes, mark as sent', 'Not yet');
    if (yes) {
      const now = Date.now();
      for (const r of recs) await db.put({ ...r, status: 'sent', sentAt: now });
      selected.clear();
      await refresh();
    }
  }
};

// ---------- item sheet ----------
function openSheet(r) {
  sheetItem = r;
  $('sheet-img').src = urls.get(r.id) || '';
  $('sheet-title').textContent = fmt(r.created);
  $('sheet-meta').textContent = `${r.pageCount} page${r.pageCount > 1 ? 's' : ''} · ${(r.pdf.size / 1024).toFixed(0)} KB` + (r.sentAt ? ` · sent ${fmt(r.sentAt)}` : '');
  $('sheet-move').textContent = r.status === 'sent' ? 'Move back to To send' : 'Mark as sent without emailing';
  $('sheet-delete').textContent = 'Delete';
  $('sheet-delete').dataset.armed = '';
  show('sheet');
}
$('sheet-close').onclick = () => show('sheet', false);
$('sheet').onclick = (e) => { if (e.target === $('sheet')) show('sheet', false); };
$('sheet-share').onclick = () => shareRecords([sheetItem], { subject: subjectFor(1), text: '1 receipt attached.' });
$('sheet-move').onclick = async () => {
  const r = sheetItem;
  await db.put(r.status === 'sent' ? { ...r, status: 'inbox', sentAt: undefined } : { ...r, status: 'sent', sentAt: Date.now() });
  show('sheet', false); await refresh();
};
$('sheet-delete').onclick = async () => {
  const b = $('sheet-delete');
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to delete for good'; return; }
  await db.del(sheetItem.id);
  show('sheet', false); await refresh();
};

// ---------- scanning ----------
const cam = $('cam'), lib = $('lib');
$('btn-scan').onclick = () => cam.click();
$('btn-photos').onclick = () => lib.click();
$('btn-addpage').onclick = () => cam.click();
$('btn-addphoto').onclick = () => lib.click();
cam.onchange = lib.onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) await startCrop(file);
};

async function startCrop(file) {
  let src;
  try { src = await loadSource(file); } catch { toast('Could not open that image.'); return; }
  show('crop');
  cropper?.destroy();
  cropper = createCropper($('crop-canvas'), src);
  cropper.layout();
  $('crop-done').onclick = async () => {
    $('crop-done').disabled = true;
    await new Promise((r) => setTimeout(r, 30)); // let the button state paint
    const out = warp(src, cropper.points(), { enhance: $('enhance').checked });
    const blob = await canvasToJpeg(out, 0.72);
    pagesDraft.push({ blob, w: out.width, h: out.height, url: URL.createObjectURL(blob) });
    cropper.destroy(); cropper = null;
    $('crop-done').disabled = false;
    show('crop', false);
    renderReview();
  };
  $('crop-cancel').onclick = () => {
    cropper.destroy(); cropper = null;
    show('crop', false);
    if (pagesDraft.length) renderReview();
  };
  $('crop-reset').onclick = () => cropper.reset();
}

function renderReview() {
  show('review');
  const ul = $('pages');
  ul.replaceChildren();
  pagesDraft.forEach((p, i) => {
    const li = document.createElement('li');
    const img = document.createElement('img'); img.src = p.url; img.alt = '';
    const span = document.createElement('span'); span.textContent = `Page ${i + 1}`;
    const rm = document.createElement('button'); rm.className = 'link danger'; rm.textContent = 'Remove';
    rm.onclick = () => {
      URL.revokeObjectURL(p.url);
      pagesDraft.splice(i, 1);
      if (!pagesDraft.length) { show('review', false); } else renderReview();
    };
    li.append(img, span, rm);
    ul.append(li);
  });
}

function clearDraft() {
  pagesDraft.forEach((p) => URL.revokeObjectURL(p.url));
  pagesDraft = [];
  show('review', false);
}

$('btn-discard').onclick = async () => {
  if (await confirmBox('Throw away this scan?', 'Discard', 'Keep')) clearDraft();
};

$('btn-save').onclick = async () => {
  if (!pagesDraft.length) return;
  $('btn-save').disabled = true;
  try {
    const pages = await Promise.all(pagesDraft.map(async (p) => ({ jpeg: await blobToBytes(p.blob), w: p.w, h: p.h })));
    const pdf = buildPdf(pages);
    const bmp = await createImageBitmap(pagesDraft[0].blob);
    const s = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    const preview = await canvasToJpeg(c, 0.7);
    await db.put({ id: crypto.randomUUID(), created: Date.now(), status: 'inbox', pageCount: pages.length, pdf, preview });
    clearDraft();
    tab = 'inbox';
    await refresh();
    toast('Receipt saved');
  } catch (e) {
    toast('Saving failed. Storage may be full.');
  } finally {
    $('btn-save').disabled = false;
  }
};

// ---------- settings ----------
$('btn-settings').onclick = async () => {
  $('set-email').value = store.get('email');
  $('set-subject').value = store.get('subject');
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    $('storage-info').textContent = est ? `Storage used: ${(est.usage / 1048576).toFixed(1)} MB. Persistent: ${persisted ? 'yes' : 'no'}.` : '';
  } catch { /* ignore */ }
  show('settings');
};
$('set-close').onclick = () => {
  store.set('email', $('set-email').value.trim());
  store.set('subject', $('set-subject').value.trim());
  show('settings', false);
};
$('btn-export').onclick = async () => {
  const recs = items;
  if (!recs.length) { toast('Nothing to export.'); return; }
  await shareRecords(recs, { subject: 'Receipts archive', text: `${recs.length} receipts` });
};
$('btn-relock').onclick = async () => {
  if (await confirmBox('Remove the current lock and set it up again?', 'Reset', 'Cancel')) {
    lock.reset();
    show('settings', false);
    showLock();
  }
};

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
navigator.storage?.persist?.().catch(() => {});
showLock();
if (lock.supported() && lock.isSetUp()) tryUnlock();
