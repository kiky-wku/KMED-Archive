import { h, icon } from '../ui.js';
import { imgSrc } from '../data/images.js';

// ─────────────────────────────────────────────
// 그림 카드 보기 : 그림 + 테이프
//  target  : 이번에 묻는 테이프 (없으면 그림 전체 카드)
//  reveal  : 뒤집은 뒤 (묻는 테이프만 열림)
//  ask     : 'name' 빨간 테이프 = 이름 묻기 / 'where' 이름 주고 자리 묻기 (빨강 표시 없음)
//  hideAll : 다른 테이프도 가리기 (기본) / false 면 다른 이름은 보임
//  그림이 놓일 자리 크기에 맞춰 비율 그대로 꽉 차게 (테이프 위치가 어긋나지 않게 그림과 같은 상자 안에)
// ─────────────────────────────────────────────
export function occView(set, { target = null, reveal = false, ask = 'name', hideAll = true, cls = '' } = {}) {
  const img = h('img', { alt: '', draggable: 'false' });
  const masks = (set.boxes || []).map((b) => {
    const isT = target && b.id === target.id;
    let c = 'occ-m';
    if (isT) c += reveal ? ' open' : ask === 'name' ? ' tg' : '';
    else if (!hideAll) c += ' off';
    return h('i', { class: c, style: { left: pc(b.x), top: pc(b.y), width: pc(b.w), height: pc(b.h) } });
  });
  const inner = h('div', { class: 'occ-in' }, img, ...masks);
  const box = h('div', { class: `occ ${cls} ld` }, inner);
  let ratio = set.img_w && set.img_h ? set.img_w / set.img_h : 0;
  let scale = 1;
  const fit = () => {
    if (!ratio) return;
    const W = box.clientWidth; const H = box.clientHeight;
    if (!W || !H) return;
    let w = W; let hh = W / ratio;
    if (hh > H) { hh = H; w = H * ratio; }
    inner.style.width = `${Math.round(w * scale)}px`; inner.style.height = `${Math.round(hh * scale)}px`;
  };
  const ro = new ResizeObserver(fit); ro.observe(box);
  imgSrc(set.img).then((u) => {
    img.onload = () => { if (!ratio) ratio = img.naturalWidth / img.naturalHeight; fit(); box.classList.remove('ld'); };
    img.src = u;
  }, () => { box.classList.remove('ld'); box.classList.add('err'); box.replaceChildren(icon('image')); });
  box.setScale = (s) => { scale = s; fit(); };
  box.stop = () => ro.disconnect();
  return box;
}
const pc = (v) => `${(Number(v) || 0) * 100}%`;

// 크게 보기 (테이프 그대로). 두 번 누르면 확대, 한 번 누르면 닫기
export function occZoom(set, opts) {
  const v = occView(set, { ...opts, cls: 'occ-z' });
  const pane = h('div', { class: 'zimg-pane occ-pane' }, v);
  const wrap = h('div', { class: 'zimg', role: 'dialog', 'aria-modal': 'true' }, pane,
    h('button', { class: 'zimg-x', 'aria-label': '닫기', onclick: (e) => { e.stopPropagation(); close(); } }, icon('x')));
  let big = false; let lastTap = 0; let tapT = 0;
  pane.addEventListener('click', (e) => {
    const now = Date.now();
    if (now - lastTap < 300) {
      clearTimeout(tapT); big = !big; wrap.classList.toggle('big', big);
      const r = v.firstChild.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width; const fy = (e.clientY - r.top) / r.height;
      v.setScale(big ? 2.5 : 1);
      if (big) requestAnimationFrame(() => { pane.scrollLeft = fx * pane.scrollWidth - pane.clientWidth / 2; pane.scrollTop = fy * pane.scrollHeight - pane.clientHeight / 2; });
      lastTap = 0; return;
    }
    lastTap = now;
    tapT = setTimeout(() => { if (!big) close(); }, 300);
  });
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('on'));
  function close() {
    document.removeEventListener('keydown', onKey, true);
    v.stop();
    wrap.classList.remove('on'); setTimeout(() => wrap.remove(), 220);
  }
}
