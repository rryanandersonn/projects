// Renders the whole public site from projects.json.
// The editor (admin.html) uses the same code for its live preview.

const DEFAULT_SITE = {
  name: 'Ryan Anderson',
  tagline: 'Electrical Engineering',
  avatar: '',
  footer: '© Ryan Anderson',
  nav: [
    { label: 'Projects', url: '#projects' },
    { label: 'About', url: '#about' },
    { label: 'Contact', url: '#contact' }
  ],
  socials: [
    { label: 'Email', url: 'mailto:you@example.com' },
    { label: 'LinkedIn', url: 'https://www.linkedin.com/' },
    { label: 'GitHub', url: 'https://github.com/rryanandersonn' }
  ],
  sections: [
    { type: 'hero', anchor: 'top', enabled: true, kicker: 'Electrical Engineering · Power GaN',
      title: 'Ryan Anderson',
      body: 'Graduate student working on the reliability of high-voltage GaN devices, plus whatever hardware and software I build along the way.',
      image: '', imageShape: 'rounded', layout: 'split', background: 'gradient', bgImage: '',
      buttons: [{ label: 'See my projects', url: '#projects' }, { label: 'Get in touch', url: '#contact' }] },
    { type: 'projects', anchor: 'projects', enabled: true, title: 'Projects', subtitle: 'Detailed write-ups of research, hardware and software work.',
      layout: 'grid', showFilters: true, tag: '', limit: 0 },
    { type: 'markdown', anchor: 'about', enabled: true, title: 'About', width: 'narrow', style: 'plain',
      body: 'Write a few paragraphs about yourself here. Markdown works: **bold**, lists, images, equations like $V_{T0}$, and more.' },
    { type: 'links', anchor: 'contact', enabled: true, title: 'Contact', body: 'The best ways to reach me:', style: 'cards', align: 'left' }
  ],
  theme: {
    mode: 'auto', toggle: true,
    light: { bg: '#f7f6f3', surface: '#ffffff', text: '#1b1d21', muted: '#6b6f76', line: '#e3e1dc', accent: '#0f766e', accentText: '#ffffff' },
    dark: { bg: '#0f1115', surface: '#171a20', text: '#e8e8e6', muted: '#9a9ea5', line: '#2a2e36', accent: '#2dd4bf', accentText: '#062a27' },
    fontHeading: 'Inter', fontBody: 'Inter', fontMono: 'JetBrains Mono',
    baseSize: 16, headingWeight: 700, tracking: -2, radius: 12, width: 1080, spacing: 88,
    cardStyle: 'shadow', cardRatio: '16 / 9', customCSS: ''
  }
};

const SERIF_FONTS = ['Fraunces', 'Playfair Display', 'Lora', 'Source Serif 4', 'Merriweather', 'Newsreader', 'Instrument Serif'];
let IMAGE_MAP = {};   // editor preview only: freshly uploaded image path -> local copy

