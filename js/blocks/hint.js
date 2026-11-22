import { h, icon } from '../ui.js';

// 💡 암기법 : 가려져 있다가 누르면 펼쳐짐
export function hint(text) {
  if (!text || !String(text).trim()) return { btn: null, panel: null };
  const panel = h('div', { class: 'hint-panel' }, h('div', { class: 'hint-in' }, icon('bulb', 'icon s'), h('span', {}, text)));
  const btn = h('button', { class: 'tool-ic sm hint-btn', title: '암기법', 'aria-label': '암기법', onclick: (e) => {
    e.stopPropagation();
    const on = panel.classList.toggle('on');
    btn.classList.toggle('on', on);
  } }, icon('bulb', 'icon s'));
  return { btn, panel };
}
