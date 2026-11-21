import { h, seg, icon } from '../ui.js';
import { unitPicker } from './units.js';
import { loadCards, loadProgress, uniqueCards } from '../data/hanja.js';

// ─────────────────────────────────────────────
// 한자 목록 : 맞음 초록 · 틀림 빨강 · 안 함 회색, 검색하면 해당 칸 확대
// ─────────────────────────────────────────────
export function hanjaGrid(ctx, el) {
  let alive = true;
  const sk = h('div', { class: 'g-skel' },
    h('div', { class: 'bar' }, h('i', { class: 'skel', style: { width: '130px' } }), h('i', { class: 'skel', style: { width: '290px' } })),
    h('div', { class: 'hg' }, Array.from({ length: 40 }, () => h('i', { class: 'skel' }))));
  el.append(sk);
  (async () => {
    const [{ cards, units }, prog] = await Promise.all([loadCards(ctx.range.id), loadProgress(ctx.pool), document.fonts?.ready]);
    if (!alive) return;
    if (!cards.length) { el.replaceChildren(h('div', { class: 'empty' }, '등록된 한자가 없습니다')); return; }

    let mode = 'r';
    let sel = [];
    const search = h('input', { type: 'search', placeholder: '한자 · 훈 · 음 검색' });
    const legend = h('div', { class: 'q-counts' });
    const result = h('div', { class: 'g-result' });
    const grid = h('div', { class: 'hg' });
    const wrap = h('div', { class: 'g-wrap' },
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
        return h('div', { class: 'hc ' + (s || '') + '', 'data-c': c.ch, 'data-r': c.readings.join(' ') },
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
    // 다 그린 뒤 레이아웃까지 끝나면 한 번에 등장
    sk.classList.add('out');
    await new Promise((r) => setTimeout(r, 200));
    if (!alive) return;
    el.replaceChildren(wrap);
    void wrap.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('ready')));
  })();
  return () => { alive = false; };
}