/* ---------- helpers ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const src = p => esc(IMAGE_MAP[p] || p);
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function deepMerge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k in over) out[k] = isObj(base[k]) && isObj(over[k]) ? deepMerge(base[k], over[k]) : over[k];
  return out;
}
function normalize(data) {
  data = data || {};
  return { site: deepMerge(JSON.parse(JSON.stringify(DEFAULT_SITE)), data.site || {}), projects: Array.isArray(data.projects) ? data.projects : [] };
}
function fmtDate(d) {
  if (!d) return '';
  const [y, m] = String(d).split('-');
  return m ? new Date(+y, +m - 1, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : y;
}
function sortProjects(list) {
  return [...list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.date || '').localeCompare(String(a.date || '')));
}
function linkHref(url, page) {
  url = String(url || '');
  return page !== 'home' && url.startsWith('#') ? './' + url : url;
}

/* ---------- theme ---------- */
function fontStack(name, kind) {
  if (!name || name === 'System') return kind === 'mono' ? 'ui-monospace, Menlo, Consolas, monospace' : 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const fallback = kind === 'mono' ? 'ui-monospace, monospace' : SERIF_FONTS.includes(name) ? 'Georgia, serif' : 'system-ui, sans-serif';
  return `"${name}", ${fallback}`;
}
function loadFonts(names) {
  const fams = [...new Set(names.filter(n => n && n !== 'System'))];
  const href = fams.length ? 'https://fonts.googleapis.com/css2?' + fams.map(f => 'family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':wght@400;700').join('&') + '&display=swap' : '';
  let l = document.getElementById('gfonts');
  if (!l) { l = document.createElement('link'); l.id = 'gfonts'; l.rel = 'stylesheet'; document.head.appendChild(l); }
  if (l.getAttribute('href') !== href) { if (href) l.href = href; else l.removeAttribute('href'); }
}
function pickMode(theme, forced) {
  if (forced === 'light' || forced === 'dark') return forced;
  let o = null; try { o = localStorage.getItem('site-mode'); } catch (e) {}
  if (theme.toggle && (o === 'light' || o === 'dark')) return o;
  if (theme.mode === 'light' || theme.mode === 'dark') return theme.mode;
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(theme, forced) {
  const mode = pickMode(theme, forced);
  const p = theme[mode] || theme.light;
  const r = document.documentElement;
  r.dataset.mode = mode;
  r.dataset.card = theme.cardStyle || 'shadow';
  r.dataset.cardimg = theme.cardRatio === 'none' ? 'none' : 'show';
  const vars = {
    '--bg': p.bg, '--surface': p.surface, '--text': p.text, '--muted': p.muted, '--line': p.line,
    '--accent': p.accent, '--accent-text': p.accentText,
    '--font-body': fontStack(theme.fontBody), '--font-heading': fontStack(theme.fontHeading), '--font-mono': fontStack(theme.fontMono, 'mono'),
    '--base': (theme.baseSize || 16) + 'px', '--hw': theme.headingWeight || 700, '--track': (theme.tracking ?? -2) / 100 + 'em',
    '--radius': (theme.radius ?? 12) + 'px', '--width': (theme.width || 1080) + 'px', '--space': (theme.spacing || 88) + 'px',
    '--card-ratio': theme.cardRatio && theme.cardRatio !== 'none' ? theme.cardRatio : '16 / 9'
  };
  for (const k in vars) if (vars[k] != null && vars[k] !== '') r.style.setProperty(k, vars[k]);
  loadFonts([theme.fontHeading, theme.fontBody, theme.fontMono]);
  let st = document.getElementById('custom-css');
  if (!st) { st = document.createElement('style'); st.id = 'custom-css'; document.head.appendChild(st); }
  st.textContent = theme.customCSS || '';
  return mode;
}

/* ---------- markdown ---------- */
function youtubeId(s) {
  s = String(s).trim();
  const m = s.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/) || s.match(/^([\w-]{11})$/);
  return m ? m[1] : null;
}
const CALLOUTS = { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' };

function renderMd(md) {
  md = String(md || '');
  const keep = [];
  const stash = s => { keep.push(s); return '\u0000K' + (keep.length - 1) + '\u0000'; };
  md = md.replace(/```[\s\S]*?```/g, stash).replace(/`[^`\n]+`/g, stash);           // protect code
  const math = [];
  const mstash = s => { math.push(s); return 'MATHTOKEN' + (math.length - 1) + 'END'; };
  md = md.replace(/\$\$[\s\S]+?\$\$/g, mstash).replace(/\$(?=\S)([^$\n]+?)(?<=\S)\$/g, mstash); // protect math
  const embeds = [];
  md = md.replace(/@\[youtube\]\(([^)\s]+)\)/gi, (_, u) => { embeds.push(youtubeId(u)); return '\n\nEMBEDTOKEN' + (embeds.length - 1) + 'END\n\n'; });
  md = md.replace(/\u0000K(\d+)\u0000/g, (_, i) => keep[+i]);
  let html = window.marked ? marked.parse(md) : '<p>' + esc(md).replace(/\n/g, '<br>') + '</p>';
  html = html.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br>)?/gi,
    (_, t) => `<blockquote class="callout callout-${t.toLowerCase()}"><p class="callout-title">${CALLOUTS[t.toUpperCase()]}</p><p>`);
  html = html.replace(/MATHTOKEN(\d+)END/g, (_, i) => esc(math[+i]));
  if (window.DOMPurify) html = DOMPurify.sanitize(html);
  html = html.replace(/(?:<p>)?EMBEDTOKEN(\d+)END(?:<\/p>)?/g, (_, i) => embeds[+i]
    ? `<div class="embed"><iframe src="https://www.youtube-nocookie.com/embed/${embeds[+i]}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>`
    : '');
  return html;
}
function postRender(el) {
  el.querySelectorAll('.prose img').forEach(img => {
    const s = img.getAttribute('src');
    if (IMAGE_MAP[s]) img.src = IMAGE_MAP[s];
    img.loading = 'lazy';
    const cap = img.getAttribute('title');
    if (cap && !img.closest('figure')) {
      const fig = document.createElement('figure');
      const host = img.parentElement.tagName === 'P' && img.parentElement.childNodes.length === 1 ? img.parentElement : img;
      host.replaceWith(fig); fig.appendChild(img);
      const fc = document.createElement('figcaption'); fc.textContent = cap; fig.appendChild(fc);
    }
  });
  if (window.renderMathInElement) {
    el.querySelectorAll('.prose').forEach(p => renderMathInElement(p, {
      delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false
    }));
  }
  if (window.hljs) el.querySelectorAll('.prose pre code').forEach(c => { try { hljs.highlightElement(c); } catch (e) {} });
}

/* ---------- pieces ---------- */
const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

function headerHTML(site, page, mode) {
  const nav = (site.nav || []).filter(n => n.label).map(n => `<a href="${esc(linkHref(n.url, page))}">${esc(n.label)}</a>`).join('');
  const toggle = site.theme.toggle ? `<button class="mode-btn" id="modeBtn" title="Switch light / dark">${mode === 'dark' ? ICON_SUN : ICON_MOON}</button>` : '';
  return `<header class="site-header"><div class="wrap">
    <a class="brand" href="./">${site.avatar ? `<img src="${src(site.avatar)}" alt="">` : ''}<span>${esc(site.name)}</span></a>
    <nav class="nav">${nav}</nav>${toggle}</div></header>`;
}
function footerHTML(site, page) {
  const links = (site.socials || []).filter(s => s.url).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label || s.url)}</a>`).join('');
  return `<footer class="site-footer"><div class="wrap"><p>${esc(site.footer)}</p><div class="foot-links">${links}</div></div></footer>`;
}
function buttonsHTML(list, page) {
  const b = (list || []).filter(x => x.label);
  return b.length ? `<div class="buttons">${b.map((x, i) => `<a class="btn ${i === 0 ? 'primary' : ''}" href="${esc(linkHref(x.url, page))}">${esc(x.label)}</a>`).join('')}</div>` : '';
}
function cardHTML(p, preview) {
  const meta = [fmtDate(p.date), p.status].filter(Boolean).map(esc).join(' · ');
  return `<a class="card" href="project.html?id=${encodeURIComponent(p.id)}" data-tags="${esc(JSON.stringify(p.tags || []))}"${p.accent ? ` style="--accent:${esc(p.accent)}"` : ''}>
    <div class="media">${p.cover ? `<img src="${src(p.cover)}" alt="" loading="lazy">` : ''}</div>
    <div class="body"><div class="meta">${meta}${preview && p.draft ? ' <span class="badge">Draft</span>' : ''}</div>
    <h3>${esc(p.title || 'Untitled')}</h3>${p.summary ? `<p>${esc(p.summary)}</p>` : ''}
    <div class="tags">${(p.tags || []).map(t => `<span>${esc(t)}</span>`).join('')}</div></div></a>`;
}

function sectionHTML(s, site, projects, opts) {
  const id = s.anchor ? ` id="${esc(s.anchor)}"` : '';
  const title = s.title ? `<h2 class="section-title">${esc(s.title)}</h2>` : '';
  switch (s.type) {
    case 'hero': {
      const bg = s.background || 'gradient';
      const style = bg === 'image' && s.bgImage ? ` style="--hero-img:url(&quot;${src(s.bgImage).replace(/"/g, '%22')}&quot;)"` : '';
      const media = s.image ? `<div class="hero-media"><img class="${esc(s.imageShape || 'rounded')}" src="${src(s.image)}" alt=""></div>` : '';
      return `<section class="hero bg-${esc(bg)} layout-${esc(s.layout || 'split')} ${media ? '' : 'no-media'}"${id}${style}><div class="wrap hero-inner">
        <div class="hero-text">${s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : ''}<h1>${esc(s.title || site.name)}</h1>
        <div class="hero-body prose">${renderMd(s.body)}</div>${buttonsHTML(s.buttons, 'home')}</div>${media}</div></section>`;
    }
    case 'projects': {
      let list = s.tag ? projects.filter(p => (p.tags || []).includes(s.tag)) : projects;
      if (s.limit > 0) list = list.slice(0, s.limit);
      const tags = [...new Set(list.flatMap(p => p.tags || []))].sort();
      const chips = s.showFilters && tags.length > 1 ? `<div class="chips">${['All', ...tags].map((t, i) => `<button class="chip ${i ? '' : 'on'}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : '';
      return `<section class="section projects-section"${id}><div class="wrap"><div class="inner">${title}${s.subtitle ? `<p class="section-sub">${esc(s.subtitle)}</p>` : ''}${chips}
        ${list.length ? `<div class="grid ${esc(s.layout || 'grid')}">${list.map(p => cardHTML(p, opts.preview)).join('')}</div>` : '<div class="empty">No projects published yet.</div>'}</div></div></section>`;
    }
    case 'links': {
      const links = (site.socials || []).filter(x => x.url);
      const host = u => { try { return u.startsWith('mailto:') ? u.slice(7) : new URL(u).host.replace(/^www\./, ''); } catch (e) { return u; } };
      const body = s.style === 'buttons'
        ? `<div class="link-list">${links.map((l, i) => `<a class="btn ${i ? '' : 'primary'}" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url)}</a>`).join('')}</div>`
        : `<div class="link-grid">${links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener"><strong>${esc(l.label || l.url)}</strong><span>${esc(host(l.url))}</span></a>`).join('')}</div>`;
      return `<section class="section ${s.align === 'center' ? 'center' : ''}"${id}><div class="wrap"><div class="inner">${title}${s.body ? `<div class="prose section-sub">${renderMd(s.body)}</div>` : ''}${body}</div></div></section>`;
    }
    default: // markdown
      return `<section class="section ${esc(s.width || 'narrow')} ${s.style === 'band' ? 'band' : ''} ${s.align === 'center' ? 'center' : ''}"${id}><div class="wrap"><div class="inner">${title}<div class="prose">${renderMd(s.body)}</div></div></div></section>`;
  }
}

function postHTML(p, prev, next) {
  const meta = [fmtDate(p.date), p.status].filter(Boolean).map(esc).join(' · ');
  const links = (p.links || []).filter(l => l.url).map(l => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url)} ↗</a>`).join('');
  const pager = prev || next ? `<nav class="pager">
      ${prev ? `<a class="prev" href="project.html?id=${encodeURIComponent(prev.id)}"><small>← Newer</small>${esc(prev.title)}</a>` : ''}
      ${next ? `<a class="next" href="project.html?id=${encodeURIComponent(next.id)}"><small>Older →</small>${esc(next.title)}</a>` : ''}</nav>` : '';
  return `<a class="back" href="./#projects">← All projects</a>
    <div class="meta" style="margin-top:22px">${meta}${p.draft ? ' <span class="badge">Draft</span>' : ''}</div>
    <h1 class="title">${esc(p.title || 'Untitled')}</h1>
    ${p.summary ? `<p class="summary">${esc(p.summary)}</p>` : ''}
    <div class="tags">${(p.tags || []).map(t => `<span>${esc(t)}</span>`).join('')}</div>
    ${links ? `<div class="links">${links}</div>` : ''}
    ${p.cover ? `<img class="cover" src="${src(p.cover)}" alt="">` : ''}
    <div class="prose" style="margin-top:28px">${renderMd(p.body)}</div>${pager}`;
}

