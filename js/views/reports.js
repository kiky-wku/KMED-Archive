import { h, icon, drawer, seg, ago, toast, shake, skelRows } from '../ui.js';
import { S, isAdmin, go } from '../app.js';
import {
  listReports, listSuggests, sendReport, resolveReport, deleteReport,
  listNotifs, unreadNotifs, markRead, markAllRead, onNotifChange, cleanupNotifs,
} from '../data/reports.js';
import { pushState, enablePush, disablePush, testPush } from '../data/push.js';

const KLABEL = { typo: '오타', error: '오류', suggest: '건의' };

// ─────────────────────────────────────────────
// 과목 제보 (사이렌)
//  위 : 쓰기 (오타 / 오류 + 지금 보던 곳 자동 첨부)
//  아래 : 이 과목 제보 전체 (쓴 사람 이름 공개)
// ─────────────────────────────────────────────
export function openReports({ subject, range, block, tabLabel, here, hash, canWrite, focusId }) {
  let kind = 'typo';
  let attach = true;
  const ctxText = [range?.name, tabLabel, here].filter(Boolean).join(' › ');
  const ta = h('textarea', { class: 'rp-in', rows: 3, maxlength: 2000, placeholder: '어디가 어떻게 틀렸는지 적어주세요' });
  const chip = ctxText ? h('div', { class: 'rp-ctx' },
    h('span', { class: 'k' }, '보던 곳'), h('span', { class: 'v' }, ctxText),
    h('button', { class: 'x', 'aria-label': '빼기', onclick: () => { attach = false; chip.classList.add('off'); setTimeout(() => chip.remove(), 200); } }, icon('x', 'icon s'))) : null;
  const sendBtn = h('button', { class: 'btn sm', onclick: send }, '보내기');
  const list = h('div', { class: 'rp-list' }, skelRows(3, 84));

  const body = h('div', { class: 'rp' },
    h('div', { class: 'rp-write' },
      seg([['typo', '오타'], ['error', '오류']], kind, (v) => { kind = v; }),
      chip, ta,
      h('div', { class: 'rp-foot' }, h('span', { class: 'rp-note' }, `${subject.name} 담당에게 바로 알림이 갑니다`), sendBtn)),
    h('div', { class: 'rp-h' }, '이 과목 제보'),
    list);
  const d = drawer({ title: '제보하기', body });
  d.panel.classList.add('wide');

  async function send() {
    const text = ta.value.trim();
    if (!text) { shake(ta); ta.focus(); return; }
    sendBtn.disabled = true;
    try {
      const r = await sendReport({
        kind, subject_id: subject.id, range_id: range?.id || null, block,
        context: attach ? { range: range?.name, tab: tabLabel, item: here, hash } : { hash },
        body: text,
      });
      ta.value = '';
      rows.unshift(r); paint(r.id);
      toast('제보를 보냈습니다');
    } catch (e) { toast(e.message || '보내지 못했습니다'); }
    sendBtn.disabled = false;
  }

  let rows = [];
  listReports(subject.id).then((r) => { rows = r; paint(focusId); }).catch(() => list.replaceChildren(h('div', { class: 'rp-empty' }, '목록을 불러오지 못했습니다')));

  function paint(flash) {
    if (!rows.length) { list.replaceChildren(h('div', { class: 'rp-empty' }, '아직 제보가 없습니다')); return; }
    const open = rows.filter((r) => r.status === 'open'); const done = rows.filter((r) => r.status === 'done');
    list.replaceChildren(...[...open, ...done].map((r, i) => card(r, i, canWrite, () => paint(), (id) => { rows = rows.filter((x) => x.id !== id); paint(); })));
    if (flash) {
      const el = list.querySelector(`[data-id="${flash}"]`);
      if (el) { el.classList.add('flash'); setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320); }
    }
  }
  return d;
}

