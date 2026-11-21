import { sb } from '../sb.js';
import { h, icon, gradeLabel } from '../ui.js';
import { S, go } from '../app.js';

// 환영 화면 : 앱을 켤 때마다
export function welcomeView() {
  const today = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  const actions = h('div', { class: 'actions st' },
    h('button', { class: 'btn', onclick: () => { S.welcomed = true; go('#/home'); } }, '학습 시작하기'),
  );

  // 이어서 하기 : 마지막으로 하던 과목 · 블록
  sb.from('user_state').select('value').eq('user_id', S.user.id).eq('key', 'last').maybeSingle().then(({ data }) => {
    const v = data?.value;
    if (!v?.hash || !v?.label) return;
    actions.append(h('button', { class: 'resume', style: { animation: 'rise .45s var(--ease) both' },
      onclick: () => { S.welcomed = true; go(v.hash); } },
      h('div', {}, h('div', { class: 'k' }, '이어서 하기'), h('div', { class: 'v' }, v.label)),
      icon('right'),
    ));
  });

  return h('div', { class: 'welcome' },
    h('h1', { class: 'st' }, `${S.profile.name || ''}님 안녕하세요 `, h('span', { class: 'wave' }, '👋')),
    h('div', { class: 'meta st' }, `${gradeLabel(S.grade, S.sem)} · ${today}`),
    actions,
  );
}
