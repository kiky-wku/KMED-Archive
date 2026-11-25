import { h, icon, popover } from '../ui.js';

// 단원 고르기 : [단원 · 전체 ▾] → 펼침 메뉴에서 여러 개 체크
export function unitPicker(units, sel, onChange, allLabel = '전체 단원', { top = null, tag = null } = {}) {
  const btn = h('button', { class: 'tool-pill unit-pill' });
  const U = () => (typeof units === 'function' ? units() : units);
  const paint = () => {
    const us = U();
    const groups = [...new Set(us.filter((u) => u.group).map((u) => u.group))];
    // 주차 하나를 통째로 고르면 주차 이름으로
    const full = groups.filter((g) => { const m = us.filter((u) => u.group === g); return m.length && m.every((u) => sel.includes(u.id)); });
    const names = [...full, ...us.filter((u) => sel.includes(u.id) && !full.includes(u.group)).map((u) => u.pill || u.label)];
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
      ...rows());
    // 주차가 있으면 주차 줄(누르면 그 주차 전부) 아래에 소단원
    const row = (u) => h('button', { class: 'u-row' + (u.group ? ' u-sub' : '') + (sel.includes(u.id) ? ' on' : ''), onclick: () => {
      sel = sel.includes(u.id) ? sel.filter((x) => x !== u.id) : [...sel, u.id]; draw(); change();
    } }, h('span', { class: 'ck' }, icon('check', 'icon s')), h('span', { class: 'u-t' }, u.label));
    const rows = () => {
      const out = []; const seen = new Set();
      for (const u of U()) {
        if (!u.group) { out.push(row(u)); continue; }
        if (seen.has(u.group)) continue;
        seen.add(u.group);
        const m = U().filter((x) => x.group === u.group);
        const on = m.every((x) => sel.includes(x.id)); const some = !on && m.some((x) => sel.includes(x.id));
        out.push(h('button', { class: 'u-row u-grp' + (on ? ' on' : some ? ' part' : ''), onclick: () => {
          const ids = m.map((x) => x.id);
          sel = on ? sel.filter((x) => !ids.includes(x)) : [...new Set([...sel, ...ids])]; draw(); change();
        } }, h('span', { class: 'ck' }, icon(some ? 'minus' : 'check', 'icon s')), h('span', { class: 'u-t' }, u.group), h('span', { class: 'u-n' }, `${m.length}`)));
        m.forEach((x) => out.push(row(x)));
      }
      return out;
    };
    const change = () => { paint(); onChange(sel); };
    draw();
    const head = top?.(() => { paint(); draw(); });
    popover(btn, head ? h('div', { class: 'unit-pop' }, head, list) : list, { width: 300 });
  });
  return btn;
}
