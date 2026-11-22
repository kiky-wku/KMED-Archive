// 화면 도우미 : 요소 만들기 · 화면 전환 · 토스트 · 아이콘

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.entries(v).forEach(([sk, sv]) => (sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv)));
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
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.7M6.3 7.6A16.6 16.6 0 0 0 2.5 12S6 18 12 18a9.4 9.4 0 0 0 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5v-6a1.5 1.5 0 0 1 3 0V11"/><path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v5.5"/><path d="M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.4-2.6L3.9 15.2a1.6 1.6 0 0 1 2.4-2.1L8 15"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  marker: '<path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  eraser: '<path d="M7 21l-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21"/><path d="M22 21H7"/><path d="M5 11l9 9"/>',
  minus: '<path d="M5 12h14"/>',
  download: '<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/>',
  editlist: '<path d="M4 6h10M4 11h7M4 16h5"/><path d="M14.5 19.5l.6-3 5-5a1.5 1.5 0 0 1 2.1 2.1l-5 5z"/>',
  bell: '<path d="M6 9.5a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4s2-1.5 2-6.5"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0"/>',
  siren: '<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M4.5 18h15v2.5h-15z"/><path d="M12 2.5v1.5M4.2 5.7l1.1 1.1M19.8 5.7l-1.1 1.1M2.5 12H4M20 12h1.5"/>',
  chat: '<path d="M20 12.5a7.5 7.5 0 0 1-11 6.6L4.5 20l1-4A7.5 7.5 0 1 1 20 12.5z"/><path d="M9 11.5h6M9 14.5h3.5"/>',
  file: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/>',
  type: '<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  share: '<path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  import: '<path d="M12 3.5v10"/><path d="M8 9.5l4 4 4-4"/><path d="M4 14.5v3.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
  spark: '<path d="M11 3.5l1.9 5.1 5.1 1.9-5.1 1.9L11 17.5l-1.9-5.1L4 10.5l5.1-1.9z"/><path d="M18.5 15.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z"/>',
  sheet: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9.5h16M4 14.5h16M9.5 4v16"/>',
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
  const ind = h('i', { class: 'segc-ind' });
  const btns = options.map(([v, label]) => h('button', { type: 'button', onclick: () => { if (value === v) return; value = v; paint(); onChange?.(v); } }, label));
  el.append(ind, ...btns);
  // 고른 칸으로 흰 바탕이 미끄러져 감
  const move = () => {
    const b = btns[options.findIndex(([v]) => v === value)];
    if (!b || !b.offsetWidth) return;
    ind.style.width = `${b.offsetWidth}px`; ind.style.transform = `translateX(${b.offsetLeft}px)`;
    if (!el.classList.contains('ready')) requestAnimationFrame(() => el.classList.add('ready'));
  };
  function paint() { btns.forEach((b, i) => b.classList.toggle('on', options[i][0] === value)); move(); }
  paint();
  const ro = new ResizeObserver(move); ro.observe(el); btns.forEach((b) => ro.observe(b));
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

// 회색 대기 표시 (스피너 대신)
export function skelRows(n = 6, hgt = 52) {
  return h('div', { class: 'skel-rows' }, Array.from({ length: n }, (_, i) => h('i', { class: 'skel', style: { height: `${hgt}px`, width: i % 3 === 2 ? '72%' : '100%' } })));
}