// ─────────────────────────────────────────────
// 건의사항 (관리자만 받음)
// ─────────────────────────────────────────────
export function openSuggest({ focusId } = {}) {
  const admin = isAdmin();
  const ta = h('textarea', { class: 'rp-in', rows: 4, maxlength: 2000, placeholder: '앱에 바라는 점, 불편한 점을 적어주세요' });
  const sendBtn = h('button', { class: 'btn sm', onclick: send }, '보내기');
  const list = h('div', { class: 'rp-list' }, skelRows(2, 84));
  const body = h('div', { class: 'rp' },
    h('div', { class: 'rp-write' }, ta,
      h('div', { class: 'rp-foot' }, h('span', { class: 'rp-note' }, '관리자에게만 보입니다'), sendBtn)),
    h('div', { class: 'rp-h' }, admin ? '받은 건의' : '내가 보낸 건의'),
    list);
  const d = drawer({ title: '건의하기', body });
  d.panel.classList.add('wide');

  let rows = [];
  async function send() {
    const text = ta.value.trim();
    if (!text) { shake(ta); ta.focus(); return; }
    sendBtn.disabled = true;
    try { const r = await sendReport({ kind: 'suggest', body: text, context: {} }); ta.value = ''; rows.unshift(r); paint(r.id); toast('건의를 보냈습니다'); }
    catch (e) { toast(e.message || '보내지 못했습니다'); }
    sendBtn.disabled = false;
  }
  listSuggests().then((r) => { rows = r; paint(focusId); }).catch(() => list.replaceChildren(h('div', { class: 'rp-empty' }, '목록을 불러오지 못했습니다')));
  function paint(flash) {
    if (!rows.length) { list.replaceChildren(h('div', { class: 'rp-empty' }, admin ? '받은 건의가 없습니다' : '보낸 건의가 없습니다')); return; }
    const open = rows.filter((r) => r.status === 'open'); const done = rows.filter((r) => r.status === 'done');
    list.replaceChildren(...[...open, ...done].map((r, i) => card(r, i, admin, () => paint(), (id) => { rows = rows.filter((x) => x.id !== id); paint(); })));
    if (flash) {
      const el = list.querySelector(`[data-id="${flash}"]`);
      if (el) { el.classList.add('flash'); setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320); }
    }
  }
  return d;
}

// 제보 · 건의 카드 하나
function card(r, i, canResolve, repaint, removed) {
  const mine = r.author === S.user.id;
  const el = h('article', { class: `rp-card st-${r.status}`, 'data-id': r.id, style: { animationDelay: `${Math.min(i, 8) * 0.03}s` } });
  const ctx = r.context || {};
  const where = [ctx.range, ctx.tab, ctx.item].filter(Boolean).join(' › ');
  const acts = h('div', { class: 'rp-acts' });

  if (canResolve) {
    if (r.status === 'open') {
      acts.append(h('button', { class: 'rp-btn ok', onclick: () => {
        const inp = h('input', { class: 'rp-reply-in', placeholder: '한마디 남기기 (선택)', maxlength: 300 });
        const fin = async () => {
          try { await resolveReport(r.id, true, inp.value.trim()); Object.assign(r, { status: 'done', reply: inp.value.trim() || null, done_by: S.user.id, done_name: S.profile.name }); repaint(); toast('처리 완료로 바꿨습니다'); }
          catch (e) { toast(e.message || '바꾸지 못했습니다'); }
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) fin(); });
        acts.replaceChildren(inp, h('button', { class: 'rp-btn ok', onclick: fin }, '완료'));
        el.classList.add('replying'); inp.focus();
      } }, icon('check', 'icon s'), '처리 완료'));
    } else {
      acts.append(h('button', { class: 'rp-btn', onclick: async () => {
        try { await resolveReport(r.id, false); Object.assign(r, { status: 'open', reply: null }); repaint(); } catch (e) { toast(e.message || '바꾸지 못했습니다'); }
      } }, '되돌리기'));
    }
  }
  if ((mine && r.status === 'open') || isAdmin()) {
    let armed = 0;
    const del = h('button', { class: 'rp-btn del', onclick: async () => {
      if (Date.now() - armed > 2500) { armed = Date.now(); del.textContent = '한 번 더'; del.classList.add('armed'); setTimeout(() => { del.textContent = '지우기'; del.classList.remove('armed'); }, 2500); return; }
      try { await deleteReport(r.id); el.classList.add('gone'); setTimeout(() => removed(r.id), 220); } catch (e) { toast(e.message || '지우지 못했습니다'); }
    } }, '지우기');
    acts.append(del);
  }

  el.append(...[
    h('div', { class: 'rp-top' },
      h('span', { class: `rp-tag ${r.kind}` }, KLABEL[r.kind]),
      h('b', { class: 'rp-who' }, r.author_name || '알 수 없음', mine ? h('i', {}, '나') : null),
      h('span', { class: 'rp-time' }, ago(r.created_at)),
      r.status === 'done' ? h('span', { class: 'rp-done' }, icon('check', 'icon s'), '처리됨') : null),
    where ? h('div', { class: 'rp-where' }, where) : null,
    h('p', { class: 'rp-body' }, r.body),
    r.status === 'done' && (r.reply || r.done_name) ? h('div', { class: 'rp-reply' }, h('b', {}, r.done_name || '담당'), r.reply || '처리했습니다') : null,
    acts.childNodes.length ? acts : null].filter(Boolean));
  return el;
}

