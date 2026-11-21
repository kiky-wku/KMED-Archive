import { h, seg, icon } from '../ui.js';
import { unitPicker } from './units.js';
import { loadCards, loadProgress, uniqueCards } from '../data/hanja.js';

// ─────────────────────────────────────────────
// 한자 목록 : 맞음 초록 · 틀림 빨강 · 안 함 회색, 검색하면 해당 칸 확대
// ─────────────────────────────────────────────
export function hanjaGrid(ctx, el) {
  let alive = true;
  el.append(h('div', { class: 'loading' }, h('i')));
  (async () => {
    const [{ cards, units }, prog] = await Promise.all([loadCards(ctx.range.id), loadProgress(ctx.pool)]);
    if (!alive) return;
    el.replaceChildren();
    if (!cards.length) { el.append(h('div', { class: 'empty' }, '등록된 한자가 없습니다')); return; }

    let mode = 'r';
    let sel = [];
    const search = h('input', { type: 'search', placeholder: '한자 · 훈 · 음 검색' });
    const legend = h('div', { class: 'q-counts' });
    const result = h('div', { class: 'g-result' });
    const grid = h('div', { class: 'hg' });
    el.append(
      h('div', { class: 'q-bar' },
        units.length ? unitPicker(units, sel, (v) => { sel = v; draw(); }) : null,
        h('label', { class: 'srch' }, icon('search', 'icon s'), search),
        h('div', { class: 'sp' }), legend,
        seg([['r', '한자 → 훈음'], ['h', '훈음 → 한자']], mode, (v) => { mode = v; draw(); })),
      result, grid,
    );

    function draw() {
      const list = uniqueCards(cards, sel);
      const st = prog[mode];
      let ok = 0, no = 0;
      grid.replaceChildren(...list.map((c, i) => {
        const s = st.get(c.ch); if (s === 'ok') ok++; else if (s === 'no') no++;
        return h('div', { class: 'hc ' + (s || ''), 'data-c': c.ch, 'data-r': c.readings.join(' '), style: { animationDelay: `${Math.min(i, 40) * 0.008}s` } },
          h('div', { class: 'h' }, c.ch), h('div', { class: 'u' }, c.readings.join(' / ')));
      }));
      legend.replaceChildren(
        h('span', { class: 'ok' }, h('b', {}, ok), ' 맞음'),
        h('span', { class: 'no' }, h('b', {}, no), ' 틀림'),
        h('span', {}, h('b', {}, list.length - ok - no), ' 안 함'));
      find();
    }
    function find() {
      const q = search.value.trim();
      const nq = q.replace(/\s+/g, '');
      let n = 0, first = null;
      grid.querySelectorAll('.hc').forEach((c) => {
        const hit = !!q && (c.dataset.c.includes(q) || c.dataset.r.replace(/\s+/g, '').includes(nq));
        c.classList.toggle('hit', hit);
        if (hit) { n++; first = first || c; }
      });
      grid.classList.toggle('searching', !!q);
      result.textContent = q ? (n ? `${n}개 찾음` : '결과가 없습니다') : '';
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    search.addEventListener('input', find);
    draw();
  })();
  return () => { alive = false; };
}