/* ---------- page render ---------- */
let CURRENT = null;
function render(page, data, opts = {}) {
  CURRENT = { page, data, opts };
  const { site, projects } = data;
  const mode = applyTheme(site.theme, opts.mode);
  const sorted = sortProjects(opts.preview ? projects : projects.filter(p => !p.draft));
  const app = document.getElementById('app');
  const y = window.scrollY;
  let main;
  if (page === 'home') {
    document.title = site.name + (site.tagline ? ' · ' + site.tagline : '');
    main = '<main>' + (site.sections || []).filter(s => s.enabled !== false).map(s => sectionHTML(s, site, sorted, opts)).join('') + '</main>';
  } else {
    const id = opts.id ?? new URLSearchParams(location.search).get('id');
    const i = sorted.findIndex(p => p.id === id);
    const p = sorted[i];
    if (p) document.title = p.title + ' · ' + site.name;
    main = `<main class="wrap"><article class="post"${p && p.accent ? ` style="--accent:${esc(p.accent)}"` : ''}>${p ? postHTML(p, sorted[i - 1], sorted[i + 1])
      : '<a class="back" href="./">← Home</a><h1 class="title">Project not found</h1>'}</article></main>`;
  }
  app.innerHTML = headerHTML(site, page, mode) + main + footerHTML(site, page);
  const desc = document.querySelector('meta[name=description]'); if (desc) desc.content = site.tagline || '';
  let icon = document.querySelector('link[rel=icon]');
  if (site.avatar) { if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; document.head.appendChild(icon); } icon.href = IMAGE_MAP[site.avatar] || site.avatar; }
  postRender(app);
  wire(app, site);
  if (opts.preview) window.scrollTo(0, y);
}
function wire(app, site) {
  const btn = app.querySelector('#modeBtn');
  if (btn) btn.onclick = () => {
    const next = document.documentElement.dataset.mode === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('site-mode', next); } catch (e) {}
    if (CURRENT.opts.preview) CURRENT.opts.mode = next;
    render(CURRENT.page, CURRENT.data, CURRENT.opts);
  };
  app.querySelectorAll('.projects-section').forEach(sec => {
    const chips = sec.querySelector('.chips'); if (!chips) return;
    chips.addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      chips.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
      sec.querySelectorAll('.card').forEach(c => {
        const tags = JSON.parse(c.dataset.tags || '[]');
        c.classList.toggle('hidden', b.dataset.t !== 'All' && !tags.includes(b.dataset.t));
      });
    });
  });
}