// ─────────────────────────────────────────────
// 알림 목록
// ─────────────────────────────────────────────
const NICON = { report: 'siren', suggest: 'chat', done: 'check', upload: 'file' };
export function openNotifs() {
  const list = h('div', { class: 'nt-list' }, skelRows(5, 64));
  const allBtn = h('button', { class: 'nt-all', onclick: async () => { await markAllRead(); list.querySelectorAll('.nt.new').forEach((x) => x.classList.remove('new')); allBtn.disabled = true; } }, '모두 읽음');
  const d = drawer({ title: '알림', body: h('div', {}, pushRow(), h('div', { class: 'nt-bar' }, allBtn), list) });
  listNotifs().then((rows) => {
    allBtn.disabled = !rows.some((n) => !n.read_at);
    if (!rows.length) { list.replaceChildren(h('div', { class: 'rp-empty' }, '알림이 없습니다')); return; }
    list.replaceChildren(...rows.map((n, i) => h('button', { class: 'nt' + (n.read_at ? '' : ' new'), style: { animationDelay: `${Math.min(i, 10) * 0.025}s` },
      onclick: () => { markRead(n.id); d.close(); if (n.link) setTimeout(() => go(n.link), 200); } },
      h('span', { class: `nt-ic k-${n.kind}` }, icon(NICON[n.kind] || 'bell', 'icon s')),
      h('span', { class: 'nt-tx' },
        h('span', { class: 'nt-t' }, n.title),
        n.body ? h('span', { class: 'nt-b' }, n.body) : null,
        h('span', { class: 'nt-m' }, [n.actor, ago(n.created_at)].filter(Boolean).join(', '))))));
  }).catch(() => list.replaceChildren(h('div', { class: 'rp-empty' }, '알림을 불러오지 못했습니다')));
  return d;
}

// 오른쪽 위 종 버튼 (안 읽은 수 배지)
export function bellButton() {
  const badge = h('i', { class: 'bdg' });
  const b = h('button', { class: 'tool-ic bell', title: '알림', 'aria-label': '알림', onclick: () => openNotifs() }, icon('bell'), badge);
  const refresh = () => unreadNotifs(1).then(({ count }) => { badge.textContent = count > 99 ? '99+' : count || ''; b.classList.toggle('has', count > 0); });
  refresh();
  const off = onNotifChange(refresh);
  b.cleanup = off;
  return b;
}

// ─────────────────────────────────────────────
// 홈 : 안 읽은 알림을 잠금화면처럼 겹쳐서
//  누르면 펼침 → 다시 누르면 이동, 옆으로 밀면 읽음
// ─────────────────────────────────────────────
export function noticeStack() {
  const el = h('div', { class: 'ns' });
  let rows = []; let total = 0; let spread = false;
  const load = () => unreadNotifs(6).then(({ rows: r, count }) => { rows = r; total = count; paint(); });
  load();
  cleanupNotifs();
  const off = onNotifChange(load);
  el.cleanup = off;

  function paint() {
    if (!rows.length) { el.classList.remove('on'); el.replaceChildren(); return; }
    el.classList.add('on');
    el.classList.toggle('spread', spread);
    const shown = rows.slice(0, spread ? 6 : 3);
    const cards = shown.map((n, i) => {
      const c = h('div', { class: 'ns-card', style: { '--i': i, zIndex: 10 - i } },
        h('span', { class: `nt-ic k-${n.kind}` }, icon(NICON[n.kind] || 'bell', 'icon s')),
        h('span', { class: 'nt-tx' },
          h('span', { class: 'nt-t' }, n.title, h('em', {}, ago(n.created_at))),
          n.body ? h('span', { class: 'nt-b' }, n.body) : null));
      swipe(c, n, i);
      return c;
    });
    const more = total - shown.length;
    el.replaceChildren(
      h('div', { class: 'ns-head' }, h('b', {}, '알림'), h('span', {}, `${total}개`),
        spread ? h('button', { class: 'ns-fold', onclick: () => { spread = false; paint(); } }, '접기') : null,
        h('button', { class: 'ns-clear', onclick: () => markAllRead() }, '모두 읽음')),
      h('div', { class: 'ns-cards' }, cards),
      ...(spread && more > 0 ? [h('button', { class: 'ns-more', onclick: () => openNotifs() }, `${more}개 더 보기`)] : []));
  }

  // 밀어서 읽음 · 눌러서 펼치기/이동
  function swipe(c, n, i) {
    let sx = 0; let dx = 0; let moving = false; let pid = null;
    c.addEventListener('pointerdown', (e) => { pid = e.pointerId; sx = e.clientX; dx = 0; moving = false; c.setPointerCapture(pid); c.style.transition = 'none'; });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      dx = e.clientX - sx;
      if (Math.abs(dx) > 6) moving = true;
      if (moving && (spread || i === 0)) c.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
    });
    const up = (e) => {
      if (e.pointerId !== pid) return; pid = null;
      c.style.transition = '';
      if (moving && Math.abs(dx) > 90 && (spread || i === 0)) {
        c.style.transform = `translateX(${dx > 0 ? 120 : -120}%)`; c.style.opacity = '0';
        rows = rows.filter((x) => x !== n); total -= 1;
        setTimeout(() => { markRead(n.id); }, 220);
        return;
      }
      c.style.transform = '';
      if (moving) return;
      if (!spread && rows.length > 1) { spread = true; paint(); return; }
      markRead(n.id);
      if (n.link) go(n.link);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }
  return el;
}

