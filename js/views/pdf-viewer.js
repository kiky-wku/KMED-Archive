import { h, icon, toast, popover } from '../ui.js';
import { loadNotes, saveNotes } from '../data/files.js';
import { getPdf } from '../data/offline.js';

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
const ZMIN = 0.5; const ZMAX = 4;
// 굵기 : 화면 폭 1000 기준 px (슬라이더로 조절)
const RANGE = { pen: [1, 14, 2.8], hl: [6, 50, 22], er: [6, 60, 20], tx: [8, 48, 16] };
const TXCOLORS = ['#191F28', '#E5484D', '#3182F6', '#16A34A', '#F59E0B', '#8B5CF6'];
const FONT = '"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Noto Sans KR",sans-serif';

export function openPdf(file, { key = null, label = '', onComments = null } = {}) {
  const fileKey = key || file.key;
  let tool = 'pen'; let color = COLORS[0]; let hl = HL[0]; let zoom = 1;
  const size = { pen: RANGE.pen[2], hl: RANGE.hl[2], er: RANGE.er[2] };
  let eraseMode = localStorage.getItem('kmed:pv-erase') === 'part' ? 'part' : 'stroke'; // 선 지우기 · 부분 지우기
  // 텍스트 상자 기본값 (기본값으로 고정 가능)
  const TXDEF = { c: TXCOLORS[0], fs: RANGE.tx[2], b: false };
  try { Object.assign(TXDEF, JSON.parse(localStorage.getItem('kmed:pv-text') || '{}')); } catch { /* 무시 */ }
  const txt = { ...TXDEF };
  let ed = null; // 지금 쓰는 텍스트 상자
  try { const v = JSON.parse(localStorage.getItem('kmed:pv-size2') || '{}'); ['pen', 'hl', 'er'].forEach((k) => { if (typeof v[k] === 'number') size[k] = v[k]; }); } catch { /* 무시 */ }
  let doc = null; let alive = true;
  let editing = false;                                           // 기본은 읽기 모드
  let handDraw = localStorage.getItem('kmed:pv-hand') === '1';   // 손으로 그리기
  let cancelStroke = null;
  const pages = []; // { wrap, cv, ink, vp, rendered, strokes }
  const history = []; // { i, prev }
  let notes = new Map();

  // ── 뼈대 ──
  const pageInfo = h('span', { class: 'pv-pg' }, '');
  const toolBtns = {};
  const tbtn = (t, ic, label) => (toolBtns[t] = h('button', { class: 'pv-t', title: label, 'aria-label': label, onclick: () => setTool(t) }, icon(ic)));
  const swatches = h('div', { class: 'pv-sw' });
  const sizes = h('button', { class: 'pv-sz', title: '굵기', 'aria-label': '굵기', onmousedown: (e) => e.preventDefault(), onclick: openSize });
  const boldBtn = h('button', { class: 'pv-t pv-bold tx-only', title: '굵게', 'aria-label': '굵게', onmousedown: (e) => e.preventDefault(), onclick: () => { txt.b = !txt.b; applyText(); paintTools(); } }, h('b', {}, 'B'));
  const pinBtn = h('button', { class: 'pv-pin tx-only', title: '지금 설정을 기본값으로', onmousedown: (e) => e.preventDefault(), onclick: () => {
    Object.assign(TXDEF, { c: txt.c, fs: txt.fs, b: !!txt.b });
    try { localStorage.setItem('kmed:pv-text', JSON.stringify(TXDEF)); } catch { /* 무시 */ }
    paintTools(); toast('새 텍스트 상자는 이 설정으로 시작합니다');
  } }, icon('pin', 'icon s'));
  const undoBtn = h('button', { class: 'pv-t', title: '실행 취소', 'aria-label': '실행 취소', disabled: true, onclick: undo }, icon('undo'));
  const zoomOut = h('button', { class: 'pv-t', title: '축소', 'aria-label': '축소', onclick: () => zoomBy(1 / 1.25) }, icon('minus'));
  const zoomIn = h('button', { class: 'pv-t', title: '확대', 'aria-label': '확대', onclick: () => zoomBy(1.25) }, icon('plus'));
  const handBtn = h('button', { class: 'pv-t pv-hand', title: '손으로 그리기', 'aria-label': '손으로 그리기', onclick: () => {
    handDraw = !handDraw; try { localStorage.setItem('kmed:pv-hand', handDraw ? '1' : '0'); } catch { /* 무시 */ }
    paintMode(); toast(handDraw ? '손가락 하나로 그리고, 두 손가락으로 넘깁니다' : '애플펜슬로만 그립니다');
  } }, icon('hand'));
  const editBtn = h('button', { class: 'pv-edit', onclick: () => { editing = !editing; paintMode(); } });
  const scroller = h('div', { class: 'pv-scroll' });
  const list = h('div', { class: 'pv-pages' });
  scroller.append(list);
  const top = h('header', { class: 'pv-top' },
    h('div', { class: 'pv-left' },
      h('button', { class: 'pv-t', 'aria-label': '닫기', onclick: close }, icon('x')),
      h('div', { class: 'pv-ttl' }, h('b', {}, file.series || file.filename), h('span', {}, [file.week, label].filter(Boolean).join('  ')))),
    h('div', { class: 'pv-tools' },
      tbtn('pen', 'pen', '펜'), tbtn('hl', 'marker', '형광펜'), tbtn('text', 'type', '텍스트 상자'), tbtn('eraser', 'eraser', '지우개'),
      h('i', { class: 'pv-div' }), swatches, h('i', { class: 'pv-div' }), sizes, boldBtn, pinBtn, h('i', { class: 'pv-div' }), handBtn, undoBtn),
    h('div', { class: 'pv-right' }, editBtn, zoomOut, zoomIn, pageInfo,
      onComments ? h('button', { class: 'pv-t', title: '댓글', 'aria-label': '댓글', onclick: () => onComments() }, icon('chat')) : null,
      h('button', { class: 'pv-t', title: '굿노트로 보내기', 'aria-label': '굿노트로 보내기', onclick: share }, icon('share')),
      h('button', { class: 'pv-t', title: '다운로드', 'aria-label': '다운로드', onclick: download }, icon('download'))));
  const loading = h('div', { class: 'pv-load' }, h('i', { class: 'skel' }), h('i', { class: 'skel' }));
  const root = h('div', { class: 'pv', role: 'dialog', 'aria-modal': 'true' }, top, scroller, loading);
  document.body.append(root);
  document.documentElement.classList.add('pv-open');
  requestAnimationFrame(() => root.classList.add('on'));
  paintTools(); paintMode();

  function paintMode() {
    root.classList.toggle('editing', editing);
    root.classList.toggle('hand', editing && handDraw);
    handBtn.classList.toggle('on', handDraw);
    editBtn.replaceChildren(...(editing ? [icon('check', 'icon')] : [icon('pen', 'icon s'), h('span', {}, '편집')]));
    editBtn.title = editing ? '완료' : '편집';
    editBtn.classList.toggle('on', editing);
    if (!editing) commitText();
    root.classList.toggle('texting', editing && tool === 'text');
  }

  function close() {
    commitText();
    alive = false;
    root.classList.remove('on');
    document.documentElement.classList.remove('pv-open');
    io?.disconnect(); ro.disconnect(); document.removeEventListener('keydown', onKey);
    setTimeout(() => { root.remove(); doc?.destroy?.(); }, 300);
  }
  const onKey = (e) => {
    if (e.target?.closest?.('.cm-drawer') || document.querySelector('.cm-drawer.on')) return;
    if (ed) { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); commitText(); } return; }
    if (e.key === 'Escape') close();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  };
  document.addEventListener('keydown', onKey);

  function paintTools() {
    Object.entries(toolBtns).forEach(([t, b]) => b.classList.toggle('on', t === tool));
    const set = tool === 'hl' ? HL : COLORS;
    const cur = tool === 'hl' ? hl : color;
    root.classList.toggle('texting', editing && tool === 'text');
    if (tool === 'text') {
      // 텍스트 : 글자색 · 크기 · 굵게 · 기본값으로
      swatches.replaceChildren(...TXCOLORS.map((c) => h('button', { class: 'pv-c' + (c === txt.c ? ' on' : ''), style: { '--c': c }, 'aria-label': '글자색',
        onmousedown: (e) => e.preventDefault(), onclick: () => { txt.c = c; applyText(); paintTools(); } })));
      sizes.replaceChildren(h('b', { class: 'tx-a' }, 'Aa'), h('span', {}, Math.round(txt.fs)));
      sizes.classList.remove('off');
      boldBtn.classList.toggle('on', !!txt.b);
      pinBtn.classList.toggle('same', txt.c === TXDEF.c && txt.fs === TXDEF.fs && !!txt.b === !!TXDEF.b);
      return;
    }
    if (tool === 'eraser') {
      // 지우개 : 색 자리에 지우는 방식
      const em = (v, label) => h('button', { class: 'pv-em' + (eraseMode === v ? ' on' : ''), onclick: () => { eraseMode = v; try { localStorage.setItem('kmed:pv-erase', v); } catch { /* 무시 */ } paintTools(); } }, label);
      swatches.replaceChildren(em('stroke', '선 지우기'), em('part', '부분 지우기'));
    } else {
      swatches.replaceChildren(...set.map((c) => h('button', { class: 'pv-c' + (c === cur ? ' on' : ''), style: { '--c': c }, 'aria-label': '색',
        onclick: () => { if (tool === 'hl') hl = c; else color = c; paintTools(); } })));
    }
    const t = tool === 'hl' ? 'hl' : tool === 'eraser' ? 'er' : 'pen';
    const d = t === 'er' ? Math.max(6, Math.min(22, size.er * 0.4)) : Math.max(3, Math.min(22, size[t] * (t === 'hl' ? 0.45 : 1.4)));
    sizes.replaceChildren(h('i', { class: t, style: { width: `${d}px`, height: `${t === 'hl' ? Math.max(3, d * 0.45) : d}px`, background: t === 'hl' ? hl : t === 'er' ? '#fff' : color } }), h('span', {}, Math.round(size[t] * 10) / 10));
    sizes.classList.toggle('off', tool === 'eraser' && eraseMode === 'stroke');
  }
  function setTool(t) { if (t !== 'text') commitText(); tool = t; paintTools(); }
  function openSize() {
    if (tool === 'text') { openTextSize(); return; }
    const t = tool === 'hl' ? 'hl' : tool === 'eraser' ? 'er' : 'pen';
    const [lo, hi] = RANGE[t];
    const prev = h('div', { class: 'sz-prev' }, h('i'));
    const val = h('b', {});
    const input = h('input', { type: 'range', min: lo, max: hi, step: 0.2, value: size[t] });
    const paint = () => {
      const px = size[t] * (Math.min(scroller.clientWidth - 32, 1100) / 1000) * (t === 'pen' ? 1.3 : 1);
      prev.firstChild.style.cssText = t === 'hl' ? `width:120px;height:${px}px;border-radius:2px;background:${hl};opacity:.6`
        : t === 'er' ? `width:${px * 2}px;height:${px * 2}px;border-radius:50%;background:#fff;box-shadow:0 0 0 1.5px #8B95A1` : `width:${px}px;height:${px}px;border-radius:50%;background:${color}`;
      val.textContent = Math.round(size[t] * 10) / 10;
    };
    const step = (d) => { size[t] = Math.max(lo, Math.min(hi, Math.round((size[t] + d) * 10) / 10)); input.value = size[t]; save(); };
    const save = () => { try { localStorage.setItem('kmed:pv-size2', JSON.stringify(size)); } catch { /* 무시 */ } paint(); paintTools(); };
    input.addEventListener('input', () => { size[t] = +input.value; save(); });
    paint();
    popover(sizes, h('div', { class: 'sz-pop' },
      h('div', { class: 'sz-head' }, h('span', {}, t === 'hl' ? '형광펜 굵기' : t === 'er' ? '지우개 크기' : '펜 굵기'), val),
      prev,
      h('div', { class: 'sz-row' },
        h('button', { class: 'pv-t', 'aria-label': '가늘게', onclick: () => step(t === 'pen' ? -0.4 : -2) }, icon('minus')),
        input,
        h('button', { class: 'pv-t', 'aria-label': '굵게', onclick: () => step(t === 'pen' ? 0.4 : 2) }, icon('plus')))), { width: 280 });
  }

  function openTextSize() {
    const [lo, hi] = RANGE.tx;
    const val = h('b', {}); const prev = h('div', { class: 'sz-prev' }, h('span', {}, '가나다 Aa'));
    const input = h('input', { type: 'range', min: lo, max: hi, step: 1, value: txt.fs });
    const paint = () => {
      val.textContent = Math.round(txt.fs);
      Object.assign(prev.firstChild.style, { fontFamily: FONT, fontSize: `${Math.min(44, txt.fs * 1.2)}px`, color: txt.c, fontWeight: txt.b ? 700 : 400 });
    };
    const set = (v) => { txt.fs = Math.max(lo, Math.min(hi, v)); input.value = txt.fs; applyText(); paint(); paintTools(); };
    input.addEventListener('input', () => set(+input.value));
    paint();
    popover(sizes, h('div', { class: 'sz-pop', onmousedown: (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); } },
      h('div', { class: 'sz-head' }, h('span', {}, '글씨 크기'), val), prev,
      h('div', { class: 'sz-row' },
        h('button', { class: 'pv-t', 'aria-label': '작게', onclick: () => set(txt.fs - 1) }, icon('minus')), input,
        h('button', { class: 'pv-t', 'aria-label': '크게', onclick: () => set(txt.fs + 1) }, icon('plus')))), { width: 280 });
  }

  // ── 불러오기 ──
  (async () => {
    try {
      const bar = h('div', { class: 'pv-prog' }, h('i'));
      const [L, data, n] = await Promise.all([pdfjs(), getPdf(file, key, (r) => {
        if (!bar.isConnected) loading.prepend(bar);
        bar.firstChild.style.width = `${Math.round(r * 100)}%`;
      }), loadNotes(file.id, fileKey)]);
      notes = n;
      doc = await L.getDocument({ data, isEvalSupported: false }).promise;
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
    commitText();
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5, Math.sqrt(14e6 / (pg.w * pg.h)));
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5, Math.sqrt(14e6 / (pg.w * pg.h)));
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
    if (s.t === 'text') { drawText(c, s, W); return; }
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

  // ── 텍스트 상자 ──
  const LH = 1.35;
  function drawText(c, s, W) {
    const fs = (s.fs / 1000) * W;
    c.save();
    c.font = `${s.b ? 700 : 400} ${fs}px ${FONT}`; c.fillStyle = s.c; c.textBaseline = 'top';
    String(s.s).split('\n').forEach((line, i) => c.fillText(line, s.x * W, s.y * W + i * fs * LH + fs * 0.08));
    c.restore();
  }
  function measure(s) {
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${s.b ? 700 : 400} ${s.fs}px ${FONT}`;
    const lines = String(s.s).split('\n');
    s.w = Math.max(...lines.map((l) => c.measureText(l).width), s.fs * 0.5) / 1000;
    s.h = (lines.length * s.fs * LH) / 1000;
  }
  const hitText = (s, x, y, pad = 0) => s.t === 'text' && x >= s.x - pad && x <= s.x + (s.w || 0) + pad && y >= s.y - pad && y <= s.y + (s.h || 0) + pad;

  function openText(pg, idx, item, isNew) {
    commitText();
    const prev = pg.strokes.slice();
    if (!isNew) { pg.strokes = pg.strokes.filter((x) => x !== item); redraw(pg); }
    Object.assign(txt, { c: item.c, fs: item.fs, b: !!item.b }); paintTools();
    const el = h('div', { class: 'pv-txt', contenteditable: 'true', spellcheck: 'false' });
    el.textContent = item.s || '';
    const grip = h('div', { class: 'pv-grip', title: '옮기기' }, icon('move', 'icon s'));
    const box = h('div', { class: 'pv-txtbox' }, grip, el);
    pg.wrap.append(box);
    ed = { pg, idx, item, el, box, prev, isNew };
    applyText();
    el.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
    // 옮기기
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); grip.setPointerCapture(e.pointerId);
      const sx = e.clientX; const sy = e.clientY; const ox = item.x; const oy = item.y;
      const mv = (ev) => { item.x = ox + (ev.clientX - sx) / pg.w; item.y = oy + (ev.clientY - sy) / pg.w; place(); };
      const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); el.focus(); };
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
    });
    setTimeout(() => { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }, 30);
  }
  function place() {
    if (!ed) return;
    const { pg, item, box } = ed;
    box.style.left = `${item.x * pg.w}px`; box.style.top = `${item.y * pg.w}px`;
  }
  function applyText() {
    if (!ed) return;
    const { pg, item, el } = ed;
    Object.assign(item, { c: txt.c, fs: txt.fs, b: !!txt.b });
    const fs = (item.fs / 1000) * pg.w;
    Object.assign(el.style, { fontFamily: FONT, fontSize: `${fs}px`, lineHeight: String(LH), color: item.c, fontWeight: item.b ? 700 : 400, minWidth: `${fs * 2}px` });
    place();
  }
  function commitText() {
    if (!ed) return;
    const { pg, idx, item, el, box, prev, isNew } = ed;
    ed = null;
    const text = (el.innerText || '').replace(/\u00a0/g, ' ').replace(/\n+$/, '');
    box.remove();
    if (text.trim()) {
      item.s = text; item.x = round(item.x); item.y = round(item.y); measure(item);
      pg.strokes = [...pg.strokes, item];
    }
    if (text.trim() || !isNew) history.push({ i: idx, prev });
    redraw(pg);
    undoBtn.disabled = !history.length;
    saveNotes(file.id, fileKey, idx + 1, pg.strokes);
  }
  // 텍스트 도구 : 탭한 자리에 새 상자, 기존 글자를 누르면 고치기
  function textTap(pg, idx, e) {
    if (ed) { commitText(); return; }
    const r = pg.ink.getBoundingClientRect();
    const x = (e.clientX - r.left) / pg.w; const y = (e.clientY - r.top) / pg.w;
    const hit = [...pg.strokes].reverse().find((s) => hitText(s, x, y, 0.006));
    if (hit) { openText(pg, idx, hit, false); return; }
    const fs = txt.fs / 1000;
    openText(pg, idx, { t: 'text', x: round(x), y: round(y - fs * 0.6), s: '', c: txt.c, fs: txt.fs, b: !!txt.b }, true);
  }

  // ── 터치 : 그리기 · 넘기기 · 두 손가락 확대 ──
  //  읽기 모드      : 손 · 펜슬 모두 넘기기, 두 손가락 확대
  //  편집 + 기본    : 펜슬 = 그리기, 손가락 하나 = 넘기기, 두 손가락 = 확대
  //  편집 + 손 그리기 : 손가락 하나 = 그리기, 두 손가락 = 확대 + 넘기기
  const drawsWith = (e) => editing && (e.pointerType === 'pen' || e.pointerType === 'mouse' || (e.pointerType === 'touch' && handDraw));
  let pinch = null;
  scroller.addEventListener('touchstart', (e) => {
    const t = e.touches;
    if (t.length >= 2) {
      e.preventDefault();
      cancelStroke?.();
      if (!pinch) startPinch(t);
      return;
    }
    const stylus = t[0]?.touchType === 'stylus';
    if (editing && tool !== 'text' && (stylus || handDraw) && e.target.classList?.contains('pv-ink')) e.preventDefault();
  }, { passive: false });
  scroller.addEventListener('touchmove', (e) => {
    if (pinch?.src === 'touch' && e.touches.length >= 2) { e.preventDefault(); movePinch(e.touches); return; }
    const t = e.touches[0];
    if (editing && tool !== 'text' && t && (t.touchType === 'stylus' || handDraw) && e.target.classList?.contains('pv-ink')) e.preventDefault();
  }, { passive: false });
  const touchEnd = (e) => { if (pinch?.src === 'touch' && e.touches.length < 2) endPinch(); };
  scroller.addEventListener('touchend', touchEnd);
  scroller.addEventListener('touchcancel', touchEnd);

  // 두 손가락 : 움직이는 동안은 화면만 늘리고(transform), 손을 떼면 그 크기로 다시 그림
  const mid = (t) => { const r = scroller.getBoundingClientRect(); return { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top }; };
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  function startPinch(t) {
    const m = mid(t);
    pinch = { src: 'touch', d0: dist(t), m0: m, s0: { x: scroller.scrollLeft, y: scroller.scrollTop }, s: 1, dx: 0, dy: 0 };
    list.style.transformOrigin = '0 0'; list.style.willChange = 'transform';
  }
  function movePinch(t) {
    const m = mid(t);
    const s = Math.max(ZMIN / zoom, Math.min(ZMAX / zoom, dist(t) / pinch.d0));
    Object.assign(pinch, { s, dx: m.x - pinch.m0.x, dy: m.y - pinch.m0.y });
    cancelAnimationFrame(pinch.raf); pinch.raf = requestAnimationFrame(paintPinch);
  }
  function paintPinch() {
    if (!pinch) return;
    const { s, dx, dy, m0, s0 } = pinch;
    const tx = (s0.x + m0.x) * (1 - s) + dx; const ty = (s0.y + m0.y) * (1 - s) + dy;
    list.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  }
  function endPinch() {
    const { s, dx, dy, m0, s0, raf } = pinch;
    cancelAnimationFrame(raf); cancelAnimationFrame(wheelT.raf);
    pinch = null;
    if (Math.abs(s - 1) < 0.01 && !dx && !dy) { list.style.transform = ''; list.style.willChange = ''; return; }
    list.style.transform = ''; list.style.willChange = '';
    zoom = Math.max(ZMIN, Math.min(ZMAX, zoom * s));
    layout();
    scroller.scrollLeft = (s0.x + m0.x) * s - (m0.x + dx);
    scroller.scrollTop = (s0.y + m0.y) * s - (m0.y + dy);
    paintZoom();
  }
  // 노트북 트랙패드 오므리기
  //  크롬 : ctrl + 휠 신호로 옴 → 손을 다 뗄 때까지 화면만 늘리다가 멈추면 확정
  //  사파리 : gesture 신호(scale)로 옴
  function beginAt(cx, cy, src) {
    const r = scroller.getBoundingClientRect();
    pinch = { src, d0: 1, m0: { x: cx - r.left, y: cy - r.top }, s0: { x: scroller.scrollLeft, y: scroller.scrollTop }, s: 1, dx: 0, dy: 0 };
    list.style.transformOrigin = '0 0'; list.style.willChange = 'transform';
  }
  const clampS = (v) => Math.max(ZMIN / zoom, Math.min(ZMAX / zoom, v));
  const wheelT = { t: 0, raf: 0 };
  scroller.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (pinch && pinch.src !== 'wheel') return;
    if (!pinch) beginAt(e.clientX, e.clientY, 'wheel');
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    pinch.s = clampS(pinch.s * Math.exp(-dy * 0.01));
    cancelAnimationFrame(wheelT.raf); wheelT.raf = requestAnimationFrame(paintPinch);
    clearTimeout(wheelT.t); wheelT.t = setTimeout(() => { if (pinch?.src === 'wheel') endPinch(); }, 320);
  }, { passive: false });
  let gScale = 1;
  scroller.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    if (pinch) return; // 아이패드는 터치로 이미 처리 중
    beginAt(e.clientX || scroller.getBoundingClientRect().left + scroller.clientWidth / 2, e.clientY || scroller.getBoundingClientRect().top + scroller.clientHeight / 2, 'gesture');
    gScale = 1;
  });
  scroller.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    if (pinch?.src !== 'gesture') return;
    gScale = e.scale; pinch.s = clampS(gScale);
    cancelAnimationFrame(wheelT.raf); wheelT.raf = requestAnimationFrame(paintPinch);
  });
  scroller.addEventListener('gestureend', (e) => { e.preventDefault(); if (pinch?.src === 'gesture') endPinch(); });

  function bindInk(pg, idx) {
    let cur = null; let pid = null;
    const pt = (e) => { const r = pg.ink.getBoundingClientRect(); return [(e.clientX - r.left) / pg.w, (e.clientY - r.top) / pg.w, e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5]; };
    pg.ink.addEventListener('click', (e) => { if (editing && tool === 'text' && !pinch) textTap(pg, idx, e); });
    let hold = 0; let lastMove = null;
    const armHold = () => {
      clearTimeout(hold);
      if (!cur || cur.t !== 'hl' || cur.straight) return;
      hold = setTimeout(() => { // 1.5초 멈추면 처음과 지금을 잇는 직선으로
        if (!cur || cur.t !== 'hl') return;
        cur.straight = true; cur.p = [cur.p[0], cur.p[cur.p.length - 1]];
        redraw(pg, cur);
        pg.wrap.classList.remove('snap'); void pg.wrap.offsetWidth; pg.wrap.classList.add('snap');
      }, 1500);
    };
    pg.ink.addEventListener('pointerdown', (e) => {
      if (editing && tool === 'text') return;
      if (!drawsWith(e) || pinch) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      cancelStroke = () => { if (cur && !cur.erase) { cur = null; pid = null; redraw(pg); } cancelStroke = null; };
      pid = e.pointerId; pg.ink.setPointerCapture(pid);
      if (tool === 'eraser') { history.push({ i: idx, prev: pg.strokes.slice() }); erase(pg, pt(e)); cur = { erase: true }; return; }
      cur = { t: tool === 'hl' ? 'hl' : 'pen', c: tool === 'hl' ? hl : color, w: (tool === 'hl' ? size.hl : size.pen) / 1000, p: [pt(e)] };
      lastMove = pt(e); armHold();
      redraw(pg, cur);
    });
    pg.ink.addEventListener('pointermove', (e) => {
      if (!cur || e.pointerId !== pid || pinch) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (cur.erase) { evs.forEach((x) => erase(pg, pt(x))); return; }
      if (cur.straight) { cur.p = [cur.p[0], pt(evs[evs.length - 1])]; redraw(pg, cur); return; }
      const before = cur.p.length;
      evs.forEach((x) => cur.p.push(pt(x)));
      // 조금이라도 움직이면 1.5초 다시 셈
      const q = cur.p[cur.p.length - 1];
      if (!lastMove || Math.hypot(q[0] - lastMove[0], q[1] - lastMove[1]) > 0.004) { lastMove = q; armHold(); }
      if (cur.t === 'hl') redraw(pg, cur);
      else { const seg = { ...cur, p: cur.p.slice(Math.max(0, before - 1)) }; drawStroke(pg.ctx, seg, pg.w); }
    });
    const end = (e) => {
      clearTimeout(hold);
      if (!cur || e.pointerId !== pid) return;
      delete cur.straight;
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
    if (eraseMode === 'stroke') {
      // 선 지우기 : 닿은 선을 통째로
      const r = 0.015;
      const keep = pg.strokes.filter((s) => (s.t === 'text' ? !hitText(s, x, y, r) : !s.p.some(([a, b]) => (a - x) ** 2 + (b - y) ** 2 < r * r)));
      if (keep.length !== pg.strokes.length) { pg.strokes = keep; redraw(pg); }
      return;
    }
    // 부분 지우기 : 지우개 원 안에 들어온 부분만 잘라냄
    const r = size.er / 1000; const r2 = r * r;
    const near = (a, b) => (a[0] - x) ** 2 + (a[1] - y) ** 2 < r2;
    const segHit = (a, b) => { // 두 점 사이 선분이 원을 지나가는지
      const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L));
      return (a[0] + t * dx - x) ** 2 + (a[1] + t * dy - y) ** 2 < r2;
    };
    let changed = false;
    const out = [];
    pg.strokes.forEach((s) => {
      if (s.t === 'text') { if (hitText(s, x, y, r)) changed = true; else out.push(s); return; }
      if (!s.p.some((q, i) => near(q) || (i && segHit(s.p[i - 1], q)))) { out.push(s); return; }
      changed = true;
      let part = [];
      s.p.forEach((q, i) => {
        if (near(q)) { if (part.length) out.push({ ...s, p: part }); part = []; return; }
        if (i && part.length && segHit(s.p[i - 1], q)) { out.push({ ...s, p: part }); part = []; }
        part.push(q);
      });
      if (part.length) out.push({ ...s, p: part });
    });
    if (changed) { pg.strokes = out.filter((s) => s.t === 'text' || s.p.length > 1 || s.t !== 'hl'); redraw(pg); }
  }
  function undo() {
    const last = history.pop(); if (!last) return;
    const pg = pages[last.i];
    pg.strokes = last.prev; redraw(pg);
    saveNotes(file.id, fileKey, last.i + 1, pg.strokes);
    undoBtn.disabled = !history.length;
  }

  // ── 확대 버튼 · 쪽 번호 ──
  function zoomBy(f) {
    const nz = Math.max(ZMIN, Math.min(ZMAX, zoom * f)); if (nz === zoom) return;
    const s = nz / zoom; const cx = scroller.clientWidth / 2; const cy = scroller.clientHeight / 2;
    const sx = scroller.scrollLeft; const sy = scroller.scrollTop;
    zoom = nz; layout();
    scroller.scrollLeft = (sx + cx) * s - cx; scroller.scrollTop = (sy + cy) * s - cy;
    paintZoom();
  }
  function paintZoom() { zoomOut.disabled = zoom <= ZMIN + 0.001; zoomIn.disabled = zoom >= ZMAX - 0.001; }
  paintZoom();
  scroller.addEventListener('scroll', () => {
    if (!pages.length) return;
    const mid = scroller.scrollTop + scroller.clientHeight / 3;
    let n = 0; for (let i = 0; i < pages.length; i++) { if (pages[i].wrap.offsetTop <= mid) n = i; else break; }
    pageInfo.textContent = `${n + 1} / ${pages.length}`;
  }, { passive: true });

  // ── 다운로드 (파일 그대로 저장) ──
  async function download(e) {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const blob = new Blob([await getPdf(file, key)], { type: 'application/pdf' });
      const a = h('a', { href: URL.createObjectURL(blob), download: file.filename || `${file.series || '자료'}.pdf` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch { toast('다운로드하지 못했습니다'); }
    btn.disabled = false;
  }

  // ── 굿노트로 보내기 (공유 시트) ──
  async function share() {
    try {
      const blob = new Blob([await getPdf(file, key)], { type: 'application/pdf' });
      const f = new File([blob], file.filename || 'file.pdf', { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: file.series }); return; }
      const a = h('a', { href: URL.createObjectURL(f), download: f.name }); document.body.append(a); a.click(); a.remove();
    } catch (e) { if (e?.name !== 'AbortError') toast('파일을 보낼 수 없습니다'); }
  }
}

const round = (v) => Math.round(v * 10000) / 10000;
