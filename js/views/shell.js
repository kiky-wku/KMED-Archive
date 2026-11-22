import { h, icon, gradeLabel } from '../ui.js';
import { S, isAdmin, signOut, go } from '../app.js';
import { openGuide } from './guide.js';

// 한 화면 고정 화면에서 문서 전체가 밀려 올라가는 것도 막기 (사파리 앱 모드)
window.addEventListener('scroll', () => {
  if (window.scrollY && document.querySelector('.view > .fit, .fit')) window.scrollTo(0, 0);
}, { passive: true });

// 상단 바 + 숨겨진 사이드바(☰)
export function shell({ title, active, left, right, body, tone, fit }) {
  const scrim = h('div', { class: 'scrim', onclick: close });
  const nav = (ic, label, hash, key) => h('button', {
    class: 'nav-i' + (active === key ? ' on' : ''),
    onclick: () => { close(); setTimeout(() => go(hash), 180); },
  }, icon(ic), label);

  const side = h('aside', { class: 'side', 'aria-hidden': 'true' },
    h('div', { class: 'side-me' },
      h('div', { class: 'avatar' }, (S.profile.name || S.profile.email || '?').slice(0, 1)),
      h('div', {}, h('div', { class: 'n' }, S.profile.name || S.profile.email), h('div', { class: 'm' }, gradeLabel(S.grade))),
    ),
    nav('home', '홈', '#/home', 'home'),
    nav('chart', '내 학습', '#/stats', 'stats'),
    nav('gear', '설정', '#/settings', 'settings'),
    isAdmin() ? nav('shield', '관리', '#/admin', 'admin') : null,
    h('button', { class: 'nav-i', onclick: () => { close(); setTimeout(openGuide, 200); } }, icon('book'), '사용법 안내'),
    h('div', { class: 'sp' }),
    h('button', { class: 'nav-i', onclick: () => { close(); signOut(); } }, icon('out'), '로그아웃'),
  );

  function open() { scrim.classList.add('on'); side.classList.add('on'); side.setAttribute('aria-hidden', 'false'); }
  function close() { scrim.classList.remove('on'); side.classList.remove('on'); side.setAttribute('aria-hidden', 'true'); }

  const top = h('header', { class: 'top' },
    left || h('button', { class: 'ib', 'aria-label': '메뉴', onclick: open }, icon('menu')),
    typeof title === 'string' ? h('div', { class: 'ttl' }, title) : title,
    h('div', { class: 'right' }, right),
  );

  const onScroll = () => top.classList.toggle('scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });
  const root = h('div', { class: [tone === 'gray' ? 'tone-gray' : '', fit ? `fit ${fit}` : ''].join(' ').trim() }, top, h('main', { class: 'page' }, body), scrim, side);
  // 한 화면 고정(fit) 화면 : 입력칸에 커서가 갈 때 브라우저가 화면 전체를 밀어 올려
  // 위쪽 막대와 탭이 사라지는 일이 있어서, 밀리면 바로 제자리로
  root.addEventListener('scroll', (e) => {
    if (!root.classList.contains('fit')) return;
    for (const el of [root, root.querySelector(':scope>.page')]) if (el && (el.scrollTop || el.scrollLeft)) { el.scrollTop = 0; el.scrollLeft = 0; }
  }, true);
  root.cleanup = () => window.removeEventListener('scroll', onScroll);
  return root;
}
