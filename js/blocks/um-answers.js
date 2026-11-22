import { h, icon } from '../ui.js';
import { loadCards } from '../data/hanja.js';
import { loadSentences } from '../data/study.js';
import { unitPicker } from './units.js';
import { hint } from './hint.js';

// ─────────────────────────────────────────────
// 엄한문 문장 모음 : 단원별 문장 · 정답 순서 · 해석 (해석 가리기 가능)
// ─────────────────────────────────────────────
export function umAnswers(ctx, el) {
  let alive = true;
  el.append(h('div', { class: 'q-skel' },
    h('div', { class: 'bar' }, h('i', { class: 'skel', style: { width: '130px' } }), h('i', { class: 'skel', style: { width: '120px' } })),
    h('i', { class: 'skel ox-sk' }), h('i', { class: 'skel ox-sk' })));

  (async () => {
    const [{ units }, sents] = await Promise.all([loadCards(ctx.range.id), loadSentences(ctx.range.id)]);
    if (!alive) return;
    el.replaceChildren();
    el.classList.add('q-in');
    if (!sents.length) { el.append(h('div', { class: 'empty' }, '등록된 문장이 없습니다')); return; }

    let sel = [];
    let hide = localStorage.getItem('kmed:ans-hide') === '1';
    const body = h('div', { class: 'ua' });
    const hideBtn = h('button', { class: 'tool-pill', onclick: () => {
      hide = !hide; try { localStorage.setItem('kmed:ans-hide', hide ? '1' : '0'); } catch { /* 무시 */ }
      paintHide(); body.querySelectorAll('.ua-row.peek').forEach((r) => r.classList.remove('peek'));
    } });
    const paintHide = () => {
      hideBtn.replaceChildren(icon(hide ? 'eyeoff' : 'eye', 'icon s'), h('span', {}, hide ? '해석 가림' : '해석 보임'));
      hideBtn.classList.toggle('on', hide);
      body.classList.toggle('hide', hide);
    };
    el.append(h('div', { class: 'q-bar' },
      units.length ? unitPicker(units, sel, (v) => { sel = v; draw(); }) : null,
      h('div', { class: 'sp' }), hideBtn), body);
    paintHide();

    function draw() {
      const us = units.length ? units.filter((u) => !sel.length || sel.includes(u.id)) : [{ id: null, label: '' }];
      body.replaceChildren(...us.map((u) => {
        const arr = sents.filter((s) => !units.length || s.unit_id === u.id);
        if (!arr.length) return null;
        return h('section', { class: 'ua-unit' },
          u.label ? h('h3', {}, u.label, h('span', {}, `${arr.length}문장`)) : null,
          h('div', { class: 'ua-card' }, arr.map((s, i) => {
            const seq = s.cards.map((c, ci) => ({ c, o: s.orders[ci] })).sort((a, b) => a.o - b.o);
            const hn = hint(s.hint);
            const row = h('div', { class: 'ua-row' },
              h('div', { class: 'ua-top' }, h('span', { class: 'n' }, i + 1), h('div', { class: 'sen' }, s.sentence || s.cards.join('')),
                s.source ? h('span', { class: 'src' }, s.source) : null, hn.btn),
              hn.panel,
              h('div', { class: 'seq' }, seq.map((x, n) => h('span', {}, h('b', {}, n + 1), x.c))),
              h('div', { class: 'tr', onclick: () => row.classList.toggle('peek') }, s.translation));
            return row;
          })));
      }).filter(Boolean));
    }
    draw();
  })();

  return () => { alive = false; };
}
