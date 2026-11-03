(() => {
'use strict';
// Site editor. Everything lives in one file in the repo (projects.json):
//   { site: { name, nav, sections, theme, ... }, projects: [ ... ] }
// The editor loads it, you change things with a live preview, and Publish writes it back.

const $ = id => document.getElementById(id);
const DATA_PATH = 'projects.json';
const S = { cfg: null, data: null, sha: null, dirty: false, tab: 'projects', cur: 0, q: '', pvMode: '', open: new WeakSet(), autoSlug: new WeakSet() };
const previewCache = {};   // freshly uploaded image path -> local blob URL (until Pages republishes)

/* ================= small helpers ================= */
const store = {
  get(k) { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v, persist = true) { try { (persist ? localStorage : sessionStorage).setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} }
};
function slugify(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
function b64enc(s) { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); }
function b64dec(s) { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0))); }
function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
function setPath(o, p, val) {
  const ks = p.split('.'); let a = o;
  for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null || typeof a[ks[i]] !== 'object') a[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[ks[i]]; }
  a[ks[ks.length - 1]] = val;
}
const val = p => getPath(S.data, p);
const sel = p => `[data-path="${CSS.escape(p)}"]`;
function setStatus(msg, kind) { const s = $('status'); s.textContent = msg || ''; s.className = 'status' + (kind ? ' ' + kind : ''); }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
function rawUrl(p) {
  if (!p) return '';
  if (previewCache[p]) return previewCache[p];
  if (/^(https?:|data:|blob:)/.test(p) || !S.cfg) return p;
  return `https://raw.githubusercontent.com/${S.cfg.owner}/${S.cfg.repo}/${S.cfg.branch}/${p.replace(/^\.?\//, '')}`;
}
const thumbStyle = p => p ? ` style="background-image:url(&quot;${esc(rawUrl(p))}&quot;)"` : '';

/* ================= GitHub API ================= */
async function gh(path, opts = {}) {
  const enc = path.split('/').map(encodeURIComponent).join('/');
  const base = `https://api.github.com/repos/${S.cfg.owner}/${S.cfg.repo}/contents/${enc}`;
  const url = opts.method ? base : `${base}?ref=${encodeURIComponent(S.cfg.branch)}&t=${Date.now()}`;
  const r = await fetch(url, { ...opts, cache: 'no-store', headers: { Authorization: 'Bearer ' + S.cfg.token, Accept: 'application/vnd.github+json', ...(opts.headers || {}) } });
  if (r.status === 404 && !opts.method) return null;
  if (!r.ok) { let m = ''; try { m = (await r.json()).message; } catch (e) {} const e = new Error(`GitHub ${r.status}${m ? ': ' + m : ''}`); e.status = r.status; throw e; }
  return r.json();
}
async function readRemote() {
  const f = await gh(DATA_PATH);
  if (!f) return { sha: null, data: null };
  let data;
  if (f.content) data = JSON.parse(b64dec(f.content));
  else data = await (await fetch(f.download_url, { cache: 'no-store' })).json();   // files over 1 MB
  return { sha: f.sha, data };
}
const putFile = (path, b64, message, sha) =>
  gh(path, { method: 'PUT', body: JSON.stringify({ message, content: b64, branch: S.cfg.branch, ...(sha ? { sha } : {}) }) });

/* ================= connect ================= */
function detectRepo() {
  const h = location.hostname;
  if (!h.endsWith('.github.io')) return null;
  const owner = h.split('.')[0];
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return { owner, repo: seg && !seg.endsWith('.html') ? seg : `${owner}.github.io` };
}
function prefill() {
  let saved = null; try { saved = JSON.parse(store.get('se_cfg') || store.get('pe_cfg') || 'null'); } catch (e) {}
  const det = detectRepo();
  $('cOwner').value = det?.owner || saved?.owner || '';
  $('cRepo').value = det?.repo || saved?.repo || '';
  $('cBranch').value = saved?.branch || 'main';
  const tok = store.get('se_token') || store.get('pe_token');   // pe_token = the earlier editor's saved key
  if (tok) { $('cToken').value = tok; if ($('cOwner').value && $('cRepo').value) connect(); }
}
async function connect() {
  S.cfg = { owner: $('cOwner').value.trim(), repo: $('cRepo').value.trim(), branch: $('cBranch').value.trim() || 'main', token: $('cToken').value.trim() };
  const msg = $('cMsg');
  if (!S.cfg.token || !S.cfg.owner || !S.cfg.repo) { msg.textContent = 'Fill in all the fields.'; return; }
  msg.textContent = 'Connecting…';
  try {
    const rr = await fetch(`https://api.github.com/repos/${S.cfg.owner}/${S.cfg.repo}`, { cache: 'no-store', headers: { Authorization: 'Bearer ' + S.cfg.token, Accept: 'application/vnd.github+json' } });
    if (!rr.ok) { const e = new Error('GitHub ' + rr.status); e.status = rr.status; throw e; }
    const r = await readRemote();
    S.sha = r.sha; S.data = normalize(r.data);
    store.set('se_cfg', JSON.stringify({ owner: S.cfg.owner, repo: S.cfg.repo, branch: S.cfg.branch }));
    store.del('pe_token'); store.del('se_token');
    store.set('se_token', S.cfg.token, $('cRemember').checked);
  } catch (e) {
    msg.textContent = e.status === 401 ? 'GitHub rejected that token. Check it, or make a new one.'
      : e.status === 403 || e.status === 404 ? `The token can't open ${S.cfg.owner}/${S.cfg.repo}. Check the repo name, or give the token access to it.`
      : e.message;
    return;
  }
  $('connect').classList.add('hidden'); $('shell').classList.remove('hidden');
  const det = detectRepo();
  $('viewSite').href = det && det.repo === S.cfg.repo ? new URL('./', location.href).href
    : `https://${S.cfg.owner}.github.io/${S.cfg.repo.toLowerCase() === S.cfg.owner.toLowerCase() + '.github.io' ? '' : S.cfg.repo + '/'}`;
  restoreLocal();
  S.cur = 0;
  switchTab(S.tab);
  setStatus(`Connected to ${S.cfg.owner}/${S.cfg.repo}`);
}

