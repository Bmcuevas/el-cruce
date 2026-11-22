import { initializeApp } from 'firebase/app';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, updateDoc, setDoc, addDoc, writeBatch, getDocsFromServer, getDoc
} from 'firebase/firestore';
import SEED from './seed.json';

const PEOPLE = { bruno: 'Bruno', marco: 'Marco' };
const BAGS = [
  ['obligatorio', 'Obligatorio'], ['carrera', 'Mochila de carrera'], ['ropa', 'Ropa de carrera'],
  ['campamento', 'Campamento'], ['botiquin', 'Botiquín'], ['guardabolso', 'Guardabolso y papeles']
];
const BAG_COLOR = { obligatorio: 'var(--alert)', carrera: 'var(--lake)', ropa: 'var(--lake)', campamento: 'var(--forest)', botiquin: 'var(--forest)', guardabolso: 'var(--muted)' };
const LABEL = { tengo: 'Tengo', falta: 'Falta', kit: 'Kit', verificar: 'Verificar' };
const ETAPA = [
  { title: 'Obligatorio', color: '#FB923C', items: ['Agua 1 L cargada', 'Vivac', 'Manta de supervivencia', 'Campera impermeable', 'Primera capa térmica', 'Micropolar', 'Gorro de abrigo', 'Silbato', 'Vaso soft', 'Bolsa para residuos', 'Dorsal y chip'] },
  { title: 'Carrera', color: '#9FC3D4', items: ['Bastones', 'Anteojos de sol', 'Gorra y buff', 'Protector solar y manteca de cacao', 'Geles, barras y electrolitos de la etapa', 'Botiquín chico recargado', 'Reloj y celular cargados', 'Frontal', 'Vaselina en los pies', 'Papel y toallitas'] }
];
const STAGE_DAY = { 1: 'miércoles 9 dic', 2: 'jueves 10 dic', 3: 'viernes 11 dic' };
const VIEWS = ['inicio', 'equipaje', 'etapa', 'viaje'];

const state = { who: 'bruno', bag: 'obligatorio', onlyMissing: false, items: [], todos: [], days: [], info: [], etapa: {}, loaded: { items: false, todos: false, days: false } };
let fs = null;
let trip = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; };
const other = (w) => (w === 'bruno' ? 'marco' : 'bruno');
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }

const mine = (it) => (!it.only || it.only === state.who) && (!it.shared || it.owner === state.who);
const statusOf = (it, who) => (it.s && it.s[who]) || 'falta';
const isDone = (s) => s === 'tengo' || s === 'kit';
const col = (name) => collection(fs, 'trips', trip, name);

// ---------- sync indicator
function renderSync() {
  const el = $('sync');
  if (!navigator.onLine) { el.textContent = 'Sin señal · guarda igual'; el.className = 'sync off'; }
  else { el.textContent = 'En línea'; el.className = 'sync'; }
}
window.addEventListener('online', renderSync);
window.addEventListener('offline', renderSync);

// ---------- render
function countdown() {
  const race = new Date(2026, 11, 9); const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = Math.round((race - now) / 86400000);
  $('countdown').textContent = d > 1 ? d + ' días' : d === 1 ? 'Mañana' : d === 0 ? 'Hoy' : d >= -2 ? 'En carrera' : 'Terminado';
}

function renderWho() {
  ['bruno', 'marco'].forEach((w) => $('who-' + w).setAttribute('aria-pressed', String(w === state.who)));
  $('home-bags-title').textContent = 'Equipaje de ' + PEOPLE[state.who];
  $('eq-title').textContent = 'Equipaje de ' + PEOPLE[state.who];
  $('et-who').textContent = 'Checklist de la noche · ' + PEOPLE[state.who];
  $('other-title').textContent = 'Compartido que lleva ' + PEOPLE[other(state.who)];
}

