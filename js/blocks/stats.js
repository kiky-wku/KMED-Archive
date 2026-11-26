import { h, icon } from '../ui.js';
import { go } from '../app.js';
import { rangeStats, sumParts } from '../data/stats.js';

// ─────────────────────────────────────────────
// 과목 안 "통계" 탭 : 탭별 맞음 · 틀림 · 안 푼 것, 틀린 것 보기 · 다시 풀기
// ─────────────────────────────────────────────
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function statBar(p, cls = '') {
  const bar = h('div', { class: 'stb ' + cls },
    h('i', { class: 'ok', style: { width: '0%' } }), h('i', { class: 'no', style: { width: '0%' } }));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.children[0].style.width = `${p.total ? (p.ok / p.total) * 100 : 0}%`;
    bar.children[1].style.width = `${p.total ? (p.no / p.total) * 100 : 0}%`;
  }));
  return bar;
}

export function statsBlock(ctx, el) {
  const wrap = h('div', { class: 'stx' }, h('i', { class: 'skel', style: { height: '150px', borderRadius: '22px' } }), h('i', { class: 'skel', style: { height: '120px', borderRadius: '20px' } }));
  el.append(wrap);
  let alive = true;
  rangeStats(ctx.subject, ctx.range).then((parts) => {
    if (!alive) return;
    if (!parts.length || !parts.some((p) => p.total)) { wrap.replaceChildren(h('div', { class: 'box-empty' }, '아직 풀 문제가 없습니다')); return; }
    const s = sumParts(parts);
    const done = s.ok + s.no;
    wrap.replaceChildren(
      h('section', { class: 'stx-top' },
        h('div', { class: 'stx-bigs' },
          h('div', { class: 'stx-big' }, h('b', {}, `${pct(done, s.total)}`, h('small', {}, '%')), h('span', {}, '진도')),
          h('div', { class: 'stx-big' }, h('b', {}, done ? `${pct(s.ok, done)}` : '-', done ? h('small', {}, '%') : null), h('span', {}, '정답률'))),
        h('div', { class: 'stx-nums' },
          h('div', {}, h('b', { class: 'g' }, s.ok), h('span', {}, '맞음')),
          h('div', {}, h('b', { class: 'r' }, s.no), h('span', {}, '틀림')),
          h('div', {}, h('b', {}, s.total - done), h('span', {}, '남음'))),
        statBar(s, 'lg')),
      ...parts.filter((p) => p.total).map((p, i) => card(p, i)));
  }).catch(() => wrap.replaceChildren(h('div', { class: 'box-empty' }, '통계를 불러오지 못했습니다')));

  function card(p, i) {
    const list = h('div', { class: 'stx-wrong' });
    let open = false;
    const toggle = h('button', { class: 'stx-btn', onclick: () => {
      open = !open; c.classList.toggle('open', open);
      toggle.lastChild.textContent = open ? '접기' : `틀린 것 보기`;
      if (open && !list.childNodes.length) {
        list.append(...p.wrong.slice(0, 200).map((w, j) => h('button', { class: 'stx-w', style: { animationDelay: `${Math.min(j, 12) * 0.02}s` }, onclick: (e) => e.currentTarget.classList.toggle('show') },
          h('b', {}, w.q), h('span', {}, w.a || ''))));
      }
    } }, icon('list', 'icon s'), h('span', {}, '틀린 것 보기'));
    const c = h('section', { class: 'stx-card', style: { animationDelay: `${0.05 + i * 0.04}s` } },
      h('div', { class: 'stx-h' }, h('b', {}, p.label), h('span', {}, `${p.total}개 중 ${p.ok + p.no}개 풀었음`),
        h('em', {}, p.ok + p.no ? `정답률 ${pct(p.ok, p.ok + p.no)}%` : '아직 풀지 않음')),
      statBar(p),
      h('div', { class: 'stx-leg' }, h('span', { class: 'g' }, `맞음 ${p.ok}`), h('span', { class: 'r' }, `틀림 ${p.no}`), h('span', {}, `남음 ${p.total - p.ok - p.no}`)),
      p.no ? h('div', { class: 'stx-acts' }, toggle,
        h('button', { class: 'stx-btn dark', onclick: () => go(`#/s/${ctx.subject.id}?r=${ctx.range.id}&b=${p.tab}&retry=1`) }, icon('undo', 'icon s'), h('span', {}, `틀린 ${p.no}개 다시 풀기`))) : null,
      list);
    return c;
  }
  return () => { alive = false; };
}
