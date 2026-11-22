import { sb } from '../sb.js';
import { h, icon, seg } from '../ui.js';
import { S, go, isAdmin } from '../app.js';
import { openDataSheet } from './data-sheet.js';
import { shell } from './shell.js';
import { BLOCK_KINDS } from './admin.js';
import { formatsFor } from '../data/formats.js';
import { hanjaQuiz } from '../blocks/hanja-quiz.js';
import { hanjaGrid } from '../blocks/hanja-grid.js';
import { jungTranslate } from '../blocks/jung-translate.js';
import { umOrder } from '../blocks/um-order.js';
import { umAnswers } from '../blocks/um-answers.js';
import { wordbook } from '../blocks/wordbook.js';

// 탭 종류 → 화면
const RENDER = {
  hanja_r: (ctx, el) => hanjaQuiz(ctx, el, 'r'),
  hanja_h: (ctx, el) => hanjaQuiz(ctx, el, 'h'),
  hanja_grid: (ctx, el) => hanjaGrid(ctx, el),
  jung_translate: (ctx, el) => jungTranslate(ctx, el),
  um_order: (ctx, el) => umOrder(ctx, el),
  um_answers: (ctx, el) => umAnswers(ctx, el),
  wordbook: (ctx, el) => wordbook(ctx, el),
};

// 화면에 꼭 맞게 고정 (스크롤 없음)
const FIT = new Set(['hanja_r', 'hanja_h', 'jung_translate']);

// 과목 화면 : #/s/{과목}?r={범위}&b={탭}
export function subjectView(id, q) {
  const titleEl = h('div', { class: 'ttl subj-ttl' });
  const right = h('div', { class: 'subj-right' });
  const tabs = h('nav', { class: 'tabs', role: 'tablist' });
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
    const blocks = (sub.blocks || []).sort((a, b) => a.sort - b.sort);
    titleEl.replaceChildren(sub.icon ? h('span', { class: 'emo' }, sub.icon) : null, sub.name);

    let rangeId = ranges.find((r) => r.id === q.get('r'))?.id || ranges[0]?.id;
    let kind = blocks.find((b) => b.kind === q.get('b'))?.kind || blocks[0]?.kind;

    // 데이터 넣기 : 관리자 · 이 과목 담당
    const canWrite = isAdmin() || !!(await sb.from('subject_writers').select('subject_id').eq('user_id', S.user.id).eq('subject_id', id).maybeSingle()).data;
    if (canWrite && formatsFor(blocks.map((b) => b.kind)).length) {
      right.append(h('button', { class: 'tool-ic data-btn', title: '데이터 넣기', 'aria-label': '데이터 넣기',
        onclick: () => openDataSheet(sub, ranges.find((r) => r.id === rangeId), () => show()) }, icon('import')));
    }
    if (ranges.length > 1) right.append(seg(ranges.map((r) => [r.id, r.name]), rangeId, (v) => { rangeId = v; show(); }));
    const tabBtns = blocks.map((b) => h('button', { role: 'tab', class: 'tab', onclick: () => { kind = b.kind; show(); } },
      (BLOCK_KINDS.find((k) => k[0] === b.kind) || [0, b.title])[1]));
    tabs.replaceChildren(...tabBtns, h('i', { class: 'tab-ind' }));

    if (!blocks.length) { area.replaceChildren(h('div', { class: 'empty' }, '탭이 없습니다')); return; }

    let curBtn = null;
    const ro = new ResizeObserver(() => moveIndicator(tabs, curBtn));
    ro.observe(tabs);
    const prevClean = root.cleanup;
    root.cleanup = () => { ro.disconnect(); prevClean?.(); };

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
      const ctx = { subject: sub, range, pool: sub.progress_pool || sub.id, fit: (on) => root.classList.toggle('fit', !!on) };
      const fn = RENDER[kind];
      if (fn) cleanup = fn(ctx, area) || null;
      else area.append(h('div', { class: 'empty' }, '준비 중입니다'));

      // 이어서 하기
      const label = `${sub.name}${ranges.length > 1 ? ' ' + range.name : ''} · ${tabBtns[i].textContent}`;
      sb.from('user_state').upsert({ user_id: S.user.id, key: 'last', value: { hash: location.hash, label }, updated_at: new Date().toISOString() });
    }
    show();
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
