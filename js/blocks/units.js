import { h, icon, popover } from '../ui.js';

// 단원 고르기 : [단원 · 전체 ▾] → 펼침 메뉴에서 여러 개 체크
export function unitPicker(units, sel, onChange, allLabel = '전체 단원', { top = null, tag = null } = {}) {
  const btn = h('button', { class: 'tool-pill unit-pill' });
  const U = () => (typeof units === 'function' ? units() : units);
  const paint = () => {
    const names = U().filter((u) => sel.includes(u.id)).map((u) => u.label);
    const label = !names.length ? allLabel : names.length === 1 ? names[0] : `${names[0]} 외 ${names.length - 1}`;
    const t = tag?.();
    btn.replaceChildren(...[icon('layers', 'icon s'), h('span', {}, label), t ? h('em', { class: 'unit-tag' }, t) : null, icon('down', 'icon s dn')].filter(Boolean));
  };
  btn.repaint = paint;
  paint();
  btn.addEventListener('click', () => {
    const list = h('div', { class: 'unit-list' });
    const draw = () => list.replaceChildren(
      h('button', { class: 'u-row all' + (sel.length ? '' : ' on'), onclick: () => { sel = []; draw(); change(); } },
        h('span', { class: 'ck' }, icon('check', 'icon s')), h('span', { class: 'u-t' }, '전체')),
      ...U().map((u) => h('button', { class: 'u-row' + (sel.includes(u.id) ? ' on' : ''), onclick: () => {
        sel = sel.includes(u.id) ? sel.filter((x) => x !== u.id) : [...sel, u.id]; draw(); change();
      } }, h('span', { class: 'ck' }, icon('check', 'icon s')), h('span', { class: 'u-t' }, u.label))));
    const change = () => { paint(); onChange(sel); };
    draw();
    const head = top?.(() => { paint(); draw(); });
    popover(btn, head ? h('div', { class: 'unit-pop' }, head, list) : list, { width: 300 });
  });
  return btn;
}
