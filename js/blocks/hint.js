import { h, icon } from '../ui.js';

// 💡 암기법 : 가려져 있다가 누르면 펼쳐짐 (mine : 내가 쓴 암기법, 자료 암기법보다 먼저)
export function hint(text, mine = '') {
  const a = String(mine || '').trim(); const b = String(text || '').trim();
  if (!a && !b) return { btn: null, panel: null };
  const panel = h('div', { class: 'hint-panel' }, h('div', { class: 'hint-in' }, icon('bulb', 'icon s'),
    h('span', {}, ...(a && b && a !== b ? [h('b', { class: 'hint-mine' }, a), h('br'), b] : [a || b]))));
  const btn = h('button', { class: 'tool-ic sm hint-btn', title: '암기법', 'aria-label': '암기법', onclick: (e) => {
    e.stopPropagation();
    const on = panel.classList.toggle('on');
    btn.classList.toggle('on', on);
  } }, icon('bulb', 'icon s'));
  return { btn, panel };
}
