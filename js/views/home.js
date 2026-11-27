import { sb } from '../sb.js';
import { h, icon, gradeLabel, popover, toast, modal, seg, ago } from '../ui.js';
import { S, seesAll, go } from '../app.js';
import { shell } from './shell.js';
import { loadFavs } from '../data/favs.js';
import { markViewed } from '../data/files.js';
import { openPdf } from './pdf-viewer.js';
import { openComments } from './comments.js';
import { savedFile } from '../data/offline.js';
import { bellButton, openSuggest, openNotifs } from './reports.js';
import { listNotifs, markRead, onNotifChange } from '../data/reports.js';
import { loadSubjects, loadProgress, loadEvents, addEvent, updateEvent, deleteEvent, setExam, loadRecent, loadWeek } from '../data/home.js';

// ─────────────────────────────────────────────
// 홈 : 인사 + 찾기 / 과목 / 최근 본 자료, 이번 주 학습 / 다가오는 일정, 새 소식
//  제목은 칸 밖, 내용은 흰 칸 안. 목록은 칸 높이에 들어가는 만큼만 보여 줌
// ─────────────────────────────────────────────

// 날마다 바뀌는 한마디 (짧고 담백하게)
const LINES = [
  '꾸준히 한 만큼 남습니다', '오늘 한 장이 시험장에서 한 문제가 됩니다', '조금씩이라도 매일 합니다', '어제보다 한 걸음만 더',
  '틀린 문제가 제일 좋은 선생님입니다', '쉬어 가도 멈추지만 않으면 됩니다', '외운 건 다시 볼 때 내 것이 됩니다', '오늘 할 만큼만 해도 충분합니다',
  '천천히, 그래도 꾸준히', '한 번 더 보면 오래 남습니다', '작은 습관이 성적을 만듭니다', '지금 보는 한 줄이 쌓입니다',
];
const DAY = ['일', '월', '화', '수', '목', '금', '토'];
const NICON = { signup: 'bell', report: 'siren', suggest: 'chat', done: 'check', upload: 'file', comment: 'chat', device: 'shield' };
const KIND_ICON = { flash: 'layers', past: 'list', pred: 'list', hanja_r: 'pen', hanja_h: 'pen', hanja_grid: 'pen', jung_translate: 'pen', um_order: 'list', wordlist: 'list', wordbook: 'list' };
const fileTitle = (f) => [f.series || (f.filename || '').replace(/\.pdf$/i, ''), f.mode === 'weekly' ? f.week : ''].filter(Boolean).join(' ');
const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dDays = (t) => Math.round((dayStart(t) - dayStart(new Date())) / 86400e3);
const hm = (t) => {
  const d = new Date(t); const H = d.getHours(); const M = d.getMinutes();
  if (H === 23 && M === 59) return '밤 11시 59분';
  return `${H < 12 ? '오전' : '오후'} ${H % 12 || 12}시${M ? ` ${M}분` : ''}`;
};