async function boot(page) {
  const params = new URLSearchParams(location.search);
  if (params.has('preview')) {
    // Live preview inside the editor: data arrives by postMessage instead of from projects.json.
    window.addEventListener('message', e => {
      if (e.source !== window.parent || !e.data || e.data.type !== 'site-preview') return;
      if (location.protocol !== 'file:' && e.origin !== location.origin) return;
      IMAGE_MAP = e.data.images || {};
      render(page, normalize(e.data.data), { preview: true, mode: e.data.mode, id: e.data.id });
    });
    document.addEventListener('click', e => {
      const a = e.target.closest('a'); if (!a) return;
      const href = a.getAttribute('href') || '';
      const m = href.match(/project\.html\?id=([^&#]+)/);
      const hash = href.match(/^(?:\.\/)?#(.+)$/);
      e.preventDefault();
      if (m) parent.postMessage({ type: 'preview-open', id: decodeURIComponent(m[1]) }, '*');
      else if (hash) { const t = document.getElementById(hash[1]); if (t) t.scrollIntoView({ behavior: 'smooth' }); }
      else if (href === './') parent.postMessage({ type: 'preview-open', id: null }, '*');
    });
    parent.postMessage({ type: 'preview-ready' }, '*');
    return;
  }
  let data = {};
  try { const r = await fetch('projects.json?v=' + Date.now(), { cache: 'no-store' }); if (r.ok) data = await r.json(); } catch (e) {}
  render(page, normalize(data));
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => render(page, CURRENT.data, CURRENT.opts));
}
