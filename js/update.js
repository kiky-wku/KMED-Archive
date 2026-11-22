import { h } from './ui.js';

// ─────────────────────────────────────────────
// 새 버전 알아채기 : 앱을 다시 열거나 돌아올 때 version.json 확인
//  오래 쉬다 돌아왔으면 바로 새로고침, 쓰는 중이면 아래에 알림 띠
// ─────────────────────────────────────────────
let mine = null; let hiddenAt = 0; let shown = false;
async function latest() {
  try { const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' }); return (await r.json()).v; } catch { return null; }
}
async function check(longAway) {
  const v = await latest();
  if (!v) return;
  if (!mine) { mine = v; return; }
  if (v === mine) return;
  navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
  const busy = document.querySelector('.pv.on, .ds-wrap.on, .drawer.on, .modal-wrap.on') || document.activeElement?.matches?.('input, textarea, [contenteditable]');
  if (longAway && !busy) { location.reload(); return; }
  if (shown) return; shown = true;
  document.body.append(h('div', { class: 'upd' }, h('span', {}, '새 버전이 있습니다'), h('button', { onclick: () => location.reload() }, '업데이트')));
}
export function watchUpdates() {
  check(false);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    check(hiddenAt && Date.now() - hiddenAt > 3 * 60 * 1000);
  });
  setInterval(() => { if (document.visibilityState === 'visible') check(false); }, 10 * 60 * 1000);
}