export function homeView(q) {
  const g = parseInt(q.get('g'), 10) || S.grade || 1;
  const s = parseInt(q.get('s'), 10) || S.sem || 1;
  const now = new Date();
  const today = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  const line = LINES[Math.floor(dayStart(now).getTime() / 86400e3) % LINES.length];
  const cleanups = [];

  // ── 인사 + 찾기 ──
  const search = h('button', { class: 'hm-search', onclick: () => openSearch() },
    icon('search'), h('span', {}, '과목, 자료, 카드 찾기'), h('kbd', {}, navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl K'));
  const hello = h('div', { class: 'hm-hello' },
    h('span', { class: 'hm-wave', 'aria-hidden': 'true' }, '👋'),
    h('div', { class: 'hm-hi' }, h('h1', {}, `${S.profile.name || ''}님, 안녕하세요`), h('p', {}, `${today}, ${line}`)),
    search);
  const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); } };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  // ── 과목 ──
  const semBtn = h('button', { class: 'hm-sem' + (seesAll() ? '' : ' fixed') }, gradeLabel(g, s), seesAll() ? icon('down') : null);
  if (seesAll()) semBtn.addEventListener('click', () => openSemMenu(semBtn, g, s));
  const rail = h('div', { class: 'hm-rail' }, Array.from({ length: 4 }, () => h('i', { class: 'skel hm-sk' })));
  const railWrap = h('div', { class: 'hm-railw' }, rail, h('i', { class: 'hm-fade l' }), h('i', { class: 'hm-fade r' }));
  const prev = h('button', { class: 'hm-ic', 'aria-label': '앞 과목', disabled: true, onclick: () => slide(-1) }, icon('left'));
  const next = h('button', { class: 'hm-ic', 'aria-label': '다음 과목', onclick: () => slide(1) }, icon('right'));
  const slide = (d) => rail.scrollBy({ left: d * Math.max(200, rail.clientWidth - 120), behavior: 'smooth' });
  const navPaint = () => {
    prev.disabled = rail.scrollLeft < 4;
    next.disabled = rail.scrollLeft + rail.clientWidth > rail.scrollWidth - 4;
    // 흐림 폭 = 남은 거리 (끝 카드의 오른쪽 가장자리를 따라 줄어듦)
    const restR = Math.max(0, rail.scrollWidth - rail.clientWidth - rail.scrollLeft);
    railWrap.style.setProperty('--fr', `${Math.min(72, restR)}px`);
    railWrap.style.setProperty('--fl', `${Math.min(72, rail.scrollLeft)}px`);
  };
  let rafN = 0;
  rail.addEventListener('scroll', () => { cancelAnimationFrame(rafN); rafN = requestAnimationFrame(navPaint); }, { passive: true });
  window.addEventListener('resize', navPaint); cleanups.push(() => window.removeEventListener('resize', navPaint));

  // ── 칸 ──
  const recentBox = h('div', { class: 'hm-list' });
  const weekBox = h('div', { class: 'hm-week' });
  const evBox = h('div', { class: 'hm-list hm-ev' });
  const newsBox = h('div', { class: 'hm-list' });
  const sec = (cls, title, btn, box) => h('section', { class: `hm-sec ${cls}` },
    h('div', { class: 'hm-lb' }, title, h('span', { class: 'g' }), btn),
    h('div', { class: 'hm-pn' }, box));
  const iconBtn = (ic, label, fn) => h('button', { class: 'hm-ic', 'aria-label': label, title: label, onclick: fn }, icon(ic));

  let subjects = [];
  const body = h('div', { class: 'hm' },
    hello,
    h('div', { class: 'hm-grid' },
      h('section', { class: 'hm-sec hm-subj' },
        h('div', { class: 'hm-lb' }, semBtn, h('span', { class: 'g' }), prev, next),
        railWrap),
      sec('hm-recent', h('h2', {}, '최근 본 자료'), iconBtn('right', '최근 본 자료 전체', () => openRecentAll()), recentBox),
      sec('hm-wk', h('h2', {}, '이번 주 학습'), iconBtn('right', '내 학습', () => go('#/stats')), weekBox),
      h('div', { class: 'hm-side' },
        sec('hm-plan', h('h2', {}, '다가오는 일정'), iconBtn('pen', '일정 고치기', () => openPlan(g, s, subjects, refreshPlan)), evBox),
        sec('hm-news', h('h2', {}, '새 소식'), iconBtn('bell', '알림', () => openNotifs()), newsBox))));

  // 목록은 칸 높이에 통째로 들어가는 줄만 보여 줌
  const fits = [];
  const fit = (box) => {
    const rows = [...box.children].filter((x) => x.classList.contains('hm-row'));
    rows.forEach((r) => { r.hidden = false; });
    const lim = box.clientHeight;
    if (!lim || getComputedStyle(box).overflow === 'visible') return;
    rows.forEach((r) => { if (r.offsetTop + r.offsetHeight > lim + 1) r.hidden = true; });
  };
  const ro = new ResizeObserver(() => fits.forEach(fit));
  [recentBox, evBox, newsBox].forEach((b) => { fits.push(b); ro.observe(b); });
  cleanups.push(() => ro.disconnect());
  const refit = () => requestAnimationFrame(() => fits.forEach(fit));

  // ── 과목 + 진도 + 일정 ──
  let events = [];
  function examsOf(list) {
    const out = [];
    for (const sub of list) for (const r of sub.ranges) if (r.exam_at && dDays(r.exam_at) >= 0) out.push({ major: true, sub, range: r, at: r.exam_at });
    return out;
  }
  function paintPlan() {
    const all = [...examsOf(subjects), ...events.map((e) => ({ ev: e, at: e.at }))].sort((a, b) => new Date(a.at) - new Date(b.at));
    if (!all.length) {
      evBox.replaceChildren(h('button', { class: 'hm-empty', onclick: () => openPlan(g, s, subjects, refreshPlan) }, '시험이나 과제를 넣어 두면 여기에 보입니다'));
      return;
    }
    evBox.replaceChildren(...all.map((x, i) => {
      const d = new Date(x.at); const n = dDays(x.at);
      const title = x.major ? x.sub.name : x.ev.title;
      const kind = x.major ? `${/^(중간|기말)$/.test(x.range.name) ? `${x.range.name}고사` : `${x.range.name} 시험`}`
        : `${x.ev.scope === 'grade' ? '학과 ' : ''}${{ exam: '시험', task: '과제', etc: '일정' }[x.ev.kind]}`;
      const left = n === 0 ? 'D-DAY' : `D-${n}`;
      return h('div', { class: 'hm-row hm-evr' + (i === 0 ? ' hot' : '') },
        h('span', { class: 'hm-dt' }, h('b', {}, String(d.getDate())), h('span', {}, `${d.getMonth() + 1}월 ${DAY[d.getDay()]}`)),
        h('span', { class: 'hm-tx' }, h('b', {}, title), h('span', {}, `${kind}, ${hm(x.at)}`)),
        h('span', { class: 'hm-left' }, left));
    }));
    refit();
  }
  async function refreshPlan() {
    try { subjects = await loadSubjects(g, s); } catch { /* 그대로 */ }
    events = await loadEvents(g);
    paintSubjects(lastProg); paintPlan();
  }

  let lastProg = new Map();
  function paintSubjects(prog) {
    lastProg = prog;
    if (!subjects.length) { rail.replaceChildren(h('div', { class: 'hm-none' }, navigator.onLine ? '등록된 과목이 없습니다' : '인터넷에 연결되면 과목이 보입니다')); return; }
    const next = (sub) => sub.ranges.filter((r) => r.exam_at && dDays(r.exam_at) >= 0).sort((a, b) => new Date(a.exam_at) - new Date(b.exam_at))[0];
    const ord = subjects.map((sub, i) => ({ sub, i, nx: next(sub) }))
      .sort((a, b) => (a.nx ? new Date(a.nx.exam_at) : Infinity) - (b.nx ? new Date(b.nx.exam_at) : Infinity) || a.i - b.i);
    rail.replaceChildren(...ord.map(({ sub, nx }, i) => {
      const p = prog.get(sub.id);
      const pct = p && p.total ? Math.round((p.ok / p.total) * 100) : null;
      const n = nx ? dDays(nx.exam_at) : null;
      const sub2 = nx ? `${nx.name} ${n === 0 ? 'D-DAY' : `D-${n}`}` : sub.ranges.map((r) => r.name).join(', ');
      return h('button', { class: 'hm-card', style: { animationDelay: `${i * 0.035}s` }, onclick: () => go(`#/s/${sub.id}`) },
        h('span', { class: 'hm-emo' }, sub.icon || sub.name.slice(0, 1)),
        h('span', { class: 'hm-name' }, sub.name),
        h('span', { class: 'hm-sub' + (n !== null && n <= 10 ? ' r' : '') }, sub2),
        pct === null ? h('span', { class: 'hm-pb' }) : h('span', { class: 'hm-pb' }, h('span', { class: 'hm-bar' }, h('i', { style: { width: `${pct}%` } })), `${pct}%`));
    }));
    requestAnimationFrame(navPaint);
  }

  (async () => {
    try { subjects = await loadSubjects(g, s); } catch { subjects = []; }
    paintSubjects(new Map());
    const [prog, evs] = await Promise.all([loadProgress(subjects.map((x) => x.id)), loadEvents(g)]);
    events = evs;
    paintSubjects(prog); paintPlan(); paintWeak(prog);
  })();

  // ── 최근 본 자료 ──
  let recent = [];
  function recentRow(x, i) {
    const cur = i === 0 ? ' cur' : '';
    if (x.type === 'study') {
      const kind = x.hash.match(/[?&]b=([^&]+)/)?.[1] || '';
      const sid = x.hash.match(/#\/s\/([^?]+)/)?.[1];
      const sub = subjects.find((v) => v.id === sid);
      return h('button', { class: 'hm-row' + cur, onclick: () => go(x.hash) },
        h('span', { class: 'hm-ri' }, icon(KIND_ICON[kind] || 'play')),
        h('span', { class: 'hm-tx' }, h('b', {}, x.label.replace(/\s*·\s*/g, ' ')), h('span', {}, sub ? `${sub.name}, 이어서 학습하기` : '이어서 학습하기')),
        h('span', { class: 'hm-t' }, ago(x.at)));
    }
    const f = x.file;
    return h('button', { class: 'hm-row' + cur, onclick: () => openFile(f) },
      h('span', { class: 'hm-ri' }, icon('file')),
      h('span', { class: 'hm-tx' }, h('b', {}, fileTitle(f)), h('span', {}, f.subjects?.name || '')),
      h('span', { class: 'hm-t' }, ago(x.at)));
  }
  loadRecent(12).then((list) => {
    recent = list;
    if (!list.length) { recentBox.replaceChildren(h('div', { class: 'hm-empty' }, '자료를 열거나 공부를 시작하면 여기에 보입니다')); return; }
    recentBox.replaceChildren(...list.map(recentRow));
    refit();
  }).catch(() => recentBox.replaceChildren(h('div', { class: 'hm-empty' }, '인터넷에 연결되면 보입니다')));

  function openRecentAll() {
    const body2 = h('div', { class: 'hm-all' }, h('div', { class: 'hm-list free' }, recent.length ? recent.map(recentRow) : h('div', { class: 'hm-empty' }, '아직 본 자료가 없습니다')));
    const favs = h('div', { class: 'hm-list free' });
    loadFavs().then((list) => {
      if (!list.length) return;
      body2.append(h('h3', { class: 'hm-h3' }, '즐겨찾기'), favs);
      favs.replaceChildren(...list.map((x) => h('button', { class: 'hm-row', onclick: () => { m.close(); openFav(x); } },
        h('span', { class: 'hm-ri' }, icon('star')), h('span', { class: 'hm-tx' }, h('b', {}, x.title), h('span', {}, x.sub)), h('span', { class: 'hm-t' }))));
    }).catch(() => {});
    const m = modal({ title: '최근 본 자료', body: body2 });
    body2.addEventListener('click', (e) => { if (e.target.closest('.hm-row')) setTimeout(() => m.close(), 0); });
  }

  // ── 이번 주 학습 ──
  let weak = null;
  function paintWeak(prog) {
    const list = subjects.map((sub) => ({ sub, p: prog.get(sub.id) }))
      .filter((x) => x.p && x.p.q_ok + x.p.q_no >= 5)
      .map((x) => ({ ...x, rate: Math.round((x.p.q_ok / (x.p.q_ok + x.p.q_no)) * 100) }))
      .sort((a, b) => a.rate - b.rate).slice(0, 2);
    weak = list;
    paintWeek();
  }
  let week = null;
  function paintWeek() {
    if (!week) return;
    const max = Math.max(1, ...week.days.map((x) => x.n));
    const diff = week.total - week.last;
    weekBox.replaceChildren(...[
      h('div', { class: 'hm-tot' }, h('b', {}, week.total.toLocaleString()), h('span', {}, '문제')),
      h('div', { class: 'hm-cmp' }, week.last || week.total
        ? (diff >= 0 ? ['지난주보다 ', h('em', {}, `${diff.toLocaleString()}문제`), ' 더 풀었어요'] : ['지난주보다 ', h('em', {}, `${(-diff).toLocaleString()}문제`), ' 덜 풀었어요'])
        : '이번 주 첫 문제를 풀어 보세요'),
      h('div', { class: 'hm-bars' }, week.days.map((x, i) => h('div', { class: i === week.today ? 'on' : '' },
        i === week.today && x.n ? h('b', { style: { bottom: `calc(${Math.max(6, (x.n / max) * 100)}% + 30px)` } }, String(x.n)) : null,
        h('i', { style: { height: `${Math.max(6, (x.n / max) * 100)}%` } }),
        h('span', {}, DAY[i])))),
      weak?.length ? h('div', { class: 'hm-weak' }, h('div', { class: 'k' }, '정답률이 낮은 과목'),
        weak.map((w, i) => h('button', { class: 'hm-wr', onclick: () => go(`#/s/${w.sub.id}`) },
          h('span', { class: 'hm-tx' }, h('b', {}, w.sub.name), h('span', {}, `기출과 예상문제 ${w.p.q_ok + w.p.q_no}문항`)),
          h('span', { class: 'hm-rate' + (i === 0 && w.rate < 70 ? ' r' : '') }, `${w.rate}%`)))) : null].filter(Boolean));
  }
  loadWeek().then((w) => { week = w; paintWeek(); }).catch(() => weekBox.replaceChildren(h('div', { class: 'hm-empty' }, '인터넷에 연결되면 보입니다')));

  // ── 새 소식 ──
  async function paintNews() {
    let rows = [];
    try { rows = await listNotifs(10); } catch { newsBox.replaceChildren(h('div', { class: 'hm-empty' }, '인터넷에 연결되면 보입니다')); return; }
    if (!rows.length) { newsBox.replaceChildren(h('div', { class: 'hm-empty' }, '새 소식이 없습니다')); return; }
    newsBox.replaceChildren(...rows.map((n) => h('button', { class: 'hm-row', onclick: () => { markRead(n.id); if (n.link) go(n.link); } },
      h('span', { class: 'hm-ri' }, icon(NICON[n.kind] || 'bell')),
      h('span', { class: 'hm-tx' }, h('b', {}, n.title), n.body ? h('span', {}, n.body) : null),
      h('span', { class: 'hm-t' }, ago(n.created_at)),
      n.read_at ? null : h('i', { class: 'hm-dot', 'aria-label': '안 읽음' }))));
    refit();
  }
  paintNews();
  cleanups.push(onNotifChange(paintNews));

  // ── 화면 ──
  const bell = bellButton();
  const right = [h('button', { class: 'tool-ic', title: '건의하기', 'aria-label': '건의하기', onclick: () => openSuggest() }, icon('chat')), bell];
  const logo = h('button', { class: 'logo-btn', 'aria-label': '홈', onclick: () => go('#/home') },
    h('img', { class: 'logo-h', src: 'icons/logo-h.png', alt: '工夫韓醫 YRR STUDY' }));
  const root = shell({ title: logo, active: 'home', body, right, tone: 'gray', fit: 'home-fit' });
  const prevClean = root.cleanup;
  root.cleanup = () => { prevClean?.(); bell.cleanup?.(); cleanups.forEach((f) => f()); };
  if (q.get('open') === 'suggest') {
    history.replaceState(null, '', '#/home');
    setTimeout(() => openSuggest({ focusId: q.get('id') }), 250);
  }
  return root;
}

