// 화면 도우미 : 요소 만들기 · 화면 전환 · 토스트 · 아이콘

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

const root = () => document.getElementById('app');
let current = null;

// 화면 교체 : 이전 화면 페이드 아웃 → 새 화면 순차 등장
export async function mount(view, opt = {}) {
  const r = root();
  document.querySelector('.menu')?.remove();
  if (current?.firstChild?.cleanup) current.firstChild.cleanup();
  if (current?.cleanup) current.cleanup();
  if (current && current.isConnected && !opt.instant) {
    current.classList.add('leaving');
    await new Promise((ok) => setTimeout(ok, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 170));
  }
  r.replaceChildren(view);
  view.classList.add('view');
  current = view;
  window.scrollTo(0, 0);
  return view;
}

let toastTimer = null;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
}

export function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

export function busy(btn, on, label) {
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.replaceChildren(h('i', { class: 'spin' }));
  } else {
    btn.disabled = false;
    btn.textContent = label || btn.dataset.label || '';
  }
}

const P = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  out: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l5-5-5-5M15 12H4"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  shuffle: '<path d="M16 4h4v4M4 20l16-16M20 16v4h-4M15 15l5 5M4 4l5 5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>',
  skip: '<path d="M5 5l9 7-9 7z"/><path d="M19 5v14"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
};
export function icon(name, cls = 'icon') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  return s;
}

// 기기 이름 (로그인 기록용)
export function deviceName() {
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const os = /iPad/.test(ua) || touchMac ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android'
    : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : '기타';
  const br = /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? 'Chrome' : /Edg/.test(ua) ? 'Edge'
    : /Safari/.test(ua) ? 'Safari' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : '';
  const pwa = matchMedia('(display-mode: standalone)').matches || navigator.standalone ? ' · 앱' : '';
  return `${os}${br ? ' · ' + br : ''}${pwa}`;
}

// 학년 표시 : 1·2학년 = 예과, 3~6학년 = 본과
export function gradeLabel(g, s) {
  if (!g) return '';
  const y = g <= 2 ? `예과 ${g}학년` : `본과 ${g - 2}학년`;
  return s ? `${y} ${s}학기` : y;
}

// 가운데 모달 : 살짝 작은 상태에서 커지며 등장, 바깥 누르면 닫힘
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' }, h('h2', {}, title),
      h('button', { class: 'ib', 'aria-label': '닫기', onclick: () => close() }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-foot' }, actions) : null,
  );
  const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap) close(); } }, box);
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('on'));
  function close() {
    wrap.classList.remove('on');
    setTimeout(() => wrap.remove(), 260);
    onClose?.();
  }
  return { close, box };
}

// 세그먼트 선택 [A | B | C]
export function seg(options, value, onChange) {
  const el = h('div', { class: 'segc' });
  const render = () => el.replaceChildren(...options.map(([v, label]) =>
    h('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => { value = v; render(); onChange?.(v); } }, label)));
  render();
  el.get = () => value;
  return el;
}

export function fmtDate(t, withTime = true) {
  if (!t) return '';
  const d = new Date(t);
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return withTime ? `${md} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : md;
}

export function ago(t) {
  if (!t) return '';
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  return fmtDate(t, false);
}

// 오른쪽에서 미끄러져 나오는 서랍
export function drawer({ title, body, onClose }) {
  const panel = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'drawer-head' }, h('h2', {}, title), h('button', { class: 'ib', 'aria-label': '닫기', onclick: () => close() }, icon('x'))),
    h('div', { class: 'drawer-body' }, body));
  const scrim = h('div', { class: 'scrim', onclick: () => close() });
  document.body.append(scrim, panel);
  requestAnimationFrame(() => { scrim.classList.add('on'); panel.classList.add('on'); });
  function close() {
    scrim.classList.remove('on'); panel.classList.remove('on');
    setTimeout(() => { scrim.remove(); panel.remove(); }, 320);
    onClose?.();
  }
  return { close, panel };
}

// 버튼 아래로 펼쳐지는 작은 메뉴
export function popover(anchor, content, { align = 'left', width } = {}) {
  document.querySelector('.pop')?._close?.();
  const pop = h('div', { class: 'pop' }, content);
  if (width) pop.style.width = `${width}px`;
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.left = `${Math.max(12, Math.min(align === 'right' ? r.right - w : r.left, window.innerWidth - w - 12))}px`;
  pop.style.transformOrigin = align === 'right' ? 'top right' : 'top left';
  anchor.classList.add('open');
  const onDoc = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('pointerdown', onDoc), 0);
  function close() {
    anchor.classList.remove('open');
    document.removeEventListener('pointerdown', onDoc);
    pop.classList.add('out'); setTimeout(() => pop.remove(), 160);
  }
  pop._close = close;
  return { close, pop };
}