/* ================= local autosave ================= */
const draftKey = () => `se_draft:${S.cfg.owner}/${S.cfg.repo}`;
let localTimer;
function saveLocal() {
  clearTimeout(localTimer);
  localTimer = setTimeout(() => { try { localStorage.setItem(draftKey(), JSON.stringify({ sha: S.sha, time: Date.now(), data: S.data })); } catch (e) {} }, 500);
}
function clearLocal() { clearTimeout(localTimer); try { localStorage.removeItem(draftKey()); } catch (e) {} }
function restoreLocal() {
  let d = null; try { d = JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch (e) {}
  if (!d || JSON.stringify(normalize(d.data)) === JSON.stringify(S.data)) return clearLocal();
  const when = new Date(d.time).toLocaleString();
  const warn = d.sha !== S.sha ? '\n\nNote: the published site has changed since then, so restoring will replace those newer changes when you publish.' : '';
  if (confirm(`You have unpublished edits from ${when}. Restore them?${warn}`)) { S.data = normalize(d.data); setDirty(true); }
  else clearLocal();
}

/* ================= dirty / publish ================= */
function setDirty(on) {
  S.dirty = on;
  $('publish').classList.toggle('dirty', on);
  if (on) { setStatus('Unpublished changes'); saveLocal(); }
}
function changed() { setDirty(true); schedulePreview(); }

async function publish() {
  const seen = new Set();
  for (const p of S.data.projects) {
    if (!p.id) p.id = slugify(p.title) || 'project';
    if (seen.has(p.id)) { setStatus(`Two projects use the URL "${p.id}". Change one slug, then publish.`, 'err'); return; }
    seen.add(p.id);
  }
  const btn = $('publish'); btn.disabled = true; setStatus('Publishing…');
  try {
    const remote = await gh(DATA_PATH);
    const rsha = remote ? remote.sha : null;
    if (rsha && rsha !== S.sha && !confirm('The site file changed on GitHub since you opened the editor (another tab or device?). Publish anyway and replace it?')) {
      setStatus('Publish cancelled.'); btn.disabled = false; return;
    }
    const res = await putFile(DATA_PATH, b64enc(JSON.stringify(S.data, null, 2) + '\n'), 'Update site from editor', rsha);
    S.sha = res.content.sha;
    setDirty(false); clearLocal();
    setStatus('Published. Live in about a minute.', 'ok'); toast('Published 🎉');
  } catch (e) { setStatus('Publish failed: ' + e.message, 'err'); }
  btn.disabled = false;
}

/* ================= images ================= */
async function prepareImage(file) {
  const type = file.type || '';
  const extOf = n => (n.split('.').pop() || 'png').toLowerCase();
  if (/gif|svg/.test(type) || (file.size < 900e3 && /png|jpe?g|webp/.test(type))) return { blob: file, ext: extOf(file.name || 'x.png') };
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.86));
  if (!blob || blob.type !== 'image/webp') return { blob: await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86)), ext: 'jpg' };
  return { blob, ext: 'webp' };
}
async function uploadImage(file) {
  const { blob, ext } = await prepareImage(file);
  const raw = (file.name || '').replace(/\.[^.]+$/, '');
  const base = slugify(/^image$/i.test(raw) || !raw ? 'pasted' : raw) || 'image';
  const path = `images/${base}-${Date.now().toString(36)}.${ext}`;
  const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
  await putFile(path, b64, `Add image ${path}`);
  previewCache[path] = URL.createObjectURL(blob);
  return path;
}
function altFrom(f) { const n = (f.name || '').replace(/\.[^.]+$/, ''); return /^image$/i.test(n) ? '' : n.replace(/[-_]+/g, ' '); }

