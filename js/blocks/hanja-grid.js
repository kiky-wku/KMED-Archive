import { h, seg } from '../ui.js';
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
    const unitBar = units.length ? h('div', { class: 'unit-bar' }) : null;
    const search = h('input', { class: 'search-in', type: 'search', placeholder: '한자 · 훈 · 음 검색' });
    const legend = h('div', { class: 'legend' });
    const result = h('div', { class: 'g-result' });
    const grid = h('div', { class: 'hg' });
    el.append(
      unitBar ? h('div', { class: 'q-top' }, unitBar) : null,
      h('div', { class: 'toolbar' }, search, seg([['r', '한자 → 훈음'], ['h', '훈음 → 한자']], mode, (v) => { mode = v; draw(); }), h('div', { class: 'sp' }), legend),
      result, grid,
    );

    function drawUnits() {
      if (!unitBar) return;
      unitBar.replaceChildren(
        h('button', { class: 'chipt' + (sel.length ? '' : ' on'), onclick: () => { sel = []; drawUnits(); draw(); } }, '전체'),
        ...units.map((u) => h('button', { class: 'chipt' + (sel.includes(u.id) ? ' on' : ''), onclick: () => {
          sel = sel.includes(u.id) ? sel.filter((x) => x !== u.id) : [...sel, u.id]; drawUnits(); draw();
        } }, u.label)));
    }
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
        h('span', { class: 'lg ok' }, h('i'), '맞음 ', h('b', {}, ok)),
        h('span', { class: 'lg no' }, h('i'), '틀림 ', h('b', {}, no)),
        h('span', { class: 'lg' }, h('i'), '안 함 ', h('b', {}, list.length - ok - no)));
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
    drawUnits(); draw();
  })();
  return () => { alive = false; };
}
