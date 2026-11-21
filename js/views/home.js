import { sb } from '../sb.js';
import { h, icon, gradeLabel } from '../ui.js';
import { S, seesAll, go } from '../app.js';
import { shell } from './shell.js';

// 과목 선택 : 기본 = 내 학년 · 이번 학기
export function homeView(q) {
  const g = parseInt(q.get('g'), 10) || S.grade || 1;
  const s = parseInt(q.get('s'), 10) || S.sem || 1;

  const semBtn = h('button', { class: 'sem' }, gradeLabel(g, s), seesAll() ? icon('down') : null);
  const tiles = h('div', { class: 'tiles' });
  const body = h('div', {}, h('div', { class: 'page-head' }, semBtn), tiles);

  if (seesAll()) semBtn.addEventListener('click', (e) => openSemMenu(e, g, s, semBtn));
  else semBtn.style.pointerEvents = 'none';

  sb.from('subjects').select('id,name,sort').eq('grade', g).eq('semester', s).order('sort').order('name').then(({ data, error }) => {
    if (error || !data?.length) { tiles.replaceWith(h('div', { class: 'empty' }, '등록된 과목이 없습니다')); return; }
    data.forEach((sub, i) => tiles.append(
      h('button', { class: 'tile', style: { animationDelay: `${i * 0.05}s` }, onclick: () => go(`#/s/${sub.id}`) },
        h('div', { class: 'n' }, sub.name),
      ),
    ));
  });

  const logo = h('button', { class: 'logo-btn', 'aria-label': '홈', onclick: () => go('#/welcome') },
    h('img', { class: 'logo-h', src: 'icons/logo-h.png', alt: '夜淚冷 YRR STUDY' }));
  return shell({ title: logo, active: 'home', body });
}

// 학기 이동 메뉴 (전체 열람 계정)
async function openSemMenu(e, g, s, anchor) {
  e.stopPropagation();
  document.querySelector('.menu')?.remove();
  anchor.classList.add('open');
  const { data } = await sb.from('subjects').select('grade,semester');
  const set = new Set((data || []).map((x) => `${x.grade}-${x.semester}`));
  set.add(`${S.grade}-${S.sem}`);
  const list = [...set].map((k) => k.split('-').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const r = anchor.getBoundingClientRect();
  const menu = h('div', { class: 'menu', style: { top: `${r.bottom + window.scrollY + 6}px`, left: `${r.left}px` } },
    list.map(([gg, ss]) => h('button', {
      class: gg === g && ss === s ? 'on' : '',
      onclick: () => { close(); go(`#/home?g=${gg}&s=${ss}`); },
    }, gradeLabel(gg, ss), gg === g && ss === s ? icon('check') : null)),
  );
  document.body.append(menu);
  const close = () => { menu.remove(); anchor.classList.remove('open'); document.removeEventListener('click', onDoc); };
  const onDoc = (ev) => { if (!menu.contains(ev.target)) close(); };
  setTimeout(() => document.addEventListener('click', onDoc), 0);
}
