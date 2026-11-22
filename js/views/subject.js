import { sb } from '../sb.js';
import { h, icon, seg, popover } from '../ui.js';
import { S, go, isAdmin } from '../app.js';
import { openDataSheet } from './data-sheet.js';
import { openReports } from './reports.js';
import { openEditSheet, editKinds, editKindOf } from './edit-sheet.js';
import { shell } from './shell.js';
import { BLOCK_KINDS } from './admin.js';
import { formatsFor } from '../data/formats.js';
import { hanjaQuiz } from '../blocks/hanja-quiz.js';
import { hanjaGrid } from '../blocks/hanja-grid.js';
import { jungTranslate } from '../blocks/jung-translate.js';
import { umOrder } from '../blocks/um-order.js';
import { umAnswers } from '../blocks/um-answers.js';
import { wordbook } from '../blocks/wordbook.js';
import { flash } from '../blocks/flash.js';
import { filesBlock } from '../blocks/files.js';
import { statsBlock } from '../blocks/stats.js';
import { hasStats } from '../data/stats.js';

// 탭 종류 → 화면
const RENDER = {
  hanja_r: (ctx, el) => hanjaQuiz(ctx, el, 'r'),
  hanja_h: (ctx, el) => hanjaQuiz(ctx, el, 'h'),
  hanja_grid: (ctx, el) => hanjaGrid(ctx, el),
  jung_translate: (ctx, el) => jungTranslate(ctx, el),
  um_order: (ctx, el) => umOrder(ctx, el),
  um_answers: (ctx, el) => umAnswers(ctx, el),
  wordbook: (ctx, el) => wordbook(ctx, el),
  flash: (ctx, el) => flash(ctx, el),
  summary: (ctx, el) => filesBlock(ctx, el),
  stats: (ctx, el) => statsBlock(ctx, el),
};

// 화면에 꼭 맞게 고정 (스크롤 없음)
const FIT = new Set(['hanja_r', 'hanja_h', 'jung_translate', 'flash']);