async function handleFiles(files, target) {
  files = [...files].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  if (target.kind === 'lib') {
    for (const f of files) {
      setStatus('Uploading image…');
      try { target.onPick(await uploadImage(f)); setStatus('Image uploaded.', 'ok'); } catch (e) { setStatus('Upload failed: ' + e.message, 'err'); }
    }
    return;
  }
  if (target.kind === 'field') {
    setStatus('Uploading image…');
    try { setField(target.path, await uploadImage(files[0])); setStatus('Image uploaded.', 'ok'); }
    catch (e) { setStatus('Upload failed: ' + e.message, 'err'); }
    return;
  }
  for (const f of files) {
    const ph = `![Uploading ${f.name || 'image'}… ${Math.random().toString(36).slice(2, 7)}]()`;
    insertText(target.ta, `\n${ph}\n`);
    setStatus('Uploading image…');
    try { const p = await uploadImage(f); replaceIn(target.path, ph, `![${altFrom(f)}](${p})`); setStatus('Image uploaded.', 'ok'); }
    catch (e) { replaceIn(target.path, ph, ''); setStatus('Upload failed: ' + e.message, 'err'); }
  }
}
function replaceIn(path, find, rep) {
  const cur = String(val(path) || '');
  if (!cur.includes(find)) return;
  setPath(S.data, path, cur.replace(find, rep));
  document.querySelectorAll(sel(path)).forEach(el => { const pos = el.selectionStart; el.value = val(path); try { el.setSelectionRange(pos, pos); } catch (e) {} });
  changed();
}
function setField(path, v) {
  setPath(S.data, path, v);
  document.querySelectorAll(sel(path)).forEach(el => {
    if (el.type === 'color') { if (/^#[0-9a-f]{6}$/i.test(v)) el.value = v; } else el.value = v;
  });
  document.querySelectorAll(`.imgf[data-path="${CSS.escape(path)}"] .thumb`).forEach(t => t.style.backgroundImage = v ? `url("${rawUrl(v)}")` : '');
  changed();
}
let pickTarget = null;
function pickFiles(target) { pickTarget = target; $('filePick').value = ''; $('filePick').click(); }
$('filePick').addEventListener('change', e => { if (pickTarget) handleFiles(e.target.files, pickTarget); });

async function openLibrary(onPick) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box"><div class="mh"><h3>Image library</h3><button class="b sm" data-x="up">Upload new</button><button class="b sm" data-x="close">Close</button></div>
    <div class="mb"><p style="color:var(--e-muted)">Loading…</p></div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener('click', e => {
    if (e.target === m || e.target.dataset.x === 'close') close();
    if (e.target.dataset.x === 'up') { close(); pickFiles({ kind: 'lib', onPick }); }
    const b = e.target.closest('[data-img]'); if (b) { onPick(b.dataset.img); close(); }
  });
  try {
    const list = ((await gh('images')) || []).filter(f => f.type === 'file' && /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(f.name)).reverse();
    m.querySelector('.mb').innerHTML = list.length ? `<div class="lib">${list.map(f => `<button data-img="${esc(f.path)}"><img src="${esc(previewCache[f.path] || f.download_url)}" loading="lazy" alt=""><span>${esc(f.name)}</span></button>`).join('')}</div>`
      : '<p style="color:var(--e-muted)">No images yet. Paste or drop one into any editor, or click Upload new.</p>';
  } catch (e) { m.querySelector('.mb').innerHTML = `<p style="color:var(--e-danger)">${esc(e.message)}</p>`; }
}

/* ================= field builders (return HTML) ================= */
const lbl = (label, hint) => `<span>${label}${hint ? ` <em>${hint}</em>` : ''}</span>`;
function tx(label, p, o = {}) {
  let v = val(p); if (Array.isArray(v)) v = v.join(', ');
  return `<label class="f">${lbl(label, o.hint)}<input type="${o.type || 'text'}" data-path="${p}"${o.tags ? ' data-type="tags"' : ''} value="${esc(v ?? '')}" placeholder="${esc(o.ph || '')}"${o.list ? ` list="${o.list}"` : ''}${o.min != null ? ` min="${o.min}"` : ''}></label>`;
}
function area(label, p, o = {}) {
  return `<label class="f">${lbl(label, o.hint)}<textarea data-path="${p}" rows="${o.rows || 3}" class="${o.cls || ''}" placeholder="${esc(o.ph || '')}" spellcheck="${o.cls === 'mono' ? 'false' : 'true'}">${esc(val(p) ?? '')}</textarea></label>`;
}
function choose(label, p, opts, hint) {
  const v = String(val(p) ?? '');
  const o = opts.map(x => Array.isArray(x) ? x : [x, x]).map(([a, b]) => `<option value="${esc(a)}"${String(a) === v ? ' selected' : ''}>${esc(b)}</option>`).join('');
  return `<label class="f">${lbl(label, hint)}<select data-path="${p}">${o}</select></label>`;
}
function fontChoose(label, p, groups) {
  const v = val(p);
  const o = Object.entries(groups).map(([g, list]) => `<optgroup label="${g}">${list.map(f => `<option${f === v ? ' selected' : ''}>${f}</option>`).join('')}</optgroup>`).join('');
  return `<label class="f">${lbl(label)}<select data-path="${p}">${o}</select></label>`;
}
const check = (label, p) => `<label class="chk"><input type="checkbox" data-path="${p}"${val(p) ? ' checked' : ''}> ${label}</label>`;
function fmtRange(v, unit) { return unit === '%em' ? (v > 0 ? '+' : '') + v + '%' : v + (unit || ''); }
function range(label, p, min, max, step, unit, hint) {
  const v = val(p);
  return `<label class="f">${lbl(label, hint)}<div class="range"><input type="range" min="${min}" max="${max}" step="${step}" data-path="${p}" value="${esc(v)}"><output data-out="${p}" data-unit="${unit || ''}">${fmtRange(v, unit)}</output></div></label>`;
}
function color(label, p, o = {}) {
  const v = val(p) || '';
  return `<label class="f">${lbl(label, o.hint)}<div class="color"><input type="color" data-path="${p}" value="${/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'}"><input type="text" data-path="${p}" value="${esc(v)}" placeholder="${esc(o.ph || '#rrggbb')}">${o.clear ? `<button type="button" class="b sm" data-action="set" data-path="${p}" data-val="">Clear</button>` : ''}</div></label>`;
}
function image(label, p, hint) {
  const v = val(p) || '';
  return `<label class="f">${lbl(label, hint || 'paste, drop or upload')}<div class="imgf" data-path="${p}"><div class="thumb"${thumbStyle(v)}></div>
    <input type="text" data-path="${p}" value="${esc(v)}" placeholder="images/… or https://…">
    <button type="button" class="b sm" data-action="img-up" data-path="${p}">Upload</button>
    <button type="button" class="b sm" data-action="img-lib" data-path="${p}">Library</button>
    <button type="button" class="b sm ic" data-action="set" data-path="${p}" data-val="" title="Remove">✕</button></div></label>`;
}
function rowsEd(listPath, ph1, ph2, addLabel = '+ Add link') {
  const list = val(listPath) || [];
  return `<div class="rows">${list.map((r, i) => `<div class="rowi">
      <input type="text" data-path="${listPath}.${i}.label" value="${esc(r.label || '')}" placeholder="${esc(ph1)}">
      <input type="text" data-path="${listPath}.${i}.url" value="${esc(r.url || '')}" placeholder="${esc(ph2)}">
      <div class="acts"><button type="button" class="b sm ic" data-action="row-up" data-list="${listPath}" data-i="${i}" title="Move up">↑</button><button type="button" class="b sm ic" data-action="row-del" data-list="${listPath}" data-i="${i}" title="Remove">✕</button></div></div>`).join('')}
    <div><button type="button" class="b sm" data-action="row-add" data-list="${listPath}">${addLabel}</button></div></div>`;
}
const MD_TOOLS = [['H2', 'h2'], ['H3', 'h3'], ['<b>B</b>', 'bold'], ['<i>I</i>', 'italic'], ['<s>S</s>', 'strike'], '|',
  ['Link', 'link'], ['Quote', 'quote'], ['• List', 'ul'], ['1. List', 'ol'], ['☐ Tasks', 'task'], '|',
  ['Code', 'code'], ['{ } Block', 'codeblock'], ['Table', 'table'], ['∑ Math', 'math'], ['∑ Block', 'mathblock'], ['Callout', 'callout'], ['— Line', 'hr'], '|',
  ['🖼 Image', 'image'], ['Library', 'library'], ['▶ YouTube', 'youtube']];
function md(p, o = {}) {
  const tools = MD_TOOLS.map(t => t === '|' ? '<span class="sep"></span>' : `<button type="button" data-md="${t[1]}">${t[0]}</button>`).join('');
  const v = String(val(p) ?? '');
  return `${o.label ? `<label class="f" style="margin-bottom:5px">${lbl(o.label, o.hint)}</label>` : ''}<div class="md-wrap ${o.big ? 'big' : ''}"><div class="md-tools">${tools}</div>
    <textarea class="md" data-path="${p}" rows="${o.rows || 6}" placeholder="Write in Markdown. Paste or drop images straight in.">${esc(v)}</textarea>
    <div class="md-foot"><span>Markdown · paste/drop images · $math$</span><span class="wc">${words(v)}</span></div></div>`;
}
const words = s => { const n = (String(s).match(/\S+/g) || []).length; return n + ' word' + (n === 1 ? '' : 's'); };

/* ================= markdown toolbar ================= */
function insertText(ta, text, selectFrom, selectTo) {
  ta.focus();
  const s = ta.selectionStart;
  ta.setRangeText(text, s, ta.selectionEnd, 'end');
  if (selectFrom != null) ta.setSelectionRange(s + selectFrom, s + selectTo);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
function wrap(ta, l, r = l, fallback = 'text') {
  const s = ta.selectionStart, e = ta.selectionEnd, t = ta.value.slice(s, e) || fallback;
  insertText(ta, l + t + r, l.length, l.length + t.length);
}
function prefixLines(ta, pre) {
  const v = ta.value, s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let e = v.indexOf('\n', ta.selectionEnd); if (e < 0) e = v.length;
  const lines = v.slice(s, e).split('\n').map((l, i) => (typeof pre === 'function' ? pre(i) : pre) + l);
  ta.setSelectionRange(s, e); insertText(ta, lines.join('\n'));
}
function block(ta, text, selA, selB) {
  const before = ta.value.slice(0, ta.selectionStart);
  const pad = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  insertText(ta, pad + text + '\n', selA != null ? pad.length + selA : null, selB != null ? pad.length + selB : null);
}
function mdCommand(ta, cmd) {
  const path = ta.dataset.path;
  switch (cmd) {
    case 'h2': return prefixLines(ta, '## ');
    case 'h3': return prefixLines(ta, '### ');
    case 'bold': return wrap(ta, '**');
    case 'italic': return wrap(ta, '*');
    case 'strike': return wrap(ta, '~~');
    case 'code': return wrap(ta, '`', '`', 'code');
    case 'math': return wrap(ta, '$', '$', 'V_{GS}');
    case 'quote': return prefixLines(ta, '> ');
    case 'ul': return prefixLines(ta, '- ');
    case 'ol': return prefixLines(ta, i => `${i + 1}. `);
    case 'task': return prefixLines(ta, '- [ ] ');
    case 'hr': return block(ta, '---');
    case 'codeblock': return block(ta, '```python\n\n```', 10, 10);
    case 'mathblock': return block(ta, '$$\nP = I_D^2 \\, R_{DS(on)}\n$$', 3, 26);
    case 'table': return block(ta, '| Parameter | Value | Unit |\n|---|---|---|\n| V_DS | 650 | V |\n| R_DS(on) |  | mΩ |');
    case 'callout': {
      const kind = (prompt('Callout type: NOTE, TIP, IMPORTANT, WARNING or CAUTION', 'NOTE') || '').toUpperCase().trim();
      if (!kind) return;
      return block(ta, `> [!${['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].includes(kind) ? kind : 'NOTE'}]\n> Your text here`, 0, 0);
    }
    case 'link': {
      const url = prompt('Link address (https://…)'); if (!url) return;
      const s = ta.selectionStart, e = ta.selectionEnd, t = ta.value.slice(s, e) || 'link text';
      return insertText(ta, `[${t}](${url})`, 1, 1 + t.length);
    }
    case 'youtube': {
      const url = prompt('YouTube link'); if (!url) return;
      return block(ta, `@[youtube](${url.trim()})`);
    }
    case 'image': return pickFiles({ kind: 'md', ta, path });
    case 'library': return openLibrary(p => block(ta, `![](${p})`));
  }
}

/* ================= tabs ================= */
const NEW_PROJECT = () => ({
  id: '', title: '', date: new Date().toISOString().slice(0, 7), status: 'In progress', tags: [], summary: '', cover: '', accent: '', links: [],
  body: '## Overview\n\nWhat is it, and why did you build it?\n\n## How it works\n\n## Results\n\n## What I learned\n', draft: true, pinned: false
});
const NEW_SECTION = {
  hero: () => ({ type: 'hero', anchor: '', enabled: true, kicker: '', title: '', body: '', image: '', imageShape: 'rounded', layout: 'split', background: 'gradient', bgImage: '', buttons: [] }),
  markdown: () => ({ type: 'markdown', anchor: '', enabled: true, title: 'New section', width: 'narrow', style: 'plain', align: 'left', body: '' }),
  projects: () => ({ type: 'projects', anchor: '', enabled: true, title: 'Projects', subtitle: '', layout: 'grid', showFilters: true, tag: '', limit: 0 }),
  links: () => ({ type: 'links', anchor: '', enabled: true, title: 'Contact', body: '', style: 'cards', align: 'left' })
};
const TYPE_LABEL = { hero: 'Hero', markdown: 'Text', projects: 'Projects', links: 'Links' };

function projectsTab() {
  const ps = S.data.projects;
  if (S.cur >= ps.length) S.cur = ps.length - 1;
  if (S.cur < 0) S.cur = 0;
  const items = sortProjects(ps).map(p => {
    const i = ps.indexOf(p);
    return `<button class="pitem ${i === S.cur ? 'on' : ''}" data-action="proj-open" data-i="${i}" data-q="${esc((p.title + ' ' + (p.tags || []).join(' ')).toLowerCase())}">
      <div class="th"${thumbStyle(p.cover)}></div><div style="min-width:0"><b data-ttl="${i}">${esc(p.title || 'Untitled')}</b>
      <small>${esc([fmtDate(p.date), p.status].filter(Boolean).join(' · '))}${p.draft ? '<span class="tag draft">Draft</span>' : ''}${p.pinned ? '<span class="tag">Pinned</span>' : ''}</small></div></button>`;
  }).join('');
  const p = ps[S.cur], b = `projects.${S.cur}`;
  const list = `<div class="card"><div class="hd"><h2>Projects</h2><button class="b p sm" data-action="proj-new">+ New project</button></div>
    ${ps.length > 5 ? `<input type="text" id="projSearch" placeholder="Search projects…" value="${esc(S.q)}">` : ''}
    <div class="plist">${items || '<p style="color:var(--e-muted);margin:6px 0">No projects yet. Click <b>+ New project</b>.</p>'}</div></div>`;
  if (!p) return list;
  return list + `
  <div class="card">
    <div class="hd"><h2 id="pTitle">${esc(p.title || 'Untitled')}</h2><div style="display:flex;gap:6px"><button class="b sm" data-action="proj-dup">Duplicate</button><button class="b sm d" data-action="proj-del">Delete</button></div></div>
    ${tx('Title', b + '.title', { ph: 'e.g. ESP32 Mountain Weather Texter' })}
    <div class="g3">${tx('URL slug', b + '.id', { hint: 'auto' })}${tx('Date', b + '.date', { type: 'month' })}${tx('Status', b + '.status', { list: 'statusList' })}</div>
    ${tx('Tags', b + '.tags', { hint: 'comma separated', tags: true, ph: 'Power electronics, Python' })}
    ${tx('One-line summary', b + '.summary', { hint: 'shown on the card' })}
    ${image('Cover image', b + '.cover')}
    ${color('Accent color', b + '.accent', { hint: 'optional, this project only', ph: 'site accent', clear: true })}
    <div class="g2">${check('Draft (hidden from the public site)', b + '.draft')}${check('Pin to the top', b + '.pinned')}</div>
  </div>
  <div class="card"><h3>Links</h3><p class="sub">Buttons at the top of the project page: code, paper, video, demo…</p>${rowsEd(b + '.links', 'GitHub', 'https://…')}</div>
  <div class="card"><h3>Write-up</h3><p class="sub">Paste screenshots right in. Use the Design tab to change how it looks.</p>${md(b + '.body', { big: true, rows: 22 })}</div>
  <datalist id="statusList"><option>Completed</option><option>In progress</option><option>Ongoing</option><option>Planning</option><option>Archived</option></datalist>`;
}

function sectionEd(s, i) {
  const b = `site.sections.${i}`;
  const anchorF = tx('Anchor', b + '.anchor', { hint: 'nav links use #anchor', ph: 'about' });
  let body = '';
  if (s.type === 'hero') body = `
    <div class="g2">${tx('Small label above title', b + '.kicker', { ph: 'Electrical Engineering' })}${tx('Title', b + '.title', { ph: S.data.site.name })}</div>
    ${md(b + '.body', { label: 'Intro text', rows: 4 })}
    <div class="g2">${image('Photo / image', b + '.image')}${choose('Image shape', b + '.imageShape', [['rounded', 'Rounded'], ['circle', 'Circle'], ['square', 'Square'], ['wide', 'Wide']])}</div>
    <div class="g2">${choose('Layout', b + '.layout', [['split', 'Text left, image right'], ['centered', 'Centered']])}${choose('Background', b + '.background', [['gradient', 'Accent glow'], ['plain', 'Plain'], ['image', 'Image']])}</div>
    ${s.background === 'image' ? image('Background image', b + '.bgImage') : ''}
    <label class="f"><span>Buttons <em>(first one is highlighted)</em></span></label>${rowsEd(b + '.buttons', 'See my projects', '#projects', '+ Add button')}
    ${anchorF}`;
  else if (s.type === 'projects') body = `
    <div class="g2">${tx('Title', b + '.title')}${anchorF}</div>
    ${tx('Subtitle', b + '.subtitle')}
    <div class="g3">${choose('Layout', b + '.layout', [['grid', 'Card grid'], ['list', 'Wide list'], ['compact', 'Compact (no images)']])}${tx('Only show tag', b + '.tag', { ph: 'all projects' })}${tx('Max shown', b + '.limit', { type: 'number', min: 0, hint: '0 = all' })}</div>
    ${check('Show tag filter buttons', b + '.showFilters')}`;
  else if (s.type === 'links') body = `
    <div class="g2">${tx('Title', b + '.title')}${anchorF}</div>
    ${md(b + '.body', { label: 'Text above the links', rows: 3 })}
    <div class="g2">${choose('Style', b + '.style', [['cards', 'Cards'], ['buttons', 'Buttons']])}${choose('Align', b + '.align', [['left', 'Left'], ['center', 'Center']])}</div>
    <p class="sub" style="color:var(--e-muted);font-size:12.5px;margin-top:10px">Shows the links from <b>Your links</b> above.</p>`;
  else body = `
    <div class="g2">${tx('Title', b + '.title', { ph: 'optional' })}${anchorF}</div>
    <div class="g3">${choose('Width', b + '.width', [['narrow', 'Narrow (reading)'], ['wide', 'Full width']])}${choose('Background', b + '.style', [['plain', 'Plain'], ['band', 'Panel band']])}${choose('Align', b + '.align', [['left', 'Left'], ['center', 'Center']])}</div>
    ${md(b + '.body', { label: 'Content', rows: 10 })}`;
  return `<details class="sec ${s.enabled === false ? 'off' : ''}" data-i="${i}"${S.open.has(s) ? ' open' : ''}>
    <summary><span class="ty">${TYPE_LABEL[s.type] || s.type}</span><span class="nm" data-snm="${i}">${esc(s.title || s.kicker || TYPE_LABEL[s.type])}</span><span style="color:var(--e-muted);font-size:12px">${s.enabled === false ? 'hidden' : ''}</span></summary>
    <div class="bd"><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px">
      ${check('Visible', b + '.enabled').replace('class="chk"', 'class="chk" style="margin:0 auto 0 0"')}
      <button class="b sm" data-action="sec-up" data-i="${i}">↑ Move up</button><button class="b sm" data-action="sec-down" data-i="${i}">↓ Move down</button>
      <button class="b sm" data-action="sec-dup" data-i="${i}">Duplicate</button><button class="b sm d" data-action="sec-del" data-i="${i}">Delete</button></div>
    ${body}</div></details>`;
}
function homeTab() {
  const anchors = S.data.site.sections.map(s => s.anchor).filter(Boolean).map(a => '#' + a).join(', ');
  return `
  <div class="card"><h3>Identity</h3>
    <div class="g2">${tx('Your name / site title', 'site.name')}${tx('Tagline', 'site.tagline', { hint: 'browser tab & search results' })}</div>
    ${image('Profile photo or logo', 'site.avatar', 'shown in the header and as the tab icon')}
    ${tx('Footer text', 'site.footer')}</div>
  <div class="card"><h3>Menu</h3><p class="sub">Links in the top bar. ${anchors ? `Jump to a section with: ${esc(anchors)}` : ''}</p>${rowsEd('site.nav', 'Projects', '#projects or https://…')}</div>
  <div class="card"><h3>Your links</h3><p class="sub">Email, LinkedIn, GitHub, résumé… Shown in the footer and the Links section. Use <code>mailto:you@uvm.edu</code> for email.</p>${rowsEd('site.socials', 'LinkedIn', 'https://…')}</div>
  <div class="hd" style="margin-top:20px"><h2>Page sections</h2></div>
  <p style="color:var(--e-muted);margin:-4px 0 12px">Your home page, top to bottom. Click one to edit it.</p>
  ${S.data.site.sections.map(sectionEd).join('')}
  <div class="card"><h3>Add a section</h3><div class="addrow" style="margin-top:8px">
    <button class="b" data-action="sec-add" data-type="markdown">+ Text / images</button>
    <button class="b" data-action="sec-add" data-type="projects">+ Projects grid</button>
    <button class="b" data-action="sec-add" data-type="links">+ Links</button>
    <button class="b" data-action="sec-add" data-type="hero">+ Hero banner</button></div></div>`;
}

const PRESETS = {
  Clean: { mode: 'auto', light: { bg: '#f7f6f3', surface: '#ffffff', text: '#1b1d21', muted: '#6b6f76', line: '#e3e1dc', accent: '#0f766e', accentText: '#ffffff' },
    dark: { bg: '#0f1115', surface: '#171a20', text: '#e8e8e6', muted: '#9a9ea5', line: '#2a2e36', accent: '#2dd4bf', accentText: '#062a27' },
    fontHeading: 'Inter', fontBody: 'Inter', fontMono: 'JetBrains Mono', radius: 12, cardStyle: 'shadow', headingWeight: 700, tracking: -2, note: 'Calm and neutral' },
  Midnight: { mode: 'dark', light: { bg: '#f5f6fb', surface: '#ffffff', text: '#141833', muted: '#62678a', line: '#e0e3f0', accent: '#5b5bf0', accentText: '#ffffff' },
    dark: { bg: '#0b0d17', surface: '#131628', text: '#e6e8f5', muted: '#9096b8', line: '#252a45', accent: '#8b8bff', accentText: '#0b0d17' },
    fontHeading: 'Sora', fontBody: 'Inter', fontMono: 'JetBrains Mono', radius: 16, cardStyle: 'glass', headingWeight: 700, tracking: -3, note: 'Dark, glassy, techy' },
  Paper: { mode: 'light', light: { bg: '#fbf8f1', surface: '#fffdf8', text: '#2a2620', muted: '#7a7163', line: '#e8e0d0', accent: '#b4532a', accentText: '#ffffff' },
    dark: { bg: '#1a1714', surface: '#221e1a', text: '#ece4d6', muted: '#a89d8b', line: '#3a332b', accent: '#e0895e', accentText: '#1a1714' },
    fontHeading: 'Fraunces', fontBody: 'Source Serif 4', fontMono: 'IBM Plex Mono', radius: 6, cardStyle: 'outline', headingWeight: 700, tracking: -1, note: 'Editorial, like a journal' },
  Circuit: { mode: 'dark', light: { bg: '#f3f6f2', surface: '#ffffff', text: '#0f1a12', muted: '#5b6b5f', line: '#d9e3da', accent: '#15803d', accentText: '#ffffff' },
    dark: { bg: '#07100a', surface: '#0d1a11', text: '#d8f3df', muted: '#7fa58a', line: '#1d3324', accent: '#4ade80', accentText: '#05230f' },
    fontHeading: 'Space Grotesk', fontBody: 'IBM Plex Sans', fontMono: 'IBM Plex Mono', radius: 4, cardStyle: 'outline', headingWeight: 700, tracking: -2, note: 'PCB green, engineering' },
  Copper: { mode: 'auto', light: { bg: '#f6f1ec', surface: '#ffffff', text: '#231a14', muted: '#7d6c5f', line: '#e7dcd2', accent: '#c2410c', accentText: '#ffffff' },
    dark: { bg: '#14100d', surface: '#1d1814', text: '#f1e6dc', muted: '#ab9a8c', line: '#33291f', accent: '#fb923c', accentText: '#1d0f04' },
    fontHeading: 'Manrope', fontBody: 'Manrope', fontMono: 'JetBrains Mono', radius: 14, cardStyle: 'shadow', headingWeight: 700, tracking: -2, note: 'Warm and friendly' },
  Mono: { mode: 'auto', light: { bg: '#ffffff', surface: '#ffffff', text: '#111111', muted: '#666666', line: '#e5e5e5', accent: '#111111', accentText: '#ffffff' },
    dark: { bg: '#0a0a0a', surface: '#111111', text: '#f5f5f5', muted: '#9a9a9a', line: '#262626', accent: '#f5f5f5', accentText: '#0a0a0a' },
    fontHeading: 'DM Sans', fontBody: 'DM Sans', fontMono: 'JetBrains Mono', radius: 0, cardStyle: 'outline', headingWeight: 700, tracking: -3, note: 'Black & white, minimal' }
};
const FONTS = {
  Sans: ['Inter', 'Manrope', 'DM Sans', 'Plus Jakarta Sans', 'Space Grotesk', 'IBM Plex Sans', 'Source Sans 3', 'Work Sans', 'Outfit', 'Sora'],
  Serif: ['Fraunces', 'Playfair Display', 'Lora', 'Source Serif 4', 'Merriweather', 'Newsreader'],
  Other: ['System']
};
const MONO = { Mono: ['JetBrains Mono', 'IBM Plex Mono', 'Fira Code', 'Space Mono'], Other: ['System'] };
const COLOR_KEYS = [['bg', 'Page background'], ['surface', 'Cards & panels'], ['text', 'Text'], ['muted', 'Secondary text'], ['line', 'Borders'], ['accent', 'Accent'], ['accentText', 'Text on accent']];

function designTab() {
  const t = 'site.theme';
  const presets = Object.entries(PRESETS).map(([n, p]) => {
    const pal = p.mode === 'dark' ? p.dark : p.light;
    return `<button class="preset" data-action="preset" data-name="${n}"><div class="sw"><i style="background:${pal.bg}"></i><i style="background:${pal.surface}"></i><i style="background:${pal.accent}"></i><i style="background:${pal.text}"></i></div><b>${n}</b><small>${p.note}</small></button>`;
  }).join('');
  const colorCol = m => COLOR_KEYS.map(([k, l]) => color(l, `${t}.${m}.${k}`)).join('');
  return `
  <div class="card"><h3>Start from a style</h3><p class="sub">One click sets colors, fonts and shapes. Then fine-tune anything below.</p><div class="presets">${presets}</div></div>
  <div class="card"><h3>Light &amp; dark</h3>
    <div class="g2">${choose('Color mode', t + '.mode', [['auto', "Follow the visitor's device"], ['light', 'Always light'], ['dark', 'Always dark']])}<div>${check('Show a light/dark switch in the menu', t + '.toggle')}</div></div>
    <p class="sub" style="color:var(--e-muted);font-size:12.5px;margin-top:10px">Use the Light / Dark buttons above the preview to check both.</p></div>
  <div class="card"><h3>Colors</h3><div class="g2"><div><h4 style="margin:10px 0 0">☀️ Light</h4>${colorCol('light')}</div><div><h4 style="margin:10px 0 0">🌙 Dark</h4>${colorCol('dark')}</div></div></div>
  <div class="card"><h3>Typography</h3>
    <div class="g3">${fontChoose('Headings', t + '.fontHeading', FONTS)}${fontChoose('Body text', t + '.fontBody', FONTS)}${fontChoose('Code', t + '.fontMono', MONO)}</div>
    <div class="g3">${range('Text size', t + '.baseSize', 14, 20, 1, 'px')}${choose('Heading weight', t + '.headingWeight', [[400, 'Regular'], [700, 'Bold']])}${range('Heading spacing', t + '.tracking', -6, 4, 1, '%em')}</div></div>
  <div class="card"><h3>Layout &amp; shape</h3>
    <div class="g3">${range('Page width', t + '.width', 720, 1440, 20, 'px')}${range('Corner roundness', t + '.radius', 0, 32, 1, 'px')}${range('Space between sections', t + '.spacing', 40, 160, 4, 'px')}</div>
    <div class="g2">${choose('Card style', t + '.cardStyle', [['shadow', 'Soft shadow'], ['outline', 'Outline'], ['flat', 'Flat'], ['glass', 'Glass']])}${choose('Card image shape', t + '.cardRatio', [['16 / 9', 'Widescreen 16:9'], ['3 / 2', 'Photo 3:2'], ['4 / 3', 'Classic 4:3'], ['1 / 1', 'Square'], ['none', 'No images on cards']])}</div></div>
  <div class="card"><h3>Custom CSS</h3><p class="sub">For anything the controls above don't cover. It's applied on top of everything.</p>
    ${area('', t + '.customCSS', { rows: 8, cls: 'mono', ph: '/* examples */\n.hero h1 { text-transform: uppercase; }\n.card h3 { color: var(--accent); }' })}</div>`;
}
function settingsTab() {
  const c = S.cfg;
  return `
  <div class="card"><h3>Connection</h3><p class="sub">Saving to <b>${esc(c.owner)}/${esc(c.repo)}</b> on branch <b>${esc(c.branch)}</b>.</p>
    <div class="addrow"><button class="b" data-action="disconnect">Disconnect &amp; forget token</button></div></div>
  <div class="card"><h3>Backup</h3><p class="sub">Your whole site (text, settings, image paths) is one file. Download a copy any time.</p>
    <div class="addrow"><button class="b" data-action="export">Download backup</button><button class="b" data-action="import">Restore from backup…</button>
    <button class="b" data-action="discard">Discard unpublished changes</button><button class="b d" data-action="reset-design">Reset design to default</button></div></div>
  <div class="card help"><h3>Formatting cheat sheet</h3><table>
    <tr><td><code>## Heading</code></td><td>Section heading (<code>###</code> for smaller)</td></tr>
    <tr><td><code>**bold**</code> <code>*italic*</code></td><td>Emphasis</td></tr>
    <tr><td><code>[text](https://…)</code></td><td>Link</td></tr>
    <tr><td><code>![alt](images/x.png "Caption")</code></td><td>Image; the quoted part becomes a caption</td></tr>
    <tr><td><code>&lt;img src="images/x.png" width="320"&gt;</code></td><td>Image at a set size</td></tr>
    <tr><td><code>$V_{GS}$</code> / <code>$$ … $$</code></td><td>Inline / display equations (LaTeX)</td></tr>
    <tr><td><code>\`\`\`python</code> … <code>\`\`\`</code></td><td>Code block with syntax colors</td></tr>
    <tr><td><code>&gt; [!WARNING]</code></td><td>Callout box (NOTE, TIP, IMPORTANT, WARNING, CAUTION)</td></tr>
    <tr><td><code>@[youtube](link)</code></td><td>Embedded YouTube video</td></tr>
    <tr><td><code>- [ ] task</code></td><td>Checklist</td></tr>
    <tr><td><code>---</code></td><td>Divider line</td></tr></table>
    <p class="sub" style="color:var(--e-muted);margin-top:10px">Shortcuts: Ctrl/⌘+S publish · Ctrl/⌘+B bold · Ctrl/⌘+I italic · Ctrl/⌘+K link</p></div>`;
}

function renderTab(keepScroll) {
  const pane = $('pane'), y = pane.scrollTop;
  pane.innerHTML = S.tab === 'projects' ? projectsTab() : S.tab === 'home' ? homeTab() : S.tab === 'design' ? designTab() : settingsTab();
  if (keepScroll) pane.scrollTop = y;
  schedulePreview();
}
function switchTab(tab) {
  S.tab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  renderTab(false); $('pane').scrollTop = 0;
  refreshPreview();
}

/* ================= editing (one listener for every field) ================= */
function readVal(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'range' || el.type === 'number') return el.value === '' ? 0 : Number(el.value);
  if (el.dataset.type === 'tags') return el.value.split(',').map(s => s.trim()).filter(Boolean);
  if (el.tagName === 'SELECT' && /^\d+$/.test(el.value) && /headingWeight/.test(el.dataset.path)) return Number(el.value);
  return el.value;
}
function onEdit(e) {
  const el = e.target;
  if (el.id === 'projSearch') {
    S.q = el.value.toLowerCase();
    document.querySelectorAll('.pitem').forEach(b => b.classList.toggle('hidden', !!S.q && !b.dataset.q.includes(S.q)));
    return;
  }
  const p = el.dataset && el.dataset.path; if (!p) return;
  let v = readVal(el);
  if (el.type === 'color' && e.type === 'input') v = el.value;
  if (/^projects\.\d+\.id$/.test(p)) {
    S.autoSlug.delete(S.data.projects[+p.split('.')[1]]);
    if (e.type === 'change') { v = slugify(v); el.value = v; }
  }
  if (JSON.stringify(val(p)) === JSON.stringify(v)) return;
  if (el.type === 'text' && el.parentElement.classList.contains('color') && v && !/^#[0-9a-f]{6}$/i.test(v) && e.type === 'input') {
    setPath(S.data, p, v); changed(); return;          // let them finish typing a hex
  }
  setPath(S.data, p, v);

  // keep twin inputs (color picker + hex box, etc.) in sync
  document.querySelectorAll(sel(p)).forEach(o => {
    if (o === el) return;
    if (o.type === 'checkbox') o.checked = !!v;
    else if (o.type === 'color') { if (/^#[0-9a-f]{6}$/i.test(v)) o.value = v; }
    else o.value = Array.isArray(v) ? v.join(', ') : v;
  });
  document.querySelectorAll(`[data-out="${CSS.escape(p)}"]`).forEach(o => o.textContent = fmtRange(v, o.dataset.unit));
  document.querySelectorAll(`.imgf[data-path="${CSS.escape(p)}"] .thumb`).forEach(t => t.style.backgroundImage = v ? `url("${rawUrl(v)}")` : '');
  if (el.classList.contains('md')) { const wc = el.closest('.md-wrap')?.querySelector('.wc'); if (wc) wc.textContent = words(v); }

  let m;
  if ((m = p.match(/^projects\.(\d+)\.title$/))) {
    const proj = S.data.projects[+m[1]];
    if (S.autoSlug.has(proj)) { proj.id = slugify(v); document.querySelectorAll(sel(`projects.${m[1]}.id`)).forEach(o => o.value = proj.id); }
    const t = $('pTitle'); if (t) t.textContent = v || 'Untitled';
    const li = document.querySelector(`[data-ttl="${m[1]}"]`); if (li) li.textContent = v || 'Untitled';
  }
  if ((m = p.match(/^site\.sections\.(\d+)\.(title|kicker)$/))) {
    const s = S.data.site.sections[+m[1]]; const n = document.querySelector(`[data-snm="${m[1]}"]`);
    if (n) n.textContent = s.title || s.kicker || TYPE_LABEL[s.type];
  }
  const structural = (/\.(enabled|background)$/.test(p) && p.startsWith('site.sections')) || /^projects\.\d+\.(draft|pinned)$/.test(p);
  changed();
  if (structural) renderTab(true);
}

function onAction(e) {
  const a = e.target.closest('[data-action]'); if (!a) return;
  const act = a.dataset.action, ps = S.data.projects, secs = S.data.site.sections;
  const list = a.dataset.list ? (val(a.dataset.list) || (setPath(S.data, a.dataset.list, []), val(a.dataset.list))) : null;
  const i = a.dataset.i != null ? +a.dataset.i : null;
  const swap = (arr, x, y) => { if (y < 0 || y >= arr.length) return false; [arr[x], arr[y]] = [arr[y], arr[x]]; return true; };
  switch (act) {
    case 'proj-open': S.cur = i; renderTab(true); refreshPreview(); return;
    case 'proj-new': { const p = NEW_PROJECT(); ps.push(p); S.autoSlug.add(p); S.cur = ps.length - 1; changed(); renderTab(false); setTimeout(() => document.querySelector(sel(`projects.${S.cur}.title`))?.focus(), 0); return; }
    case 'proj-dup': { const c = JSON.parse(JSON.stringify(ps[S.cur])); c.title += ' (copy)'; c.id = (c.id || 'project') + '-copy'; c.draft = true; ps.push(c); S.cur = ps.length - 1; changed(); renderTab(false); return; }
    case 'proj-del': if (!confirm(`Delete "${ps[S.cur].title || 'Untitled'}"? (It disappears from the site when you publish. Images stay in your library.)`)) return;
      ps.splice(S.cur, 1); S.cur = 0; changed(); renderTab(false); return;
    case 'row-add': list.push({ label: '', url: '' }); changed(); renderTab(true); return;
    case 'row-del': list.splice(i, 1); changed(); renderTab(true); return;
    case 'row-up': if (swap(list, i, i - 1)) { changed(); renderTab(true); } return;
    case 'sec-add': { const s = NEW_SECTION[a.dataset.type](); secs.push(s); S.open.add(s); changed(); renderTab(true); return; }
    case 'sec-up': if (swap(secs, i, i - 1)) { changed(); renderTab(true); } return;
    case 'sec-down': if (swap(secs, i, i + 1)) { changed(); renderTab(true); } return;
    case 'sec-dup': { const c = JSON.parse(JSON.stringify(secs[i])); c.anchor = c.anchor ? c.anchor + '-2' : ''; secs.splice(i + 1, 0, c); S.open.add(c); changed(); renderTab(true); return; }
    case 'sec-del': if (confirm('Delete this section?')) { secs.splice(i, 1); changed(); renderTab(true); } return;
    case 'set': setField(a.dataset.path, a.dataset.val); return;
    case 'img-up': return pickFiles({ kind: 'field', path: a.dataset.path });
    case 'img-lib': return openLibrary(p => setField(a.dataset.path, p));
    case 'preset': {
      const pr = JSON.parse(JSON.stringify(PRESETS[a.dataset.name])); delete pr.note;
      S.data.site.theme = deepMerge(S.data.site.theme, pr); changed(); renderTab(true); toast(`${a.dataset.name} style applied`); return;
    }
    case 'export': {
      const blob = new Blob([JSON.stringify(S.data, null, 2)], { type: 'application/json' });
      const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = `site-backup-${new Date().toISOString().slice(0, 10)}.json`; l.click(); return;
    }
    case 'import': $('jsonPick').value = ''; $('jsonPick').click(); return;
    case 'reset-design': if (confirm('Reset all colors, fonts and layout to the default style? (Your text and projects are kept.)')) { S.data.site.theme = JSON.parse(JSON.stringify(DEFAULT_SITE.theme)); changed(); renderTab(true); } return;
    case 'discard': if (!confirm('Throw away everything you haven\'t published and reload the live version?')) return;
      readRemote().then(r => { S.sha = r.sha; S.data = normalize(r.data); setDirty(false); clearLocal(); renderTab(false); setStatus('Reloaded the published version.'); }).catch(err => setStatus(err.message, 'err')); return;
    case 'disconnect': if (S.dirty && !confirm('You have unpublished changes (they stay saved on this computer). Disconnect anyway?')) return;
      store.del('se_token'); store.del('pe_token'); location.reload(); return;
  }
}
$('jsonPick').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!confirm('Replace everything in the editor with this backup? (Nothing goes live until you publish.)')) return; S.data = normalize(d); S.cur = 0; changed(); renderTab(false); toast('Backup loaded. Publish to make it live.'); }
  catch (err) { setStatus('That file is not a valid backup: ' + err.message, 'err'); }
});

