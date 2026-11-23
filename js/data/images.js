import { sb } from '../sb.js';
import { h, icon } from '../ui.js';

// ─────────────────────────────────────────────
// 플래시카드 사진
//  올리기 : 긴 쪽 1600px, JPEG 80% 로 줄여서 R2 로 바로
//  보기   : 보기 주소는 60장씩 묶어서 받고, 받은 사진은 기기에 저장 (다음부터 바로, 오프라인도)
//  기기 저장은 모두 합쳐 150MB 넘으면 오래 안 본 것부터 지움
// ─────────────────────────────────────────────
const CACHE = 'kmed-img-v1'; const META = 'kmed:img-meta'; const LIMIT = 150 * 1024 * 1024;
const has = () => 'caches' in window;
const reqOf = (key) => new Request(new URL(`__img/${encodeURIComponent(key)}`, location.href).href);
function meta() { try { return JSON.parse(localStorage.getItem(META) || '{}'); } catch { return {}; } }
function setMeta(m) { try { localStorage.setItem(META, JSON.stringify(m)); } catch { /* 가득 참 */ } }

async function call(action, body) {
  const { data, error } = await sb.functions.invoke('files', { body: { action, ...body } });
  if (error) {
    let msg = '';
    try { msg = (await error.context?.json())?.error || ''; } catch { /* 무시 */ }
    throw new Error(msg || '요청을 처리할 수 없습니다.');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// ── 줄이기 ──
async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 아래로 */ }
  const u = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = u; await img.decode(); return img;
  } finally { setTimeout(() => URL.revokeObjectURL(u), 1000); }
}
export async function shrink(file, max = 1600, q = 0.8) {
  let src;
  try { src = await decode(file); } catch { throw new Error('사진을 읽을 수 없습니다'); }
  const w0 = src.width || src.naturalWidth; const h0 = src.height || src.naturalHeight;
  const r = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * r)); const hh = Math.max(1, Math.round(h0 * r));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, w, hh);       // 투명한 PNG 는 흰 바탕으로
  c.imageSmoothingQuality = 'high';
  c.drawImage(src, 0, 0, w, hh);
  src.close?.();
  const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', q));
  if (!blob) throw new Error('사진을 줄이지 못했습니다');
  return blob;
}

// ── 올리기 ── (반환 : R2 열쇠)
export async function uploadImg(subjectId, file, onProgress) {
  const blob = await shrink(file);
  const { key, url } = await call('sign_img_upload', { subject_id: subjectId, size: blob.size });
  await new Promise((ok, no) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Type', 'image/jpeg');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? ok() : no(new Error(`업로드 실패 (${x.status})`)));
    x.onerror = () => no(new Error('업로드 중 연결이 끊겼습니다.'));
    x.send(blob);
  });
  await keep(key, blob);           // 올린 기기는 바로 보이게
  return key;
}

// 어느 카드에도 안 쓰이는 사진 지우기 (서버가 한 번 더 확인)
export function dropImgs(keys) {
  const k = [...new Set((keys || []).filter(Boolean))];
  if (!k.length) return Promise.resolve();
  return call('delete_imgs', { keys: k }).catch(() => {});
}

// ── 기기 저장 ──
async function keep(key, blob) {
  if (!has()) return;
  try {
    const c = await caches.open(CACHE);
    await c.put(reqOf(key), new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } }));
    const m = meta(); m[key] = { size: blob.size, at: Date.now() };
    // 넘치면 오래 안 본 것부터
    let total = Object.values(m).reduce((s, v) => s + (v.size || 0), 0);
    const old = Object.entries(m).sort((a, b) => a[1].at - b[1].at);
    while (total > LIMIT && old.length) { const [k, v] = old.shift(); if (k === key) continue; total -= v.size || 0; delete m[k]; c.delete(reqOf(k)); }
    setMeta(m);
  } catch { /* 저장 못 해도 보기는 됨 */ }
}
async function fromCache(key) {
  if (!has()) return null;
  try {
    const r = await (await caches.open(CACHE)).match(reqOf(key));
    if (!r) return null;
    const m = meta(); if (m[key]) { m[key].at = Date.now(); setMeta(m); }
    return await r.blob();
  } catch { return null; }
}

// ── 보기 주소 묶어서 받기 ──
let wait = new Map(); let timer = 0;
function signed(key) {
  return new Promise((ok, no) => {
    if (!wait.has(key)) wait.set(key, []);
    wait.get(key).push({ ok, no });
    clearTimeout(timer); timer = setTimeout(flush, 30);
  });
}
async function flush() {
  const batch = wait; wait = new Map();
  const keys = [...batch.keys()];
  for (let i = 0; i < keys.length; i += 60) {
    const part = keys.slice(i, i + 60);
    try {
      const { urls } = await call('sign_imgs', { keys: part });
      part.forEach((k) => batch.get(k).forEach((p) => (urls?.[k] ? p.ok(urls[k]) : p.no(new Error('사진을 볼 수 없습니다')))));
    } catch (e) { part.forEach((k) => batch.get(k).forEach((p) => p.no(e))); }
  }
}

// 사진 주소 (기기에 있으면 바로, 없으면 받아서 저장)
const mem = new Map();
export function imgSrc(key) {
  if (!key) return Promise.resolve(null);
  if (mem.has(key)) return mem.get(key);
  const p = (async () => {
    let blob = await fromCache(key);
    if (!blob) {
      const url = await signed(key);
      const r = await fetch(url);
      if (!r.ok) throw new Error('사진을 받지 못했습니다');
      blob = await r.blob();
      keep(key, blob);
    }
    return URL.createObjectURL(blob);
  })();
  mem.set(key, p);
  p.catch(() => mem.delete(key));
  return p;
}
// 미리 받아두기 (다음 카드들)
export function preload(keys) { (keys || []).filter(Boolean).forEach((k) => imgSrc(k).catch(() => {})); }

// <img> 하나 (받는 동안 회색 칸)
export function imgEl(key, cls = '') {
  const img = h('img', { alt: '', draggable: 'false' });
  const box = h('div', { class: `cimg ${cls} ld` }, img);
  imgSrc(key).then((u) => { img.onload = () => box.classList.remove('ld'); img.src = u; },
    () => { box.classList.remove('ld'); box.classList.add('err'); box.replaceChildren(icon('image', 'icon')); });
  return box;
}

// 크게 보기 (두 번 누르면 확대, 한 번 누르면 닫기)
export function zoomImg(key) {
  const img = h('img', { alt: '', draggable: 'false' });
  const pane = h('div', { class: 'zimg-pane' }, img);
  const wrap = h('div', { class: 'zimg', role: 'dialog', 'aria-modal': 'true' }, pane,
    h('button', { class: 'zimg-x', 'aria-label': '닫기', onclick: (e) => { e.stopPropagation(); close(); } }, icon('x')));
  imgSrc(key).then((u) => { img.src = u; }, () => close());
  let big = false; let lastTap = 0; let tapT = 0;
  pane.addEventListener('click', (e) => {
    const now = Date.now();
    if (now - lastTap < 300) {
      clearTimeout(tapT); big = !big; wrap.classList.toggle('big', big);
      if (big) { const r = img.getBoundingClientRect(); requestAnimationFrame(() => { pane.scrollLeft = (e.clientX - r.left) * 1.5; pane.scrollTop = (e.clientY - r.top) * 1.5; }); }
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
    wrap.classList.remove('on'); setTimeout(() => wrap.remove(), 220);
  }
}