// ─────────────────────────────────────────────
// 푸시 알림 켜기 · 끄기 (알림 서랍 맨 위)
// ─────────────────────────────────────────────
const PUSH_SUB = {
  on: '휴대폰 알림으로도 받습니다',
  off: '앱을 닫아 둬도 알림이 옵니다',
  denied: '기기 설정에서 이 앱의 알림을 허용해 주세요',
  install: '공유 버튼에서 홈 화면에 추가한 뒤 그 앱에서 켤 수 있습니다',
  unsupported: '이 브라우저에서는 쓸 수 없습니다',
};
export function pushRow() {
  const sw = h('button', { class: 'sw', role: 'switch', 'aria-label': '푸시 알림' }, h('i'));
  const sub = h('span', { class: 'pr-s' });
  const test = h('button', { class: 'pr-test', onclick: async () => { test.disabled = true; try { await testPush(); toast('시험 알림을 보냈습니다'); } catch (e) { toast(e.message); } test.disabled = false; } }, '시험');
  const row = h('div', { class: 'pr' }, h('span', { class: 'pr-ic' }, icon('bell', 'icon s')),
    h('span', { class: 'pr-tx' }, h('b', {}, '푸시 알림'), sub), test, sw);
  let st = 'off';
  const paint = () => {
    sub.textContent = PUSH_SUB[st];
    sw.classList.toggle('on', st === 'on');
    sw.disabled = st === 'install' || st === 'unsupported';
    sw.setAttribute('aria-checked', st === 'on');
    test.style.display = st === 'on' ? '' : 'none';
    row.classList.toggle('warn', st === 'denied' || st === 'install');
  };
  pushState().then((s) => { st = s; paint(); });
  sw.addEventListener('click', async () => {
    if (sw.classList.contains('busy')) return;
    sw.classList.add('busy');
    try {
      if (st === 'on') { await disablePush(); st = 'off'; toast('푸시 알림을 껐습니다'); }
      else { sw.classList.add('on'); await enablePush(); st = 'on'; toast('푸시 알림을 켰습니다'); }
    } catch (e) { toast(e.message || '바꾸지 못했습니다'); st = await pushState(); }
    sw.classList.remove('busy'); paint();
  });
  paint();
  return row;
}

// 홈 : 아직 안 켠 사람에게 한 번 권하기 (닫으면 다시 안 뜸)
export function pushNudge() {
  const el = h('div', { class: 'pn' });
  let gone = false;
  try { gone = localStorage.getItem('kmed:push-nudge') === 'x'; } catch { /* 무시 */ }
  if (gone) return el;
  pushState().then((s) => {
    if (s !== 'off' && s !== 'install') return;
    const close = () => { try { localStorage.setItem('kmed:push-nudge', 'x'); } catch { /* 무시 */ } el.classList.add('out'); setTimeout(() => el.replaceChildren(), 250); };
    el.replaceChildren(h('div', { class: 'pn-card' },
      h('span', { class: 'pr-ic' }, icon('bell', 'icon s')),
      h('span', { class: 'pr-tx' }, h('b', {}, '새 자료 알림 받기'), h('span', { class: 'pr-s' }, s === 'install' ? PUSH_SUB.install : '새 써머리가 올라오면 알려드립니다')),
      s === 'off' ? h('button', { class: 'btn sm', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { await enablePush(); toast('푸시 알림을 켰습니다'); close(); } catch (err) { toast(err.message); b.disabled = false; }
      } }, '켜기') : null,
      h('button', { class: 'pn-x', 'aria-label': '닫기', onclick: close }, icon('x', 'icon s'))));
  });
  return el;
}