// 자료 열기
async function openFile(f) {
  markViewed(f);
  openPdf(f, { onComments: () => openComments(f, {}) });
}
async function openFav(x) {
  let f = null; let net = true;
  try { const r = await sb.from('files').select('*').eq('id', x.id).maybeSingle(); if (r.error) throw r.error; f = r.data; } catch { net = false; }
  if (!net) { f = savedFile(x.id); if (!f) { toast('인터넷에 연결되면 열 수 있습니다'); return; } openPdf(f); return; }
  if (!f) { toast('지워진 자료입니다'); return; }
  openFile(f);
}

// 학기 이동 (전체 열람 계정)
async function openSemMenu(anchor, g, s) {
  const { data } = await sb.from('subjects').select('grade,semester');
  const set = new Set((data || []).map((x) => `${x.grade}-${x.semester}`));
  set.add(`${S.grade}-${S.sem}`);
  const list = [...set].map((k) => k.split('-').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const p = popover(anchor, h('div', { class: 'menu-list' }, list.map(([gg, ss]) => h('button', {
    class: gg === g && ss === s ? 'on' : '',
    onclick: () => { p.close(); go(`#/home?g=${gg}&s=${ss}`); },
  }, gradeLabel(gg, ss), gg === g && ss === s ? icon('check', 'icon s') : null))));
}

// ─────────────────────────────────────────────
// 일정 고치기 : 전공 시험 날짜 / 일정 넣기 (학과 일정, 개인 일정)
// ─────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');

function openPlan(g, s, subjects, onChange) {
  let changed = false;
  const admin = seesAll();
  let grade = g;                       // 관리자는 학년을 골라 다른 학년 일정도 넣고 고침
  let tab = 'add';
  const tabs = seg([['add', '일정 넣기'], ['major', '전공 시험']], 'add', (v) => { tab = v; paint(); });
  const gradeSel = admin ? h('select', { class: 'pl-grade', 'aria-label': '학년' },
    [1, 2, 3, 4, 5, 6].map((n) => h('option', { value: n, selected: n === g }, gradeLabel(n)))) : null;
  gradeSel?.addEventListener('change', () => { grade = Number(gradeSel.value); paint(); });
  const area = h('div', { class: 'pl-area' });
  const m = modal({ title: '다가오는 일정', body: h('div', { class: 'pl' }, h('div', { class: 'pl-tabs' }, tabs, gradeSel), area), onClose: () => { if (changed) onChange(); } });
  m.box.classList.add('pl-modal');

  function paint() { area.replaceChildren(tab === 'add' ? addView() : majorView()); }

  const field = (label, ...ctl) => h('div', { class: 'pl-f' }, h('span', { class: 'pl-k' }, label), h('div', { class: 'pl-v' }, ...ctl));
  const dateInputs = (t) => {
    const d = t ? new Date(t) : null;
    const di = h('input', { class: 'input pl-d', type: 'date', value: d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '' });
    const ti = h('input', { class: 'input pl-t', type: 'time', step: 300, value: d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '' });
    const val = () => (di.value ? new Date(`${di.value}T${ti.value || '09:00'}`).toISOString() : null);
    return { di, ti, val };
  };

  // ── 전공 시험 : 중간, 기말 탭으로 나눠 과목마다 날짜 ──
  let rangeTab = null;
  function majorView() {
    const wrap = h('div', { class: 'pl-major' }, h('div', { class: 'hm-empty' }, '불러오는 중'));
    (grade === g ? Promise.resolve(subjects) : loadSubjects(grade, s).catch(() => [])).then((subs) => {
      if (!subs.length) { wrap.replaceChildren(h('div', { class: 'hm-empty' }, '이 학기에 과목이 없습니다')); return; }
      // 탭은 중간, 기말 두 개뿐. 다른 이름의 범위(예: 2학기)는 기말 탭에
      const tabOf = (r) => (r.name === '중간' ? '중간' : '기말');
      if (!['중간', '기말'].includes(rangeTab)) {
        const soon = subs.flatMap((x) => x.ranges).filter((r) => r.exam_at && dDays(r.exam_at) >= 0).sort((p, q) => new Date(p.exam_at) - new Date(q.exam_at))[0];
        rangeTab = soon ? tabOf(soon) : (new Date().getMonth() % 6 < 3 ? '중간' : '기말');
      }
      const list = h('div', { class: 'pl-rows' });
      const sub = seg([['중간', '중간'], ['기말', '기말']], rangeTab, (v) => { rangeTab = v; fill(); });
      function fill() {
        const rows = [];
        for (const x of subs) for (const r of x.ranges) if (tabOf(r) === rangeTab) rows.push([x, r]);
        if (!rows.length) { list.replaceChildren(h('div', { class: 'hm-empty' }, `${rangeTab} 범위가 있는 과목이 없습니다`)); return; }
        list.replaceChildren(...rows.map(([x, r]) => {
          const { di, ti, val } = dateInputs(r.exam_at);
          const clr = h('button', { class: 'hm-ic pl-clr', 'aria-label': '날짜 지우기', title: '날짜 지우기' }, icon('x'));
          clr.style.visibility = r.exam_at ? 'visible' : 'hidden';
          const save = async (v) => {
            const { error } = await setExam(r.id, v);
            if (error) { toast('저장하지 못했습니다'); return; }
            r.exam_at = v; changed = true; clr.style.visibility = v ? 'visible' : 'hidden'; toast('저장했습니다');
          };
          di.addEventListener('change', () => { if (di.value && !ti.value) ti.value = '09:00'; save(val()); });
          ti.addEventListener('change', () => { if (di.value) save(val()); });
          clr.addEventListener('click', () => { di.value = ''; ti.value = ''; save(null); });
          return h('div', { class: 'pl-row' },
            h('span', { class: 'pl-emo' }, x.icon || x.name.slice(0, 1)),
            h('span', { class: 'pl-tx' }, h('b', {}, x.name), /^(중간|기말)$/.test(r.name) ? null : h('span', {}, r.name)),
            di, ti, clr);
        }));
      }
      fill();
      wrap.replaceChildren(...[sub, list, h('p', { class: 'pl-note' }, `${gradeLabel(grade)} 학생 모두에게 보이고, 누구나 고칠 수 있습니다`)].filter(Boolean));
    });
    return wrap;
  }

  // ── 일정 넣기 : 학과 / 개인, 시험 / 과제 / 기타 ──
  function addView() {
    let scopeV = 'me';
    const hint = h('p', { class: 'pl-note' });
    const sh = () => { hint.textContent = scopeV === 'grade' ? `${gradeLabel(grade)} 학생 모두에게 보이고, 누구나 고치고 지울 수 있습니다` : '나에게만 보입니다'; };
    const scope = seg([['me', '개인 일정'], ['grade', '학과 일정']], 'me', (v) => { scopeV = v; sh(); });
    const kind = seg([['exam', '시험'], ['task', '과제'], ['etc', '기타']], 'exam');
    const title = h('input', { class: 'input', placeholder: '예: 교양 영어 중간고사', maxlength: 60 });
    const dflt = new Date(); dflt.setDate(dflt.getDate() + 1); dflt.setHours(9, 0, 0, 0);
    const { di, ti, val } = dateInputs(dflt);
    sh();
    const list = h('div', { class: 'pl-saved' });
    const add = h('button', { class: 'btn primary pl-add', onclick: async () => {
      const t = title.value.trim();
      if (!t) { title.focus(); return; }
      if (!di.value) { di.focus(); return; }
      add.disabled = true;
      const row = { scope: scopeV, kind: kind.get(), title: t, at: val(), ...(scopeV === 'grade' ? { grade } : {}) };
      const { error } = await addEvent(row);
      add.disabled = false;
      if (error) { toast('넣지 못했습니다'); return; }
      changed = true; title.value = ''; toast('넣었습니다'); loadList();
    } }, '넣기');
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) add.click(); });

    async function loadList() {
      const evs = await loadEvents(grade);
      if (!evs.length) { list.replaceChildren(); return; }
      list.replaceChildren(h('div', { class: 'pl-sh' }, '넣어 둔 일정'), ...evs.map((e) => {
        const d = new Date(e.at);
        let armed = 0;
        const del = h('button', { class: 'hm-ic pl-del', 'aria-label': '지우기', title: '지우기' }, icon('trash'));
        del.onclick = async () => {
          if (Date.now() - armed > 3000) { armed = Date.now(); del.classList.add('arm'); setTimeout(() => del.classList.remove('arm'), 3000); return; }
          const { error } = await deleteEvent(e.id);
          if (error) { toast('지우지 못했습니다'); return; }
          changed = true; loadList();
        };
        return h('div', { class: 'pl-ev' },
          h('span', { class: 'hm-dt' }, h('b', {}, String(d.getDate())), h('span', {}, `${d.getMonth() + 1}월 ${DAY[d.getDay()]}`)),
          h('span', { class: 'hm-tx' }, h('b', {}, e.title), h('span', {}, `${e.scope === 'grade' ? '학과' : '개인'} ${{ exam: '시험', task: '과제', etc: '일정' }[e.kind]}, ${hm(e.at)}`)),
          del);
      }));
    }
    loadList();
    return h('div', { class: 'pl-add-wrap' },
      h('div', { class: 'pl-form' },
        field('대상', scope),
        field('종류', kind),
        field('이름', title),
        field('날짜', di, ti)),
      hint, add, list);
  }
  paint();
  return m;
}

