import { h, icon } from '../ui.js';
import { S, isAdmin } from '../app.js';

// ─────────────────────────────────────────────
// 사용법 안내 : 한 장씩 옆으로 넘기는 카드
// ─────────────────────────────────────────────
const PAGES = [
  { emo: '👋', t: '공부하니에 오신 걸\n환영합니다', p: ['과목별 학습과 써머리 자료를 한곳에서 봅니다.', '옆으로 넘기면서 사용법을 확인하세요.'] },
  { emo: '📚', t: '과목 고르기', p: ['홈에서 과목을 누르면 탭이 나옵니다.', '중간, 기말처럼 범위가 나뉜 과목은 오른쪽 위에서 바꿉니다.', '마지막으로 공부한 곳은 홈의 이어서 학습하기로 바로 갈 수 있습니다.'] },
  { emo: '🃏', t: '플래시카드', p: ['카드를 누르거나 Space 키로 뒤집고, 맞음 또는 틀림을 고릅니다.', '💡 버튼을 누르면 암기법이 보입니다.', '한 바퀴를 돌면 틀린 카드만 다시 볼 수 있습니다.', '사진이 있는 카드는 오른쪽 아래 버튼으로 크게 볼 수 있습니다.'] },
  { emo: '🈶', t: '한자와 해석', p: ['훈음 맞히기, 한자 쓰기, 해석 쓰기, 순서 맞추기로 공부합니다.', '기록은 자동으로 저장되어 다른 기기에서도 이어집니다.', '헷갈리는 글자는 단어장에 모아 따로 시험 볼 수 있습니다.'] },
  { emo: '📄', t: '자료 보기', p: ['자료 탭에서 써머리와 기타 자료를 엽니다.', '두 손가락으로 크게 볼 수 있고, 오른쪽 위에서 공유하거나 내려받습니다.'] },
  { emo: '✏️', t: '자료에 필기하기', p: ['편집을 누르면 펜, 형광펜, 텍스트 상자, 지우개가 나옵니다.', '애플펜슬로 쓰고 손가락으로는 넘깁니다. ✋ 버튼을 켜면 손가락으로도 씁니다.', '형광펜을 긋다가 1.5초 멈추면 반듯한 직선이 됩니다.', '필기는 나에게만 보입니다.'] },
  { emo: '🚨', t: '오타 제보', p: ['틀린 곳을 보면 과목 화면 오른쪽 위 사이렌을 누릅니다.', '보던 문제가 자동으로 붙어 과목 담당에게 바로 갑니다.', '제보는 모두가 볼 수 있고 쓴 사람 이름이 함께 보입니다.'] },
  { emo: '💬', t: '건의하기', p: ['앱에 바라는 점은 홈 오른쪽 위 말풍선 버튼으로 보냅니다.', '건의는 관리자만 봅니다.'] },
  { emo: '🔔', t: '알림', p: ['새 자료가 올라오거나 내 제보가 처리되면 알림이 옵니다.', '알림 화면이나 설정에서 푸시 알림을 켜면 앱을 닫아 둬도 받을 수 있습니다.'] },
  { emo: '📲', t: '홈 화면에 추가', p: ['아이폰과 아이패드는 사파리 공유 버튼에서 홈 화면에 추가를 고릅니다.', '앱처럼 화면을 꽉 채워 쓸 수 있고, 푸시 알림도 이렇게 추가한 앱에서만 됩니다.'] },
];
const WRITER = { emo: '🛠️', t: '과목 담당이라면', p: ['자료 탭의 업로드 버튼으로 써머리를 올립니다.', '과목 화면 오른쪽 위에서 데이터를 넣거나 편집합니다.', '제보를 확인하고 처리 완료를 누르면 제보한 사람에게 알림이 갑니다.'] };

export function openGuide() {
  const pages = [...PAGES];
  if (isAdmin() || S.profile?.role === 'writer') pages.push(WRITER);
  let idx = 0;

  const track = h('div', { class: 'gd-track' }, pages.map((pg, i) => h('section', { class: 'gd-card', 'data-i': i },
    h('div', { class: 'gd-emo' }, pg.emo),
    h('h2', {}, pg.t),
    h('div', { class: 'gd-p' }, pg.p.map((x) => h('p', {}, x))))));
  const dots = h('div', { class: 'gd-dots' }, pages.map((_, i) => h('button', { 'aria-label': `${i + 1}번째`, onclick: () => to(i) })));
  const prev = h('button', { class: 'gd-nav prev', 'aria-label': '이전', onclick: () => to(idx - 1) }, icon('back'));
  const next = h('button', { class: 'gd-nav next', 'aria-label': '다음', onclick: () => (idx === pages.length - 1 ? close() : to(idx + 1)) }, icon('right'));
  const skip = h('button', { class: 'gd-skip', onclick: () => close() }, '건너뛰기');
  const box = h('div', { class: 'gd', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'gd-top' }, h('span', { class: 'gd-cnt' }), skip),
    track,
    h('div', { class: 'gd-foot' }, prev, dots, next));
  const wrap = h('div', { class: 'gd-wrap', onclick: (e) => { if (e.target === wrap) close(); } }, box);
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('on'));

  function to(i) {
    i = Math.max(0, Math.min(pages.length - 1, i));
    track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
    paint(i);
  }
  function paint(i) {
    if (i === idx && box.dataset.ready) return;
    idx = i; box.dataset.ready = '1';
    [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
    [...track.children].forEach((c, j) => c.classList.toggle('on', j === i));
    box.querySelector('.gd-cnt').textContent = `${i + 1} / ${pages.length}`;
    prev.classList.toggle('off', i === 0);
    const last = i === pages.length - 1;
    next.replaceChildren(icon(last ? 'check' : 'right'));
    next.setAttribute('aria-label', last ? '닫기' : '다음');
    next.classList.toggle('last', last);
    skip.classList.toggle('off', last);
  }
  // 손으로 넘기면 가까운 장으로
  let st = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(st);
    st = requestAnimationFrame(() => paint(Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
  }, { passive: true });
  // 마우스로 끌어 넘기기 (노트북)
  let drag = null;
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    drag = { x: e.clientX, left: track.scrollLeft, moved: false };
    track.classList.add('drag');
  });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    track.scrollLeft = drag.left - dx;
  }
  function onUp(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    track.classList.remove('drag');
    const base = Math.round(drag.left / track.clientWidth);
    drag = null;
    to(Math.abs(dx) > 50 ? base + (dx < 0 ? 1 : -1) : base);
  }
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); to(idx + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); to(idx - 1); }
    else if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => { track.scrollLeft = idx * track.clientWidth; });
  ro.observe(track);

  function close() {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
    ro.disconnect();
    wrap.classList.remove('on');
    setTimeout(() => wrap.remove(), 300);
  }
  paint(0);
}
