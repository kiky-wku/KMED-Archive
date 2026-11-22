import { sb } from '../sb.js';
import { h, icon, gradeLabel, popover, toast } from '../ui.js';
import { S, seesAll, go } from '../app.js';
import { shell } from './shell.js';
import { openGuide } from './guide.js';
import { loadFavs, removeFav, resetFavs } from '../data/favs.js';
import { markViewed } from '../data/files.js';
import { openPdf } from './pdf-viewer.js';
import { openComments } from './comments.js';
import { savedFile } from '../data/offline.js';
import { bellButton, noticeStack, openSuggest, pushNudge } from './reports.js';

// 홈 : 인사 · 이어서 하기 · 과목 목록 (한 박스)
export function homeView(q) {
  const g = parseInt(q.get('g'), 10) || S.grade || 1;
  const s = parseInt(q.get('s'), 10) || S.sem || 1;
  const today = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

  const semBtn = h('button', { class: 'sem-pill' + (seesAll() ? '' : ' fixed') }, gradeLabel(g, s), seesAll() ? icon('down', 'icon s') : null);
  if (seesAll()) semBtn.addEventListener('click', () => openSemMenu(semBtn, g, s));

  const resume = h('div', { class: 'resume-slot' });
  const list = h('div', { class: 'tiles2' }, Array.from({ length: 4 }, () => h('i', { class: 'skel tile-skel' })));
  const count = h('span', { class: 'cnt' });
  const stack = noticeStack();
  const bell = bellButton();
  const right = [h('button', { class: 'tool-ic', title: '건의하기', 'aria-label': '건의하기', onclick: () => openSuggest() }, icon('chat')), bell];

  const body = h('div', { class: 'home2' },
    h('aside', { class: 'h-left' },
      h('div', { class: 'wave-hand' }, '👋'),
      h('h1', {}, `${S.profile.name || ''}님,`, h('br'), '안녕하세요'),
      h('div', { class: 'date' }, today),
      h('div', { class: 'h-acts' },
        resume,
        favBox(),
        pushNudge(),
        stack,
        h('button', { class: 'guide-btn', onclick: openGuide }, icon('book', 'icon s'), '사용법 안내'))),
    h('section', { class: 'h-right' },
      h('div', { class: 'r-head' }, semBtn, count),
      list),
  );

  // 이어서 하기
  let subjList = null;
  sb.from('user_state').select('value').eq('user_id', S.user.id).eq('key', 'last').maybeSingle().then(({ data }) => {
    const v = data?.value;
    if (!v?.hash || !v?.label) return;
    const sid = v.hash.match(/#\/s\/([^?]+)/)?.[1];
    const ss = subjList?.find((x) => x.id === sid);
    resume.append(h('button', { class: 'resume3', 'data-sid': sid || '', onclick: () => go(v.hash) },
      h('span', { class: 'r-emo' }, ss ? ss.icon || ss.name.slice(0, 1) : ''),
      h('span', { class: 'r-tx' }, h('span', { class: 'k' }, '이어서 학습하기'), h('span', { class: 'v' }, v.label)),
      h('span', { class: 'r-go' }, icon('right'))));
  });

  // 과목
  sb.from('subjects').select('id,name,sort,icon,ranges(name,sort),blocks(kind)').eq('grade', g).eq('semester', s).order('sort').order('name').then(({ data, error }) => {
    if (error || !data?.length) { list.replaceChildren(h('div', { class: 'box-empty' }, !navigator.onLine || error ? '인터넷에 연결되면 과목이 보입니다' : '등록된 과목이 없습니다')); count.textContent = ''; return; }
    count.textContent = `${data.length}과목`;
    subjList = data;
    // 이어서 하기 카드에 과목 이모지
    const rb = resume.querySelector('.resume3'); const rs = rb && data.find((x) => x.id === rb.dataset.sid);
    if (rs) rb.querySelector('.r-emo').textContent = rs.icon || rs.name.slice(0, 1);
    list.replaceChildren(...data.map((sub, i) => h('button', { class: 'tile2', style: { animationDelay: `${i * 0.035}s` }, onclick: () => go(`#/s/${sub.id}`) },
      h('span', { class: 'emo' }, sub.icon || sub.name.slice(0, 1)),
      h('span', { class: 'n' }, sub.name),
      h('span', { class: 'm' }, (sub.ranges || []).sort((a, b) => a.sort - b.sort).map((r) => r.name).join(' · ') || ''))));
  });

  const logo = h('button', { class: 'logo-btn', 'aria-label': '홈', onclick: () => go('#/home') },
    h('img', { class: 'logo-h', src: 'icons/logo-h.png', alt: '工夫韓醫 YRR STUDY' }));
  const root = shell({ title: logo, active: 'home', body, right, tone: 'gray', fit: 'home-fit' });
  const prev = root.cleanup;
  root.cleanup = () => { prev?.(); stack.cleanup?.(); bell.cleanup?.(); };
  // 알림에서 넘어온 경우
  if (q.get('open') === 'suggest') {
    history.replaceState(null, '', '#/home');
    setTimeout(() => openSuggest({ focusId: q.get('id') }), 250);
  }
  return root;
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

// 즐겨찾기 자료 : 눌러서 바로 열기, ★ 눌러서 빼기
function favBox() {
  const el = h('div', { class: 'fav' });
  let all = false;
  resetFavs();
  const paint = (list) => {
    if (!list.length) { el.replaceChildren(); el.classList.remove('on'); return; }
    el.classList.add('on');
    const shown = all ? list : list.slice(0, 3);
    el.replaceChildren(
      h('div', { class: 'fav-h' }, h('b', {}, '즐겨찾기'), h('span', {}, `${list.length}`),
        list.length > 3 ? h('button', { onclick: () => { all = !all; paint(list); } }, all ? '접기' : '모두 보기') : null),
      h('div', { class: 'fav-list' }, shown.map((x, i) => h('div', { class: 'fav-i', style: { animationDelay: `${i * 0.04}s` } },
        h('button', { class: 'fav-main', onclick: () => open(x) },
          h('span', { class: 'fav-ic' }, x.icon || 'PDF'),
          h('span', { class: 'fav-tx' }, h('b', {}, x.title), h('span', {}, x.sub, savedFile(x.id) ? h('i', { class: 'fav-off', title: '이 기기에 저장됨' }, icon('download', 'icon s')) : null))),
        h('button', { class: 'fav-x', 'aria-label': '즐겨찾기 빼기', title: '즐겨찾기 빼기', onclick: async () => { await removeFav(x.id); paint(await loadFavs()); } }, icon('star', 'icon s'))))));
  };
  async function open(x) {
    let f = null; let net = true;
    try { const r = await sb.from('files').select('*').eq('id', x.id).maybeSingle(); if (r.error) throw r.error; f = r.data; } catch { net = false; }
    if (!net) {
      f = savedFile(x.id);
      if (!f) { toast('인터넷에 연결되면 열 수 있습니다'); return; }
      openPdf(f); return;
    }
    if (!f) { toast('지워진 자료라 즐겨찾기에서 뺐습니다'); await removeFav(x.id); paint(await loadFavs()); return; }
    markViewed(f);
    openPdf(f, { onComments: () => openComments(f, {}) });
  }
  loadFavs().then(paint).catch(() => {});
  return el;
}