// 과목 화면 : #/s/{과목}?r={범위}&b={탭}
export function subjectView(id, q) {
  const titleEl = h('div', { class: 'ttl subj-ttl' });
  const right = h('div', { class: 'subj-right' });
  const tabs = h('nav', { class: 'tabs', role: 'tablist' });
  // 오른쪽에 탭이 더 있으면 끝을 흐리게
  const fade = () => tabs.classList.toggle('more', tabs.scrollWidth - tabs.clientWidth - tabs.scrollLeft > 4);
  tabs.addEventListener('scroll', fade, { passive: true });
  new ResizeObserver(fade).observe(tabs);
  const area = h('div', { class: 'block-area' });
  const back = h('button', { class: 'ib', 'aria-label': '뒤로', onclick: () => go('#/home') }, icon('back'));
  const root = shell({ title: titleEl, left: back, right, body: h('div', { class: 'subj-body' }, tabs, area), tone: 'gray' });

  let cleanup = null;
  const prev = root.cleanup;
  root.cleanup = () => { cleanup?.(); prev?.(); };

  (async () => {
    const { data: sub } = await sb.from('subjects').select('*, ranges(id,name,sort), blocks(kind,title,sort)').eq('id', id).single();
    if (!sub) { area.replaceChildren(h('div', { class: 'empty' }, '과목을 찾을 수 없습니다')); return; }
    const ranges = (sub.ranges || []).sort((a, b) => a.sort - b.sort);
    const blocks = [...(sub.blocks || [])].filter((b) => b.kind !== 'stats').sort((a, b) => a.sort - b.sort);
    // 문제가 있는 과목은 맨 끝에 통계 탭
    if (hasStats(blocks.map((b) => b.kind))) blocks.push({ kind: 'stats', title: '통계', sort: 999 });
    titleEl.replaceChildren(sub.icon ? h('span', { class: 'emo' }, sub.icon) : null, sub.name);

    let rangeId = ranges.find((r) => r.id === q.get('r'))?.id || ranges[0]?.id;
    let kind = blocks.find((b) => b.kind === q.get('b'))?.kind || blocks[0]?.kind;

    // 데이터 넣기 : 관리자 · 이 과목 담당
    const canWrite = isAdmin() || !!(await sb.from('subject_writers').select('subject_id').eq('user_id', S.user.id).eq('subject_id', id).maybeSingle()).data;
    // 제보 (사이렌) : 모두
    let ctxNow = null;
    const report = (focusId) => openReports({
      subject: sub, range: ranges.find((r) => r.id === rangeId), block: kind,
      tabLabel: tabBtns[blocks.findIndex((b) => b.kind === kind)]?.textContent, here: focusId ? null : ctxNow?.here,
      hash: location.hash, canWrite, focusId,
      onEdit: canWrite && kinds.length ? (r) => {
        const item = r.context?.item || '';
        const k = editKindOf(r.block);
        const q = !item ? '' : k === 'flash' ? item.split(' / ')[0] : k === 'hanja' ? item.split(' ')[0] : item.slice(0, 10);
        edit(k, q);
      } : null,
    });
    const kinds = editKinds(blocks.map((b) => b.kind));
    const edit = (k, query) => openEditSheet({ sub, range: ranges.find((r) => r.id === rangeId), pool: sub.progress_pool || sub.id, kind: k || editKindOf(kind), query, onDone: () => show() });
    // 오른쪽 위 도구 : 넓은 화면은 아이콘 그대로, 휴대폰은 ⋯ 하나로 모음
    const tools = [['siren', '제보하기', () => report(), 'siren-btn']];
    if (canWrite && kinds.length) tools.push(['editlist', '데이터 편집', () => edit(), '']);
    if (canWrite && formatsFor(blocks.map((b) => b.kind)).length) tools.push(['import', '데이터 넣기', () => openDataSheet(sub, ranges.find((r) => r.id === rangeId), () => show()), 'data-btn']);
    const toolBox = h('div', { class: 'subj-tools' }, tools.map(([ic, label, fn, cls]) => h('button', { class: `tool-ic ${cls}`, title: label, 'aria-label': label, onclick: fn }, icon(ic))));
    const more = h('button', { class: 'tool-ic subj-more', 'aria-label': '더보기', onclick: () => {
      const p = popover(more, h('div', { class: 'menu-list' }, tools.map(([ic, label, fn, cls]) => h('button', { class: cls, onclick: () => { p.close(); fn(); } }, icon(ic, 'icon s'), label))), { align: 'right' });
    } }, icon('more'));
    right.append(toolBox, more);
    if (ranges.length > 1) right.prepend(seg(ranges.map((r) => [r.id, r.name]), rangeId, (v) => { rangeId = v; show(); }));
    const tabBtns = blocks.map((b) => h('button', { role: 'tab', class: 'tab', onclick: () => { kind = b.kind; show(); } },
      (BLOCK_KINDS.find((k) => k[0] === b.kind) || [0, b.title])[1]));
    tabs.replaceChildren(...tabBtns, h('i', { class: 'tab-ind' }));

    if (!blocks.length) { area.replaceChildren(h('div', { class: 'empty' }, '탭이 없습니다')); return; }

    let curBtn = null;
    const ro = new ResizeObserver(() => moveIndicator(tabs, curBtn));
    ro.observe(tabs);
    const prevClean = root.cleanup;
    root.cleanup = () => { ro.disconnect(); prevClean?.(); };

    let first = true;
    function show() {
      const i = blocks.findIndex((b) => b.kind === kind);
      curBtn = tabBtns[i];
      tabBtns.forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-selected', j === i); });
      moveIndicator(tabs, tabBtns[i]);
      tabBtns[i].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      history.replaceState(null, '', `#/s/${id}?r=${rangeId}&b=${kind}`);

      cleanup?.(); cleanup = null;
      area.replaceChildren();
      area.classList.remove('swap', 'q-in'); void area.offsetWidth; area.classList.add('swap');
      root.classList.toggle('fit', FIT.has(kind));
      const range = ranges.find((r) => r.id === rangeId);
      const ctx = { retry: first && q.get('retry') === '1', openComments: first && q.get('open') === 'comments' ? q.get('id') : null, subject: sub, range, canWrite, pool: sub.progress_pool || sub.id, fit: (on) => root.classList.toggle('fit', !!on), here: null };
      ctxNow = ctx;
      first = false;
      const fn = RENDER[kind];
      if (fn) cleanup = fn(ctx, area) || null;
      else area.append(h('div', { class: 'empty' }, '준비 중입니다'));

      // 이어서 하기
      const label = `${sub.name}${ranges.length > 1 ? ' ' + range.name : ''} · ${tabBtns[i].textContent}`;
      // 문제 푸는 탭만 기억 (자료 · 통계 · 목록은 빼고)
      if (!['summary', 'stats', 'hanja_grid', 'um_answers'].includes(kind)) sb.from('user_state').upsert({ user_id: S.user.id, key: 'last', value: { hash: location.hash, label }, updated_at: new Date().toISOString() });
    }
    show();
    // 알림에서 넘어온 경우
    if (q.get('open') === 'report') setTimeout(() => report(q.get('id')), 300);
  })();

  return root;
}

function moveIndicator(tabs, btn) {
  const ind = tabs.querySelector('.tab-ind');
  if (!ind || !btn) return;
  requestAnimationFrame(() => {
    if (!btn.offsetWidth) return;
    if (!ind.style.width) { ind.style.transition = 'none'; requestAnimationFrame(() => { ind.style.transition = ''; }); }
    ind.style.width = `${btn.offsetWidth}px`;
    ind.style.transform = `translateX(${btn.offsetLeft}px)`;
  });
}
