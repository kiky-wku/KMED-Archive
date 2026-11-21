import { sb } from '../sb.js';
import { h, icon, gradeLabel, popover, modal } from '../ui.js';
import { S, seesAll, go } from '../app.js';
import { shell } from './shell.js';

// 홈 : 인사 · 이어서 하기 · 과목 목록 (한 박스)
export function homeView(q) {
  const g = parseInt(q.get('g'), 10) || S.grade || 1;
  const s = parseInt(q.get('s'), 10) || S.sem || 1;
  const today = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

  const semBtn = h('button', { class: 'sem-pill' + (seesAll() ? '' : ' fixed') }, gradeLabel(g, s), seesAll() ? icon('down', 'icon s') : null);
  if (seesAll()) semBtn.addEventListener('click', () => openSemMenu(semBtn, g, s));

  const resume = h('div', { class: 'resume-slot' });
  const list = h('div', { class: 'tiles2' }, h('div', { class: 'loading' }, h('i')));
  const count = h('span', { class: 'cnt' });

  const body = h('div', { class: 'home2' },
    h('aside', { class: 'h-left' },
      h('div', { class: 'wave-hand' }, '👋'),
      h('h1', {}, `${S.profile.name || ''}님,`, h('br'), '안녕하세요'),
      h('div', { class: 'date' }, today),
      h('div', { class: 'h-acts' },
        resume,
        h('button', { class: 'guide-btn', onclick: openGuide }, icon('book', 'icon s'), '사용법 안내'))),
    h('section', { class: 'h-right' },
      h('div', { class: 'r-head' }, semBtn, count),
      list),
  );

  // 이어서 하기
  sb.from('user_state').select('value').eq('user_id', S.user.id).eq('key', 'last').maybeSingle().then(({ data }) => {
    const v = data?.value;
    if (!v?.hash || !v?.label) return;
    resume.append(h('button', { class: 'resume3', onclick: () => go(v.hash) },
      h('span', { class: 'r-tx' }, h('span', { class: 'k' }, '이어서 학습하기'), h('span', { class: 'v' }, v.label)),
      h('span', { class: 'r-go' }, icon('right'))));
  });

  // 과목
  sb.from('subjects').select('id,name,sort,icon,ranges(name,sort),blocks(kind)').eq('grade', g).eq('semester', s).order('sort').order('name').then(({ data, error }) => {
    if (error || !data?.length) { list.replaceChildren(h('div', { class: 'box-empty' }, '등록된 과목이 없습니다')); count.textContent = ''; return; }
    count.textContent = `${data.length}과목`;
    list.replaceChildren(...data.map((sub, i) => h('button', { class: 'tile2', style: { animationDelay: `${0.08 + i * 0.05}s` }, onclick: () => go(`#/s/${sub.id}`) },
      h('span', { class: 'emo' }, sub.icon || sub.name.slice(0, 1)),
      h('span', { class: 'n' }, sub.name),
      h('span', { class: 'm' }, (sub.ranges || []).sort((a, b) => a.sort - b.sort).map((r) => r.name).join(' · ') || ''))));
  });

  const logo = h('button', { class: 'logo-btn', 'aria-label': '홈', onclick: () => go('#/home') },
    h('img', { class: 'logo-h', src: 'icons/logo-h.png', alt: '夜淚冷 YRR STUDY' }));
  return shell({ title: logo, active: 'home', body, tone: 'gray' });
}

// 학기 이동 (전체 열람 계정)
async function openSemMenu(anchor, g, s) {
  const { data } = await sb.from('subjects').select('grade,semester');
  const set = new Set((data || []).map((x) => `${x.grade}-${x.semester}`));
  set.add(`${S.grade}-${S.sem}`);
  const list = [...set].map((k) => k.split('-').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const p = popover(anchor, h('div', { class: 'menu-list' }, list.map(([gg, ss]) => h('button', {
    class: gg === g && ss === s ? 'on' : '',
    onclick: () => { p.close(); go(`#/home?g=${gg}&s=${ss}`); },
  }, gradeLabel(gg, ss), gg === g && ss === s ? icon('check', 'icon s') : null))));
}

// 사용법 안내 (내용은 추후 작성)
function openGuide() {
  modal({ title: '사용법 안내', body: h('div', { class: 'guide-empty' }, '준비 중입니다') });
}