function renderHome() {
  if (!state.loaded.items) return;
  let html = '';
  const missing = [];
  BAGS.forEach(([key, label]) => {
    const list = state.items.filter((it) => it.bag === key && mine(it));
    if (!list.length) return;
    const done = list.filter((it) => isDone(statusOf(it, state.who))).length;
    if (key === 'obligatorio') list.forEach((it) => { if (!isDone(statusOf(it, state.who))) missing.push(it.name); });
    const pct = Math.round((done / list.length) * 100);
    html += `<div class="prog"><div class="row-between"><span style="font-weight:500">${esc(label)}</span><span>${done} / ${list.length}</span></div><div class="bar"><i style="width:${pct}%;background:${BAG_COLOR[key]}"></i></div></div>`;
  });
  const box = $('home-bags');
  box.innerHTML = html || '<p class="muted">Todavía no hay ítems en la lista.</p>';
  box.style.display = 'flex'; box.style.flexDirection = 'column'; box.style.gap = '12px';
  $('home-missing').textContent = missing.length ? 'Pendiente del obligatorio: ' + missing.join(', ') : 'Obligatorio completo.';
}

function renderTodos() {
  if (!state.loaded.todos) return;
  const list = state.todos.slice().sort((a, b) => (a.done - b.done) || ((a.order || 0) - (b.order || 0)));
  const open = list.filter((t) => !t.done).length;
  $('todo-count').textContent = open ? open + ' abiertos' : 'Todo resuelto';
  $('todos').innerHTML = list.length ? list.map((t) => {
    const who = t.who === 'marco' ? 'marco' : t.who === 'bruno' ? 'bruno' : 'both';
    const ini = who === 'both' ? 'BM' : PEOPLE[who][0];
    const check = t.done ? '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>' : '';
    return `<button type="button" class="todo${t.done ? ' done' : ''}" data-todo="${esc(t.id)}" aria-pressed="${!!t.done}"><span class="box">${check}</span><span class="t">${esc(t.text)}</span><span class="av ${who}" aria-label="${who === 'both' ? 'Los dos' : PEOPLE[who]}">${ini}</span></button>`;
  }).join('') : '<p class="muted">Nada pendiente.</p>';
}

function itemRow(it, who, readonly) {
  const s = statusOf(it, who);
  const note = it.note ? `<span class="note">${esc(it.note)}</span>` : '';
  const tag = it.shared ? `<span class="tag">Compartido · lo lleva ${esc(PEOPLE[it.owner] || '')}</span>` : '';
  return `<button type="button" class="item" data-item="${esc(it.id)}"${readonly || s === 'kit' ? ' disabled' : ''} aria-label="${esc(it.name)}: ${LABEL[s]}"><span class="txt">${tag}<span class="name">${esc(it.name)}</span>${note}</span><span class="badge ${s}">${LABEL[s]}</span></button>`;
}

function renderEquipaje() {
  $('bag-chips').innerHTML = BAGS.map(([key, label]) => {
    const list = state.items.filter((it) => it.bag === key && mine(it));
    const miss = list.filter((it) => !isDone(statusOf(it, state.who))).length;
    return `<button type="button" data-bag="${key}" aria-pressed="${state.bag === key}">${esc(label)}${miss ? `<span class="n">${miss}</span>` : ''}</button>`;
  }).join('');
  if (!state.loaded.items) return;
  const list = state.items.filter((it) => it.bag === state.bag && mine(it)).sort((a, b) => (a.order || 0) - (b.order || 0));
  const done = list.filter((it) => isDone(statusOf(it, state.who))).length;
  $('bag-count').textContent = done + ' de ' + list.length;
  const shown = state.onlyMissing ? list.filter((it) => !isDone(statusOf(it, state.who))) : list;
  $('items').innerHTML = shown.length ? shown.map((it) => itemRow(it, state.who, false)).join('')
    : `<p class="state">${list.length ? 'No te falta nada de este bolso.' : 'Este bolso está vacío. Agregá el primer ítem abajo.'}</p>`;
  const o = other(state.who);
  const others = state.items.filter((it) => it.bag === state.bag && it.shared && it.owner === o);
  $('other-wrap').hidden = !others.length;
  $('other-items').innerHTML = others.map((it) => itemRow(it, o, true)).join('');
}

