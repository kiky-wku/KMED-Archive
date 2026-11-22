import { h, icon, toast } from '../ui.js';
import { viewUrl, loadNotes, saveNotes } from '../data/files.js';

// ─────────────────────────────────────────────
// PDF 보기 + 애플펜슬 필기 (나만 보기)
//  펜슬 · 마우스 = 필기, 손가락 = 스크롤
//  필기는 쪽마다 선 좌표로 저장 (가로 길이 기준 0~1)
// ─────────────────────────────────────────────
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs';
const WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs';
let lib = null;
async function pdfjs() {
  if (!lib) { lib = await import(PDFJS); lib.GlobalWorkerOptions.workerSrc = WORKER; }
  return lib;
}

const COLORS = ['#191F28', '#E5484D', '#3182F6', '#16A34A'];
const HL = ['#FFE066', '#9BE7B5', '#A5D8FF', '#FFB3C7'];
const ZOOMS = [1, 1.25, 1.5, 2];

export function openPdf(file, { key = null, label = '' } = {}) {
  const fileKey = key || file.key;
  let tool = 'pen'; let color = COLORS[0]; let hl = HL[0]; let zoom = 1;
  let doc = null; let alive = true;
  const pages = []; // { wrap, cv, ink, vp, rendered, strokes }
  const history = []; // { i, prev }
  let notes = new Map();

  // ── 뼈대 ──
  const pageInfo = h('span', { class: 'pv-pg' }, '');
  const toolBtns = {};
  const tbtn = (t, ic, label) => (toolBtns[t] = h('button', { class: 'pv-t', title: label, 'aria-label': label, onclick: () => setTool(t) }, icon(ic)));
  const swatches = h('div', { class: 'pv-sw' });
  const undoBtn = h('button', { class: 'pv-t', title: '실행 취소', 'aria-label': '실행 취소', disabled: true, onclick: undo }, icon('undo'));
  const zoomOut = h('button', { class: 'pv-t', title: '축소', 'aria-label': '축소', onclick: () => setZoom(-1) }, icon('minus'));
  const zoomIn = h('button', { class: 'pv-t', title: '확대', 'aria-label': '확대', onclick: () => setZoom(1) }, icon('plus'));
  const scroller = h('div', { class: 'pv-scroll' });
  const list = h('div', { class: 'pv-pages' });
  scroller.append(list);
  const top = h('header', { class: 'pv-top' },
    h('button', { class: 'pv-t', 'aria-label': '닫기', onclick: close }, icon('x')),
    h('div', { class: 'pv-ttl' }, h('b', {}, file.series || file.filename), h('span', {}, [file.week, label].filter(Boolean).join('  '))),
    h('div', { class: 'pv-tools' },
      tbtn('pen', 'pen', '펜'), tbtn('hl', 'marker', '형광펜'), tbtn('eraser', 'eraser', '지우개'),
      h('i', { class: 'pv-div' }), swatches, h('i', { class: 'pv-div' }), undoBtn),
    h('div', { class: 'pv-right' }, zoomOut, zoomIn, pageInfo,
      h('button', { class: 'pv-t', title: '굿노트로 보내기', 'aria-label': '굿노트로 보내기', onclick: share }, icon('share'))));
  const loading = h('div', { class: 'pv-load' }, h('i', { class: 'skel' }), h('i', { class: 'skel' }));
  const root = h('div', { class: 'pv', role: 'dialog', 'aria-modal': 'true' }, top, scroller, loading);
  document.body.append(root);
  document.documentElement.classList.add('pv-open');
  requestAnimationFrame(() => root.classList.add('on'));
  paintTools();

  function close() {
    alive = false;
    root.classList.remove('on');
    document.documentElement.classList.remove('pv-open');
    io?.disconnect(); ro.disconnect(); document.removeEventListener('keydown', onKey);
    setTimeout(() => { root.remove(); doc?.destroy?.(); }, 300);
  }
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  };
  document.addEventListener('keydown', onKey);

  function paintTools() {
    Object.entries(toolBtns).forEach(([t, b]) => b.classList.toggle('on', t === tool));
    const set = tool === 'hl' ? HL : COLORS;
    const cur = tool === 'hl' ? hl : color;
    swatches.replaceChildren(...set.map((c) => h('button', { class: 'pv-c' + (c === cur ? ' on' : ''), style: { '--c': c }, 'aria-label': '색', disabled: tool === 'eraser',
      onclick: () => { if (tool === 'hl') hl = c; else color = c; paintTools(); } })));
    swatches.classList.toggle('off', tool === 'eraser');
  }
  function setTool(t) { tool = t; paintTools(); }

  // ── 불러오기 ──
  (async () => {
    try {
      const [L, url, n] = await Promise.all([pdfjs(), viewUrl(file, key || undefined), loadNotes(file.id, fileKey)]);
      notes = n;
      doc = await L.getDocument({ url, isEvalSupported: false }).promise;
      if (!alive) return;
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const vp = p.getViewport({ scale: 1 });
        const cv = h('canvas', { class: 'pv-cv' });
        const ink = h('canvas', { class: 'pv-ink' });
        const wrap = h('div', { class: 'pv-page', 'data-i': i - 1 }, cv, ink);
        const pg = { page: p, wrap, cv, ink, vp, rendered: 0, strokes: notes.get(i) || [] };
        pages.push(pg);
        list.append(wrap);
        bindInk(pg, i - 1);
      }
      layout();
      loading.remove();
      root.classList.add('ready');
      pageInfo.textContent = `1 / ${doc.numPages}`;
    } catch (e) {
      loading.replaceChildren(h('div', { class: 'pv-err' }, e.message || 'PDF를 열 수 없습니다'));
    }
  })();

  // ── 크기 · 그리기 ──
  let io = null;
  const fitW = () => Math.min(scroller.clientWidth - 32, 1100);
  function layout() {
    const w = Math.round(fitW() * zoom);
    pages.forEach((pg) => {
      const hgt = Math.round(w * pg.vp.height / pg.vp.width);
      pg.wrap.style.width = `${w}px`; pg.wrap.style.height = `${hgt}px`;
      pg.w = w; pg.h = hgt;
      if (pg.rendered && pg.rendered !== w) pg.rendered = 0;
      sizeInk(pg);
    });
    io?.disconnect();
    io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) render(pages[+e.target.dataset.i]); }), { root: scroller, rootMargin: '1200px 0px' });
    pages.forEach((pg) => io.observe(pg.wrap));
  }
  const ro = new ResizeObserver(() => { clearTimeout(ro.t); ro.t = setTimeout(() => { if (pages.length) layout(); }, 150); });
  ro.observe(scroller);

  async function render(pg) {
    if (!pg || pg.rendered === pg.w || pg.busy) return;
    pg.busy = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const scale = (pg.w / pg.vp.width) * dpr;
    const vp = pg.page.getViewport({ scale });
    const off = document.createElement('canvas');
    off.width = Math.floor(vp.width); off.height = Math.floor(vp.height);
    try {
      await pg.page.render({ canvasContext: off.getContext('2d'), viewport: vp }).promise;
      pg.cv.width = off.width; pg.cv.height = off.height;
      pg.cv.getContext('2d').drawImage(off, 0, 0);
      pg.rendered = pg.w;
      pg.wrap.classList.add('in');
    } catch { /* 취소 */ }
    pg.busy = false;
    if (pg.rendered !== pg.w) render(pg);
  }

  function sizeInk(pg) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    pg.ink.width = Math.round(pg.w * dpr); pg.ink.height = Math.round(pg.h * dpr);
    const ctx = pg.ink.getContext('2d', { desynchronized: true });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pg.ctx = ctx;
    redraw(pg);
  }
  function redraw(pg, extra) {
    const c = pg.ctx; if (!c) return;
    c.clearRect(0, 0, pg.w, pg.h);
    [...pg.strokes, ...(extra ? [extra] : [])].forEach((s) => drawStroke(c, s, pg.w));
  }
  function drawStroke(c, s, W) {
    const p = s.p; if (!p.length) return;
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (s.t === 'hl') {
      c.globalAlpha = 0.38; c.globalCompositeOperation = 'multiply';
      c.strokeStyle = s.c; c.lineWidth = s.w * W;
      c.beginPath(); c.moveTo(p[0][0] * W, p[0][1] * W);
      for (let i = 1; i < p.length; i++) c.lineTo(p[i][0] * W, p[i][1] * W);
      if (p.length === 1) c.lineTo(p[0][0] * W + 0.1, p[0][1] * W);
      c.stroke();
    } else {
      c.strokeStyle = s.c; c.fillStyle = s.c;
      if (p.length === 1) { c.beginPath(); c.arc(p[0][0] * W, p[0][1] * W, (s.w * W * (0.6 + p[0][2])) / 2, 0, Math.PI * 2); c.fill(); }
      for (let i = 1; i < p.length; i++) {
        c.lineWidth = s.w * W * (0.6 + (p[i][2] + p[i - 1][2]) / 2);
        c.beginPath(); c.moveTo(p[i - 1][0] * W, p[i - 1][1] * W); c.lineTo(p[i][0] * W, p[i][1] * W); c.stroke();
      }
    }
    c.restore();
  }

  // ── 펜 입력 ──
  // 펜슬이 화면에 닿을 때 스크롤되지 않게 (손가락은 그대로 스크롤)
  scroller.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t && t.touchType === 'stylus') e.preventDefault(); }, { passive: false });
  scroller.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t && t.touchType === 'stylus') e.preventDefault(); }, { passive: false });

  function bindInk(pg, idx) {
    let cur = null; let pid = null;
    const pt = (e) => { const r = pg.ink.getBoundingClientRect(); return [(e.clientX - r.left) / pg.w, (e.clientY - r.top) / pg.w, e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5]; };
    pg.ink.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      pid = e.pointerId; pg.ink.setPointerCapture(pid);
      if (tool === 'eraser') { history.push({ i: idx, prev: pg.strokes.slice() }); erase(pg, pt(e)); cur = { erase: true }; return; }
      cur = { t: tool === 'hl' ? 'hl' : 'pen', c: tool === 'hl' ? hl : color, w: tool === 'hl' ? 0.022 : 0.0028, p: [pt(e)] };
      redraw(pg, cur);
    });
    pg.ink.addEventListener('pointermove', (e) => {
      if (!cur || e.pointerId !== pid) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (cur.erase) { evs.forEach((x) => erase(pg, pt(x))); return; }
      const before = cur.p.length;
      evs.forEach((x) => cur.p.push(pt(x)));
      if (cur.t === 'hl') redraw(pg, cur);
      else { const seg = { ...cur, p: cur.p.slice(Math.max(0, before - 1)) }; drawStroke(pg.ctx, seg, pg.w); }
    });
    const end = (e) => {
      if (!cur || e.pointerId !== pid) return;
      if (!cur.erase && cur.p.length) {
        history.push({ i: idx, prev: pg.strokes.slice() });
        cur.p = cur.p.map(([x, y, pr]) => [round(x), round(y), Math.round(pr * 100) / 100]);
        pg.strokes = [...pg.strokes, cur];
        redraw(pg);
      }
      if (cur.erase && history.length && history[history.length - 1].prev.length === pg.strokes.length) history.pop();
      cur = null; pid = null;
      undoBtn.disabled = !history.length;
      saveNotes(file.id, fileKey, idx + 1, pg.strokes);
    };
    pg.ink.addEventListener('pointerup', end);
    pg.ink.addEventListener('pointercancel', end);
  }
  function erase(pg, [x, y]) {
    const r = 0.015;
    const keep = pg.strokes.filter((s) => !s.p.some(([a, b]) => (a - x) ** 2 + (b - y) ** 2 < r * r));
    if (keep.length !== pg.strokes.length) { pg.strokes = keep; redraw(pg); }
  }
  function undo() {
    const last = history.pop(); if (!last) return;
    const pg = pages[last.i];
    pg.strokes = last.prev; redraw(pg);
    saveNotes(file.id, fileKey, last.i + 1, pg.strokes);
    undoBtn.disabled = !history.length;
  }

  // ── 확대 · 쪽 번호 ──
  function setZoom(d) {
    const i = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + d));
    if (ZOOMS[i] === zoom) return;
    const ratio = scroller.scrollTop / Math.max(1, scroller.scrollHeight);
    zoom = ZOOMS[i]; layout();
    scroller.scrollTop = ratio * scroller.scrollHeight;
    zoomOut.disabled = i === 0; zoomIn.disabled = i === ZOOMS.length - 1;
  }
  zoomOut.disabled = true;
  scroller.addEventListener('scroll', () => {
    if (!pages.length) return;
    const mid = scroller.scrollTop + scroller.clientHeight / 3;
    let n = 0; for (let i = 0; i < pages.length; i++) { if (pages[i].wrap.offsetTop <= mid) n = i; else break; }
    pageInfo.textContent = `${n + 1} / ${pages.length}`;
  }, { passive: true });

  // ── 굿노트로 보내기 (공유 시트) ──
  async function share() {
    try {
      const url = await viewUrl(file, key || undefined);
      const blob = await (await fetch(url)).blob();
      const f = new File([blob], file.filename || 'file.pdf', { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: file.series }); return; }
      const a = h('a', { href: URL.createObjectURL(f), download: f.name }); document.body.append(a); a.click(); a.remove();
    } catch (e) { if (e?.name !== 'AbortError') toast('파일을 보낼 수 없습니다'); }
  }
}

const round = (v) => Math.round(v * 10000) / 10000;