// ─────────────────────────────────────────────
// 찾기 : 과목, 자료, 카드 (⌘K)
// ─────────────────────────────────────────────
let searchOpen = null;
function openSearch() {
  if (searchOpen) { searchOpen.focus(); return; }
  const inp = h('input', { class: 'sr-in', placeholder: '과목, 자료, 카드 찾기', autocomplete: 'off', enterkeyhint: 'search' });
  const res = h('div', { class: 'sr-res' });
  const box = h('div', { class: 'sr-box', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'sr-top' }, icon('search'), inp), res);
  const wrap = h('div', { class: 'sr-wrap', onclick: (e) => { if (e.target === wrap) close(); } }, box);
  document.body.append(wrap);
  requestAnimationFrame(() => { wrap.classList.add('on'); inp.focus(); });
  searchOpen = inp;
  let sel = 0; let items = [];
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); mark(); }
    if (e.key === 'Enter' && !e.isComposing && items[sel]) { e.preventDefault(); items[sel].click(); }
  };
  document.addEventListener('keydown', onKey);
  function close() { wrap.classList.remove('on'); document.removeEventListener('keydown', onKey); searchOpen = null; setTimeout(() => wrap.remove(), 220); }
  const mark = () => items.forEach((b, i) => b.classList.toggle('sel', i === sel));
  const row = (ic, t, sub, fn) => h('button', { class: 'hm-row', onclick: () => { close(); fn(); } }, h('span', { class: 'hm-ri' }, ic), h('span', { class: 'hm-tx' }, h('b', {}, t), sub ? h('span', {}, sub) : null));
  let tm = 0; let seq = 0;
  inp.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(run, 180); });
  async function run() {
    const qv = inp.value.trim().replace(/[%,()]/g, ' ').trim();
    const my = ++seq;
    if (!qv) { res.replaceChildren(); items = []; return; }
    const like = `%${qv}%`;
    const [subs, files, cards] = await Promise.all([
      sb.from('subjects').select('id,name,icon,grade,semester').ilike('name', like).limit(6),
      sb.from('files').select('*,subjects(name)').or(`series.ilike.${like},filename.ilike.${like}`).limit(6),
      sb.from('flash_cards').select('id,front,back,range_id,ranges(subject_id,subjects(name))').or(`front.ilike.${like},back.ilike.${like}`).limit(8),
    ]);
    if (my !== seq) return;
    const out = [];
    if (subs.data?.length) out.push(h('h3', { class: 'hm-h3' }, '과목'), ...subs.data.map((x) => row(h('span', { class: 'sr-emo' }, x.icon || x.name.slice(0, 1)), x.name, gradeLabel(x.grade, x.semester), () => go(`#/s/${x.id}`))));
    if (files.data?.length) out.push(h('h3', { class: 'hm-h3' }, '자료'), ...files.data.map((f) => row(icon('file'), fileTitle(f), f.subjects?.name, () => openFile(f))));
    if (cards.data?.length) out.push(h('h3', { class: 'hm-h3' }, '카드'), ...cards.data.map((c) => row(icon('layers'), c.front.split('\n')[0].slice(0, 60), `${c.ranges?.subjects?.name || ''}${c.back ? `, ${c.back.split('\n')[0].slice(0, 40)}` : ''}`,
      () => go(`#/s/${c.ranges?.subject_id}?r=${c.range_id}&b=flash`))));
    if (!out.length) out.push(h('div', { class: 'hm-empty' }, '찾는 내용이 없습니다'));
    res.replaceChildren(...out);
    items = [...res.querySelectorAll('.hm-row')]; sel = 0; mark();
  }
}