/* ================= wiring ================= */
const pane = $('pane');
pane.addEventListener('input', onEdit);
pane.addEventListener('change', onEdit);
pane.addEventListener('click', e => {
  const t = e.target.closest('.md-tools button');
  if (t) { mdCommand(t.closest('.md-wrap').querySelector('textarea'), t.dataset.md); return; }
  onAction(e);
});
pane.addEventListener('toggle', e => {
  if (!e.target.matches || !e.target.matches('details.sec')) return;
  const s = S.data.site.sections[+e.target.dataset.i];
  if (s) e.target.open ? S.open.add(s) : S.open.delete(s);
}, true);
pane.addEventListener('keydown', e => {
  const ta = e.target; if (!ta.classList || !ta.classList.contains('md') || !(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'b' || k === 'i' || k === 'k') { e.preventDefault(); mdCommand(ta, { b: 'bold', i: 'italic', k: 'link' }[k]); }
});
pane.addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  const t = e.target;
  if (t.classList && t.classList.contains('md')) { e.preventDefault(); handleFiles(files, { kind: 'md', ta: t, path: t.dataset.path }); }
  else if (t.closest && t.closest('.imgf')) { e.preventDefault(); handleFiles(files, { kind: 'field', path: t.closest('.imgf').dataset.path }); }
});
['dragover', 'dragleave', 'drop'].forEach(ev => pane.addEventListener(ev, e => {
  const zone = e.target.closest && e.target.closest('.md-wrap, .imgf'); if (!zone) return;
  if (ev === 'dragover') { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); zone.classList.add('drag'); } return; }
  zone.classList.remove('drag');
  if (ev === 'drop' && e.dataTransfer.files.length) {
    e.preventDefault();
    if (zone.classList.contains('imgf')) handleFiles(e.dataTransfer.files, { kind: 'field', path: zone.dataset.path });
    else { const ta = zone.querySelector('textarea'); handleFiles(e.dataTransfer.files, { kind: 'md', ta, path: ta.dataset.path }); }
  }
}));
$('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); });
$('publish').onclick = publish;
$('cGo').onclick = connect;
$('cToken').addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && S.data) { e.preventDefault(); publish(); }
});
window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ================= live preview ================= */
const pv = $('pv'); let pvReady = false, pvTimer;
function pvPage() { return S.tab === 'projects' && S.data.projects[S.cur] ? 'project.html' : 'index.html'; }
function refreshPreview() {
  if (!S.data) return;
  const page = pvPage();
  if (pv.dataset.page !== page) { pv.dataset.page = page; pvReady = false; pv.src = page + '?preview=1'; return; }
  sendPreview();
}
function schedulePreview() { clearTimeout(pvTimer); pvTimer = setTimeout(refreshPreview, 160); }
function sendPreview() {
  if (!pvReady || !pv.contentWindow) return;
  const p = S.data.projects[S.cur];
  pv.contentWindow.postMessage({ type: 'site-preview', data: S.data, images: previewCache, id: p ? p.id : null, mode: S.pvMode || undefined }, '*');
}
window.addEventListener('message', e => {
  if (e.source !== pv.contentWindow || !e.data) return;
  if (e.data.type === 'preview-ready') { pvReady = true; sendPreview(); }
  if (e.data.type === 'preview-open') {
    if (e.data.id == null) return switchTab('home');
    const i = S.data.projects.findIndex(p => p.id === e.data.id);
    if (i >= 0) { S.cur = i; switchTab('projects'); }
  }
});
$('pvDevice').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $('pvDevice').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  pv.style.width = b.dataset.w;
});
$('pvMode').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $('pvMode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  S.pvMode = b.dataset.m; sendPreview();
});
$('pvHide').onclick = () => {
  const main = $('main'); main.classList.toggle('nopv');
  let show = $('pvShow');
  if (!show) { show = document.createElement('button'); show.id = 'pvShow'; show.className = 'b'; show.textContent = 'Show preview'; show.onclick = () => { main.classList.remove('nopv'); show.classList.add('hidden'); }; $('viewSite').before(show); }
  show.classList.toggle('hidden', !main.classList.contains('nopv'));
};
// drag the divider to resize
$('divider').addEventListener('pointerdown', e => {
  e.preventDefault(); pv.style.pointerEvents = 'none';
  const move = ev => $('main').style.setProperty('--ed-w', Math.max(360, Math.min(ev.clientX, window.innerWidth - 320)) + 'px');
  const up = () => { pv.style.pointerEvents = ''; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
});

prefill();
})();
