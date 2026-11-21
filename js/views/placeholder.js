import { h, icon } from '../ui.js';
import { shell } from './shell.js';

// 아직 만들지 않은 화면
export function placeholderView(title) {
  const back = h('button', { class: 'ib', 'aria-label': '뒤로', onclick: () => history.back() }, icon('back'));
  return shell({
    title,
    left: title === '과목' ? back : null,
    active: title === '설정' ? 'settings' : title === '관리' ? 'admin' : '',
    body: h('div', { class: 'empty' }, '준비 중입니다'),
  });
}
