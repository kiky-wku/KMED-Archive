import { h, icon, gradeLabel } from '../ui.js';
import { S, go } from '../app.js';

// 환영 화면 : 앱을 켤 때마다
export function welcomeView() {
  const today = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  const start = h('button', { class: 'go on st', 'aria-label': '학습 시작하기', onclick: () => { S.welcomed = true; go('#/home'); } }, icon('arrow'));

  return h('div', { class: 'welcome' },
    h('img', { class: 'brand top', src: 'icons/logo.png', alt: '工夫韓醫 YRR STUDY' }),
    h('h1', { class: 'st' }, `${S.profile.name || ''}님`, h('br'), '안녕하세요 ', h('span', { class: 'wave' }, '👋')),
    h('div', { class: 'meta st' }, `${gradeLabel(S.grade, S.sem)}, ${today}`),
    start,
  );
}