function renderEtapa() {
  const e = state.etapa[state.who] || { stage: 1, done: {} };
  const stage = e.stage || 1;
  const doneMap = (e.done && e.done['s' + stage]) || {};
  $('et-title').textContent = 'Etapa ' + stage + ' · ' + STAGE_DAY[stage];
  const sd = state.days.find((x) => x.id === 'd' + String(8 + stage).padStart(2, '0'));
  $('et-stats').innerHTML = sd ? `${sd.route ? `<div class="et-route">${esc(sd.route)}</div>` : ''}${stageStats(sd)}${profileImg(sd)}` : '';
  document.querySelectorAll('[data-stage]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.stage) === stage)));
  let total = 0; let done = 0; let html = '';
  ETAPA.forEach((g) => {
    html += `<div class="grp" style="color:${g.color}">${g.title}</div>`;
    g.items.forEach((name) => {
      const k = slug(name); total++; const on = !!doneMap[k]; if (on) done++;
      const check = on ? '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0E181C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>' : '';
      html += `<button type="button" class="check" data-check="${k}" aria-pressed="${on}"><span class="cb">${check}</span><span>${esc(name)}</span></button>`;
    });
  });
  $('et-lists').innerHTML = html;
  $('et-count').textContent = done + ' de ' + total;
  $('et-bar').style.width = Math.round((done / total) * 100) + '%';
  $('et-bar').style.background = done === total ? '#7CC4A0' : '#FB923C';
}

function renderInfo() {
  const info = state.info.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const bib = info.find((x) => x.type === 'bib' && x.who === state.who);
  $('bib').hidden = !bib;
  if (bib) {
    $('bib-name').textContent = bib.name || PEOPLE[state.who].toUpperCase();
    $('bib-num').textContent = bib.number || '';
    $('bib-country').textContent = bib.country || '';
    $('bib-flag').className = 'flag ' + (bib.flag || '');
  }
  const links = info.filter((x) => x.type === 'link');
  $('links-card').hidden = !links.length;
  const ICON = {
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'
  };
  $('links').innerHTML = links.map((l) => `<a class="ulink" href="${esc(l.url)}" target="_blank" rel="noopener">
      <span class="ico"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[l.icon] || ICON.link}</svg></span>
      <span class="txt"><span class="name">${esc(l.title)}</span>${l.sub ? `<span class="note">${esc(l.sub)}</span>` : ''}</span>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></a>`).join('');
  const flights = info.filter((x) => x.type === 'flight').sort((a, b) => (a.who === state.who ? 0 : 1) - (b.who === state.who ? 0 : 1) || (a.order || 0) - (b.order || 0));
  const stays = info.filter((x) => x.type === 'stay');
  $('flights-wrap').hidden = !flights.length;
  $('stays-wrap').hidden = !stays.length;
  $('flights').innerHTML = flights.map((f) => {
    const segs = (f.segments || []).map((g) => `<div class="seg">
        <div class="seg-top"><span class="code">${esc(g.code)}</span><span class="muted">${esc(g.airline)}</span><span class="dur">${esc(g.dur || '')}</span></div>
        <div class="seg-route">
          <div class="pt"><div class="iata">${esc(g.from)}</div><div class="time">${esc(g.dep)}</div><div class="place">${esc(g.fromName)}</div></div>
          <div class="path" aria-hidden="true"><i></i><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" transform="rotate(90 12 12)"/></svg><i></i></div>
          <div class="pt end"><div class="iata">${esc(g.to)}</div><div class="time">${esc(g.arr)}${g.plus ? `<sup>${esc(g.plus)}</sup>` : ''}</div><div class="place">${esc(g.toName)}</div></div>
        </div></div>`).join('<div class="layover" aria-hidden="true"></div>');
    return `<article class="flight">
      <header><div><div class="k">${esc(f.title)} · ${esc(PEOPLE[f.who] || '')}</div><div class="date">${esc(f.date)}</div></div></header>
      ${segs}
      <div class="bags"><span class="badge ${/Sin/.test(f.bag) ? 'falta' : /confirmar/.test(f.bag) ? 'verificar' : 'tengo'}">${esc(f.bag)}</span><span class="badge kit">${esc(f.hand)}</span></div>
      ${f.warn ? `<div class="warn">${esc(f.warn)}</div>` : ''}
    </article>`;
  }).join('');
  $('stays').innerHTML = stays.map((h) => `<article class="card stay">
      <div class="row-between" style="align-items:flex-start"><div><div style="font-family:var(--display);font-size:19px;font-weight:700">${esc(h.name)}</div>${h.alias ? `<div class="muted">${esc(h.alias)}</div>` : ''}</div>
      ${h.maps ? `<a class="btn ghost" style="display:inline-flex;align-items:center;text-decoration:none;font-size:13px" href="${esc(h.maps)}" target="_blank" rel="noopener">Mapa</a>` : ''}</div>
      <div class="chips" style="flex-wrap:wrap">${(h.nights || []).map((n) => `<span class="badge tengo">${esc(n)}</span>`).join('')}</div>
      <dl class="facts"><dt>Dirección</dt><dd>${esc(h.address)}</dd>${h.phone ? `<dt>Teléfono</dt><dd>${esc(h.phone)}</dd>` : ''}${h.price ? `<dt>Pagado</dt><dd>${esc(h.price)}</dd>` : ''}</dl>
    </article>`).join('');
}

const fmtN = (n) => Number(n).toLocaleString('es-AR');
// Official stage profile image, when one has been added to the day (field: profileImg).
const profileImg = (d) => (d && d.profileImg ? `<figure class="prof"><img src="${esc(d.profileImg)}" alt="Perfil oficial de la ${esc(d.title)}" loading="lazy"></figure>` : '');
function profileSvg(pr) {
  if (!pr || !pr.pts || pr.pts.length < 2) return '';
  const W = 340, H = 150, L = 34, R = 8, T = 22, B = 22;
  const kms = pr.pts.map((p) => p[0]); const alts = pr.pts.map((p) => p[1]);
  const kMax = Math.max(...kms);
  const lo = Math.floor((Math.min(...alts) - 60) / 100) * 100;
  const hi = Math.ceil((Math.max(...alts) + 60) / 100) * 100;
  const x = (k) => L + (k / kMax) * (W - L - R);
  const y = (a) => T + (1 - (a - lo) / (hi - lo)) * (H - T - B);
  const line = pr.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  const area = `${line} L${x(kMax).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`;
  const top = pr.pts.reduce((m, p) => (p[1] > m[1] ? p : m), pr.pts[0]);
  const grid = [lo, Math.round((lo + hi) / 200) * 100, hi].map((a) => `<line x1="${L}" x2="${W - R}" y1="${y(a)}" y2="${y(a)}" class="pg"/><text x="${L - 4}" y="${y(a) + 3}" text-anchor="end" class="pt">${fmtN(a)}</text>`).join('');
  const oasis = (pr.oasis || []).map((k) => `<line x1="${x(k)}" x2="${x(k)}" y1="${T - 6}" y2="${H - B}" class="po"/><text x="${x(k)}" y="${T - 10}" text-anchor="middle" class="pot">Oasis</text>`).join('');
  const steep = (pr.tramos || []).filter((t) => Math.abs(t.pct) >= 6).map((t) => {
    const mid = (t.a + t.b) / 2; const a = (pr.pts.find((p) => p[0] === t.a) || [0, lo])[1]; const b = (pr.pts.find((p) => p[0] === t.b) || [0, lo])[1];
    return `<text x="${x(mid) + (t.pct > 0 ? -18 : 14)}" y="${Math.min(y((a + b) / 2) - 8, H - B - 4)}" text-anchor="middle" class="ps">${t.pct > 0 ? '+' : ''}${String(t.pct).replace('.', ',')}%</text>`;
  }).join('');
  const kt = [0, Math.round(kMax / 2), kMax].map((k) => `<text x="${x(k)}" y="${H - 6}" text-anchor="middle" class="pt">${k} km</text>`).join('');
  return `<figure class="prof"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Perfil aproximado: punto más alto ${fmtN(top[1])} m en el km ${String(top[0]).replace('.', ',')}">
    ${grid}<path d="${area}" class="pa"/><path d="${line}" class="pl"/>${oasis}
    <circle cx="${x(top[0])}" cy="${y(top[1])}" r="3.5" class="pd"/><text x="${Math.min(x(top[0]), W - R - 30)}" y="${y(top[1]) - 8}" text-anchor="middle" class="ph">${fmtN(top[1])} m</text>
    ${steep}${kt}</svg>
    <figcaption>Perfil aproximado por tramos (Infotrail). El oficial está en Recorridos.</figcaption></figure>`;
}
function stageStats(d) {
  if (!d || !d.km) return '';
  const limit = Math.round(d.km * 15);
  const lim = `${Math.floor(limit / 60)} h${limit % 60 ? ' ' + (limit % 60) : ''}`;
  return `<div class="stats"><span><b>${fmtN(d.km)}</b> km</span><span><b>+${fmtN(d.dplus)}</b> m</span>${d.high ? `<span>techo <b>${fmtN(d.high)}</b> m</span>` : ''}<span>límite ~<b>${lim}</b></span>${d.oasis ? `<span>oasis <b>${esc(d.oasis)}</b></span>` : ''}</div>`;
}
function renderViaje() {
  renderInfo();
  if (!state.loaded.days) return;
  const tags = { ok: ['Reservado', 'tengo'], camp: ['Organización', 'kit'], open: ['A definir', 'falta'] };
  const list = state.days.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const openN = list.filter((d) => d.kind === 'open').length;
  $('trip-sub').textContent = list.length ? `${list[0].num} – ${list[list.length - 1].num} dic${openN ? ` · ${openN} ${openN === 1 ? 'noche' : 'noches'} sin definir` : ''}` : '';
  $('days').innerHTML = list.length ? list.map((d) => {
    const t = tags[d.kind] || tags.open;
    return `<div class="day"><div class="d"><div class="dow">${esc(d.dow)}</div><div class="num${d.race ? ' race' : ''}">${esc(d.num)}</div><div class="line"></div></div>`
      + `<div class="card${d.kind === 'open' ? ' open' : ''}"><div style="font-weight:600;font-size:16px">${esc(d.title)}</div>${d.route ? `<div class="muted">${esc(d.route)}</div>` : ''}${stageStats(d)}${profileImg(d)}${d.detail ? `<div class="muted">${esc(d.detail)}</div>` : ''}${d.more && d.more.length ? `<details class="more"><summary>${esc(d.moreTitle || 'Más detalles')}</summary><ul>${d.more.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>${d.mapsUrl ? `<a class="btn ghost maps" href="${esc(d.mapsUrl)}" target="_blank" rel="noopener">Abrir ruta en Google Maps</a>` : ''}</details>` : ''}${d.extra ? `<div class="extra"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${/[Cc]umple/.test(d.extra) ? '<path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7M12 12V8M12 5.5c.8-.8.8-1.7 0-2.5-.8.8-.8 1.7 0 2.5z"/>' : '<path d="M7 3v8a2 2 0 0 0 2 2v8M7 3v5M10 3v5M17 3c-1.7 1-2.5 3-2.5 6s1 4 2.5 4v8"/>'}</svg><span>${esc(d.extra)}</span></div>` : ''}`
      + `<div class="night-row"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18V8l9-5 9 5v10"/><path d="M3 18h18M9 18v-5h6v5"/></svg><span>${esc(d.night)}</span><span class="badge ${t[1]}">${t[0]}</span></div></div></div>`;
  }).join('') : '<p class="state">Todavía no hay días cargados.</p>';
}

function renderAll() { renderInfo(); renderWho(); renderHome(); renderTodos(); renderEquipaje(); renderEtapa(); renderViaje(); }

// ---------- routing
function route() {
  let h = (location.hash || '').slice(1); if (!VIEWS.includes(h)) h = 'inicio';
  VIEWS.forEach((v) => { $('v-' + v).hidden = v !== h; });
  document.querySelectorAll('nav.tabs a').forEach((a) => { if (a.dataset.tab === h) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ---------- writes (fire and forget: offline writes queue locally and sync later)
const fail = (e) => { console.error(e); toast('No se pudo guardar. Revisá el código del viaje.'); };

document.addEventListener('click', (ev) => {
  let b;
  if ((b = ev.target.closest('[data-join-who]'))) {
    document.querySelectorAll('[data-join-who]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    return;
  }
  if (!fs) return;
  if ((b = ev.target.closest('[data-who]'))) { state.who = b.dataset.who; store('cruce-who', state.who); renderAll(); return; }
  if ((b = ev.target.closest('[data-bag]'))) { state.bag = b.dataset.bag; store('cruce-bag', state.bag); renderEquipaje(); return; }
  if ((b = ev.target.closest('[data-item]'))) {
    if (b.disabled) return;
    const it = state.items.find((x) => x.id === b.dataset.item); if (!it) return;
    const s = statusOf(it, state.who); if (s === 'kit') return;
    const next = s === 'tengo' ? 'falta' : 'tengo';
    updateDoc(doc(col('items'), it.id), { ['s.' + state.who]: next }).catch(fail);
    return;
  }
  if ((b = ev.target.closest('[data-todo]'))) {
    const t = state.todos.find((x) => x.id === b.dataset.todo); if (!t) return;
    updateDoc(doc(col('todos'), t.id), { done: !t.done }).catch(fail);
    return;
  }
  if ((b = ev.target.closest('[data-stage]'))) {
    setDoc(doc(col('etapa'), state.who), { stage: Number(b.dataset.stage) }, { merge: true }).catch(fail);
    return;
  }
  if ((b = ev.target.closest('[data-check]'))) {
    const e = state.etapa[state.who] || { stage: 1, done: {} };
    const key = 's' + (e.stage || 1);
    const cur = !!(e.done && e.done[key] && e.done[key][b.dataset.check]);
    setDoc(doc(col('etapa'), state.who), { stage: e.stage || 1, done: { [key]: { [b.dataset.check]: !cur } } }, { merge: true }).catch(fail);
  }
});

$('et-reset').addEventListener('click', () => {
  if (!fs) return;
  const e = state.etapa[state.who] || { stage: 1, done: {} };
  const done = Object.assign({}, e.done); done['s' + (e.stage || 1)] = {};
  setDoc(doc(col('etapa'), state.who), { stage: e.stage || 1, done }).catch(fail);
});
$('only-missing').addEventListener('change', (ev) => { state.onlyMissing = ev.target.checked; renderEquipaje(); });
$('add-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const name = $('add-name').value.trim(); if (!name || !fs) return;
  const shared = $('add-shared').checked;
  const order = state.items.reduce((m, it) => Math.max(m, it.order || 0), 0) + 1;
  addDoc(col('items'), { bag: state.bag, name: name.slice(0, 120), note: '', shared, owner: shared ? state.who : '', order, s: { bruno: 'falta', marco: 'falta' } }).catch(fail);
  $('add-name').value = ''; $('add-shared').checked = false;
  toast('Agregado a ' + BAGS.find((b) => b[0] === state.bag)[1]);
});

// ---------- data
function listen(name, key) {
  onSnapshot(col(name), (snap) => {
    const arr = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    if (key === 'etapa') { const m = {}; arr.forEach((o) => { m[o.id] = o; }); state.etapa = m; renderEtapa(); return; }
    if (key === 'info') { state.info = arr; renderInfo(); return; }
    state[key] = arr; state.loaded[key] = true;
    if (key === 'items') { renderHome(); renderEquipaje(); } else if (key === 'todos') renderTodos(); else { renderViaje(); renderEtapa(); }
  }, (err) => {
    console.error(err);
    $('status').textContent = err.code === 'permission-denied' ? 'El código del viaje no es válido.' : 'No se pudo leer la lista. Probá recargar.';
    $('status').hidden = false;
  });
}

// The list file in the repo (src/seed.json) is the source for structure: the base list
// is written once into an empty trip, then each numbered patch is merged once. Patches only
// touch the fields they name, so what each person ticked in the app is kept.
async function syncSeed() {
  if (!navigator.onLine) return;
  try {
    const metaRef = doc(col('meta'), 'seed');
    const marker = await getDoc(metaRef);
    let applied = marker.exists() ? (marker.data().v || 1) : 0;
    if (!applied) {
      const existing = await getDocsFromServer(col('items'));
      if (existing.empty) {
        const all = [];
        ['items', 'todos', 'days'].forEach((c) => (SEED[c] || []).forEach((o) => { const { id, ...rest } = o; all.push([c, id, rest]); }));
        for (let i = 0; i < all.length; i += 400) {
          const batch = writeBatch(fs);
          all.slice(i, i + 400).forEach(([c, id, data]) => batch.set(doc(col(c), id), data));
          await batch.commit();
        }
      }
      applied = 1;
      await setDoc(metaRef, { v: 1, at: Date.now() }, { merge: true });
    }
    for (const p of (SEED.patches || []).filter((x) => x.v > applied).sort((a, b) => a.v - b.v)) {
      const batch = writeBatch(fs);
      p.ops.forEach((op) => batch.set(doc(col(op.col), op.id), op.data, { merge: true }));
      batch.set(metaRef, { v: p.v, at: Date.now() }, { merge: true });
      await batch.commit();
      applied = p.v;
    }
  } catch (e) { console.error('seed', e); }
}

function start(code) {
  trip = code;
  const app = initializeApp(window.FIREBASE_CONFIG);
  fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  listen('items', 'items'); listen('todos', 'todos'); listen('days', 'days'); listen('etapa', 'etapa'); listen('info', 'info');
  syncSeed();
}

// ---------- join
function codeFromHash() {
  const m = /^#v-([A-Za-z0-9]{16,64})$/.exec(location.hash || '');
  return m ? m[1] : null;
}

function boot() {
  state.who = store('cruce-who') === 'marco' ? 'marco' : 'bruno';
  const savedBag = store('cruce-bag'); if (savedBag && BAGS.some((b) => b[0] === savedBag)) state.bag = savedBag;
  countdown(); renderSync();

  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.projectId) {
    $('status').textContent = 'Falta configurar Firebase (firebase-config.js).'; $('status').hidden = false;
    route(); renderAll(); return;
  }

  const fromLink = codeFromHash();
  if (fromLink) { store('cruce-trip', fromLink); history.replaceState(null, '', location.pathname); }
  const code = fromLink || store('cruce-trip');
  route(); renderAll();
  if (code) { start(code); return; }

  $('join').hidden = false;
  $('join-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    let v = $('join-code').value.trim();
    const m = /#v-([A-Za-z0-9]{16,64})/.exec(v); if (m) v = m[1];
    if (!/^[A-Za-z0-9]{16,64}$/.test(v)) { $('join-err').textContent = 'El código tiene que tener al menos 16 letras o números.'; return; }
    const who = document.querySelector('[data-join-who][aria-pressed="true"]').dataset.joinWho;
    store('cruce-trip', v); store('cruce-who', who); state.who = who;
    $('join').hidden = true; renderAll(); start(v);
  });
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
