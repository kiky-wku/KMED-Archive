import { h, icon } from '../ui.js';

// ─────────────────────────────────────────────
// 애플펜슬 쓰기 칸
//  - 펜 움직임을 기다리지 않고 바로 그림 (coalesced 좌표까지 모두 사용 → 끊김 없음)
//  - 필압 반영, 중간점 곡선으로 부드럽게
//  - 정답 보기 때 정답 한자를 흐리게 뒤에 겹침
// ─────────────────────────────────────────────
export function pencilPad() {
  const cv = h('canvas', { class: 'pad-cv' });
  const ghostEl = h('div', { class: 'pad-ghost' });
  const clearBtn = h('button', { type: 'button', class: 'pad-clear', 'aria-label': '지우기', onclick: () => clear() }, icon('trash', 'icon s'));
  const el = h('div', { class: 'pad' }, ghostEl, cv, clearBtn);

  let g = null, dpr = 1, w = 0, hgt = 0;
  let drawing = false, last = null, mid = null, penSeen = false;
  const INK = '#191F28';

  function setup() {
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const img = g && w ? g.getImageData(0, 0, cv.width, cv.height) : null;
    w = r.width; hgt = r.height;
    cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr);
    g = cv.getContext('2d', { desynchronized: true }) || cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = INK; g.fillStyle = INK;
    if (img) g.putImageData(img, 0, 0);
  }
  const ro = new ResizeObserver(() => setup());
  ro.observe(cv);

  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5 }; };
  const width = (p) => 3 + p * 7;

  function down(e) {
    if (e.pointerType === 'pen') penSeen = true;
    else if (penSeen && e.pointerType === 'touch') return; // 펜을 쓰는 중엔 손바닥 무시
    if (!g) setup();
    e.preventDefault();
    cv.setPointerCapture?.(e.pointerId);
    drawing = true; el.classList.add('used');
    last = pos(e); mid = last;
    g.beginPath(); g.arc(last.x, last.y, width(last.p) / 2, 0, Math.PI * 2); g.fill();
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = pos(ev);
      const m = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
      g.lineWidth = width((last.p + p.p) / 2);
      g.beginPath(); g.moveTo(mid.x, mid.y); g.quadraticCurveTo(last.x, last.y, m.x, m.y); g.stroke();
      last = p; mid = m;
    }
  }
  function up(e) {
    if (!drawing) return;
    drawing = false;
    g.lineWidth = width(last.p);
    g.beginPath(); g.moveTo(mid.x, mid.y); g.lineTo(last.x, last.y); g.stroke();
    cv.releasePointerCapture?.(e.pointerId);
  }
  cv.addEventListener('pointerdown', down);
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false }); // 스크롤 · 확대 막기

  function clear() {
    if (g) { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.restore(); }
    el.classList.remove('used');
  }
  function ghost(ch) { ghostEl.textContent = ch || ''; el.classList.toggle('show', !!ch); }

  return { el, clear, ghost, destroy: () => ro.disconnect() };
}
