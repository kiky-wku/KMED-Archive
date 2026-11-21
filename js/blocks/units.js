import { h, icon, popover } from '../ui.js';

// 단원 고르기 : [단원 · 전체 ▾] → 펼침 메뉴에서 여러 개 체크
export function unitPicker(units, sel, onChange) {
  const btn = h('button', { class: 'tool-pill unit-pill' });
  const paint = () => {
    const names = units.filter((u) => sel.includes(u.id)).map((u) => u.label);
    const label = !names.length ? '전체 단원' : names.length === 1 ? names[0] : `${names[0]} 외 ${names.length - 1}`;
    btn.replaceChildren(icon('layers', 'icon s'), h('span', {}, label), icon('down', 'icon s dn'));
  };
  paint();
  btn.addEventListener('click', () => {
    const list = h('div', { class: 'unit-list' });
    const draw = () => list.replaceChildren(
      h('button', { class: 'u-row all' + (sel.length ? '' : ' on'), onclick: () => { sel = []; draw(); change(); } },
        h('span', { class: 'ck' }, icon('check', 'icon s')), '전체'),
      ...units.map((u) => h('button', { class: 'u-row' + (sel.includes(u.id) ? ' on' : ''), onclick: () => {
        sel = sel.includes(u.id) ? sel.filter((x) => x !== u.id) : [...sel, u.id]; draw(); change();
      } }, h('span', { class: 'ck' }, icon('check', 'icon s')), u.label)));
    const change = () => { paint(); onChange(sel); };
    draw();
    popover(btn, list, { width: 260 });
  });
  return btn;
}
