import { h, icon, toast, popover } from '../ui.js';
import { loadNotes, saveNotes } from '../data/files.js';
import { getPdf } from '../data/offline.js';
import { sb } from '../sb.js';
import { S } from '../app.js';

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
  const markBtn = h('button', { class: 'pv-t pv-markbtn', title: '페이지 표시', 'aria-label': '페이지 표시', onclick: () => openMarks() }, icon('bookmark'));
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
  // 쪽 미리보기 (접었다 펴기, 상태는 기기에 기억)
  const thumbs = h('div', { class: 'pv-th', 'aria-label': '쪽 미리보기' });
  const TH_KEY = 'kmed:pvthumbs';
  const thBtn = h('button', { class: 'pv-t pv-thbtn', title: '쪽 미리보기', 'aria-label': '쪽 미리보기', onclick: () => setThumbs(!root.classList.contains('th-on')) }, icon('sidebar'));
  const body = h('div', { class: 'pv-body' }, thumbs, scroller);
  const top = h('header', { class: 'pv-top' },
    h('div', { class: 'pv-left' },
      h('button', { class: 'pv-t', 'aria-label': '닫기', onclick: close }, icon('x')),
      thBtn,
      h('div', { class: 'pv-ttl' }, h('b', {}, file.series || file.filename), h('span', {}, [file.week, label].filter(Boolean).join('  ')))),
    h('div', { class: 'pv-tools' },
      tbtn('pen', 'pen', '펜'), tbtn('hl', 'marker', '형광펜'), tbtn('text', 'type', '텍스트 상자'), tbtn('eraser', 'eraser', '지우개'),
      h('i', { class: 'pv-div' }), swatches, h('i', { class: 'pv-div' }), sizes, boldBtn, pinBtn, h('i', { class: 'pv-div' }), handBtn, undoBtn),
    h('div', { class: 'pv-right' }, zoomOut, zoomIn, pageInfo,
      h('button', { class: 'pv-t', title: '찾기', 'aria-label': '찾기', onclick: () => openFind() }, icon('search')),
      markBtn,
      onComments ? h('button', { class: 'pv-t', title: '댓글', 'aria-label': '댓글', onclick: () => onComments() }, icon('chat')) : null,
      h('button', { class: 'pv-t', title: '굿노트로 보내기', 'aria-label': '굿노트로 보내기', onclick: share }, icon('share')),
      h('button', { class: 'pv-t', title: '다운로드', 'aria-label': '다운로드', onclick: download }, icon('download')), editBtn));
  const loading = h('div', { class: 'pv-load' }, h('i', { class: 'skel' }), h('i', { class: 'skel' }));
  const root = h('div', { class: 'pv', role: 'dialog', 'aria-modal': 'true' }, top, body, loading);
  document.body.append(root);
  document.documentElement.classList.add('pv-open');
  // 좁은 화면 : 필기 도구는 아래쪽 떠 있는 줄로 (위 막대 안에 두면 고정 위치가 안 먹음)
  const toolsEl = top.querySelector('.pv-tools');
  const narrow = matchMedia('(max-width: 760px)');
  const placeTools = () => {
    if (narrow.matches) root.append(toolsEl); else top.insertBefore(toolsEl, top.querySelector('.pv-right'));
    // 미리보기 버튼 : 넓으면 닫기 옆, 좁으면 제목 자리를 지키려고 오른쪽 묶음 맨 앞
    if (narrow.matches) top.querySelector('.pv-right').prepend(thBtn); else top.querySelector('.pv-left').insertBefore(thBtn, top.querySelector('.pv-ttl'));
  };
  placeTools(); narrow.addEventListener?.('change', placeTools);
  requestAnimationFrame(() => root.classList.add('on'));
  paintTools(); paintMode();

  function paintMode() {
    root.classList.toggle('editing', editing);
    root.classList.toggle('hand', editing && handDraw);
    handBtn.classList.toggle('on', handDraw);
    editBtn.replaceChildren(...(editing ? [icon('check', 'icon')] : [icon('pen', 'icon s'), h('span', {}, '필기')]));
    editBtn.title = editing ? '완료' : '필기';
    editBtn.classList.toggle('on', editing);
    if (!editing) commitText();
    root.classList.toggle('texting', editing && tool === 'text');
    // 편집 켜면 보이는 쪽에 필기 그림판 만들기, 끄면 빈 쪽은 비우기
    pages.forEach((pg) => { if (pg.near) sizeInk(pg); });
  }

  function close() {
    commitText();
    alive = false;
    root.classList.remove('on');
    document.documentElement.classList.remove('pv-open');
    io?.disconnect(); relIo?.disconnect(); thIo?.disconnect(); thRel?.disconnect(); ro.disconnect(); document.removeEventListener('keydown', onKey);
    thItems.forEach((t) => { t.cv.width = 0; t.cv.height = 0; });
    pages.forEach((pg) => { try { pg.task?.cancel(); } catch { /* 무시 */ } pg.cv.width = 0; pg.cv.height = 0; pg.ink.width = 0; pg.ink.height = 0; });
    setTimeout(() => { root.remove(); doc?.destroy?.(); }, 300);
  }
  const onKey = (e) => {
    if (e.target?.closest?.('.cm-drawer') || document.querySelector('.cm-drawer.on')) return;
    if (ed) { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); commitText(); } return; }
    if (e.target?.closest?.('.pv-find') && e.key !== 'Escape') return;
    if (e.key === 'Escape') { if (find) { closeFind(); return; } close(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); return; }
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
      doc = await L.getDocument({ data, isEvalSupported: false, isOffscreenCanvasSupported: false, maxImageSize: 4096 * 4096 }).promise;
      if (!alive) return;
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const vp = p.getViewport({ scale: 1 });
        const cv = h('canvas', { class: 'pv-cv' });
        const ink = h('canvas', { class: 'pv-ink' });
        const wrap = h('div', { class: 'pv-page', 'data-i': i - 1 }, cv, ink, h('div', { class: 'pv-hits' }), h('i', { class: 'pv-mark' }, icon('bookmark')));
        const pg = { page: p, wrap, cv, ink, vp, rendered: 0, strokes: notes.get(i) || [] };
        pages.push(pg);
        list.append(wrap);
        bindInk(pg, i - 1);
        addThumb(pg, i);
      }
      layout();
      watchThumbs();
      markThumb(1);
      loading.remove();
      root.classList.add('ready');
      pageInfo.textContent = `1 / ${doc.numPages}`;
      paintMarks();
    } catch (e) {
      loading.replaceChildren(h('div', { class: 'pv-err' }, e.message || 'PDF를 열 수 없습니다'));
    }
  })();

  // ── 크기 · 그리기 ──
  let io = null;
  const fitW = () => Math.min(scroller.clientWidth - 32, 1100);
  // 메모리 : 아이폰 · 아이패드는 그림판(canvas) 메모리가 작아서, 보이는 근처 쪽만 그리고 먼 쪽은 비움
  const ua = navigator.userAgent;
  const IOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const MAXPX = IOS ? 2.4e6 : 9e6;   // 한 장 그림판 최대 픽셀
  const dprOf = (pg) => Math.min(window.devicePixelRatio || 1, IOS ? 2 : 2.5, Math.sqrt(MAXPX / (pg.w * pg.h)));
  let relIo = null;
  function layout() {
    commitText();
    const w = Math.round(fitW() * zoom);
    pages.forEach((pg) => {
      const hgt = Math.round(w * pg.vp.height / pg.vp.width);
      pg.wrap.style.width = `${w}px`; pg.wrap.style.height = `${hgt}px`;
      pg.w = w; pg.h = hgt;
      if (pg.rendered && pg.rendered !== w) pg.rendered = 0;
      if (pg.near) sizeInk(pg); else pg.inkW = 0;
    });
    io?.disconnect(); relIo?.disconnect();
    // 가까워지면 그리기
    io = new IntersectionObserver((es) => es.forEach((e) => {
      const pg = pages[+e.target.dataset.i];
      if (e.isIntersecting) { pg.near = true; if (pg.inkW !== pg.w) sizeInk(pg); queue(pg); }
    }), { root: scroller, rootMargin: IOS ? '500px 0px' : '1200px 0px' });
    // 멀어지면 비우기
    relIo = new IntersectionObserver((es) => es.forEach((e) => {
      const pg = pages[+e.target.dataset.i];
      if (!e.isIntersecting) release(pg);
    }), { root: scroller, rootMargin: IOS ? '1200px 0px' : '3000px 0px' });
    pages.forEach((pg) => { io.observe(pg.wrap); relIo.observe(pg.wrap); });
  }
  function release(pg) {
    pg.near = false;
    if (pg.task) { try { pg.task.cancel(); } catch { /* 무시 */ } }
    pg.cv.width = 0; pg.cv.height = 0; pg.rendered = 0;
    pg.ink.width = 0; pg.ink.height = 0; pg.ctx = null; pg.inkW = 0;
    pg.wrap.classList.remove('in');
    try { pg.page.cleanup(); } catch { /* 무시 */ }
  }
  const ro = new ResizeObserver(() => { clearTimeout(ro.t); ro.t = setTimeout(() => { if (pages.length) layout(); }, 150); });
  ro.observe(scroller);

  // 그리기는 한 번에 한 쪽씩 (동시에 여러 장 그리면 메모리가 튐)
  const rq = []; let rbusy = false;
  function queue(pg) { if (!pg || !pg.near || pg.rendered === pg.w) return; if (!rq.includes(pg)) rq.push(pg); pump(); }
  async function pump() {
    if (rbusy || !alive) return;
    const pg = rq.shift();
    if (!pg) { const t = tq.shift(); if (!t) return; rbusy = true; await renderThumb(t).catch(() => {}); rbusy = false; pump(); return; }
    rbusy = true;
    await render(pg).catch(() => {});
    rbusy = false;
    pump();
  }
  async function render(pg) {
    if (!pg || !pg.near || pg.rendered === pg.w) return;
    const w = pg.w;
    const dpr = dprOf(pg);
    const vp = pg.page.getViewport({ scale: (w / pg.vp.width) * dpr });
    const fresh = h('canvas', { class: 'pv-cv' });
    fresh.width = Math.floor(vp.width); fresh.height = Math.floor(vp.height);
    let ok = false;
    try {
      pg.task = pg.page.render({ canvasContext: fresh.getContext('2d', { alpha: false }), viewport: vp });
      await pg.task.promise;
      if (pg.near && pg.w === w) {
        const old = pg.cv; old.replaceWith(fresh); old.width = 0; old.height = 0; // 옛 그림판 바로 비우기
        pg.cv = fresh; pg.rendered = w; ok = true;
        pg.wrap.classList.add('in');
      }
    } catch { /* 취소 */ }
    pg.task = null;
    if (!ok) { fresh.width = 0; fresh.height = 0; }
    if (pg.near && pg.rendered !== pg.w) queue(pg);
  }

  function sizeInk(pg) {
    if (!editing && !pg.strokes.length) { pg.ink.width = 0; pg.ink.height = 0; pg.ctx = null; pg.inkW = pg.w; return; }
    const dpr = dprOf(pg);
    pg.ink.width = Math.round(pg.w * dpr); pg.ink.height = Math.round(pg.h * dpr);
    const ctx = pg.ink.getContext('2d', { desynchronized: true });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pg.ctx = ctx; pg.inkW = pg.w;
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
  // ── 손바닥(손날) 무시 ──
  //  펜슬로 쓰는 사람은 손날이 화면에 닿음. 그 손날로 화면이 밀리거나 흔들리지 않게
  //  · 펜슬이 닿아 있는 동안, 뗀 뒤 0.5초 동안은 손가락 터치를 전부 무시
  //  · 넓게 닿는 터치(손바닥, 손날)는 넘기기 · 확대에 안 씀
  //  · 펜슬을 쓰는 기기에서 편집할 때는 브라우저 기본 스크롤을 끄고 직접 넘김
  //    (그래야 손날이 먼저 닿아 움직이기 시작해도 펜슬이 오면 바로 멈추고 되돌릴 수 있음)
  let penUser = localStorage.getItem('kmed:penuser') === '1';
  let penDown = false; let penUp = 0;
  const PALM = 26;                                   // 이보다 넓게 닿으면 손바닥으로 봄 (px)
  const palmTouch = (t) => Math.max(t.radiusX || t.webkitRadiusX || 0, t.radiusY || t.webkitRadiusY || 0) > PALM;
  const palmPointer = (e) => e.pointerType === 'touch' && Math.max(e.width || 0, e.height || 0) > PALM * 2;
  const penBusy = () => penDown || Date.now() - penUp < 500;
  const guard = () => editing && penUser && !handDraw;   // 직접 넘기기를 쓰는 상태
  const markPenUser = () => {
    if (penUser) return;
    penUser = true; try { localStorage.setItem('kmed:penuser', '1'); } catch { /* 무시 */ }
    root.classList.toggle('pen-user', true);
  };
  root.classList.toggle('pen-user', penUser);
  scroller.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'pen') return;
    markPenUser(); penDown = true; dropFinger(true);
  }, true);
  const penOff = (e) => { if (e.pointerType === 'pen') { penDown = false; penUp = Date.now(); } };
  scroller.addEventListener('pointerup', penOff, true);
  scroller.addEventListener('pointercancel', penOff, true);

  // 직접 넘기기 (손가락 하나) : 관성까지
  let fing = null; let fly = 0;
  function dropFinger(undo) {
    cancelAnimationFrame(fly);
    if (!fing) return;
    // 펜슬이 오기 직전 0.4초 안에 움직인 건 손날이 민 것으로 보고 되돌림
    if (undo && fing.moved && Date.now() - fing.t0 < 400) scroller.scrollTo({ left: fing.sl, top: fing.st });
    fing = null;
  }
  const fingers = (list) => [...list].filter((t) => t.touchType !== 'stylus');

  const drawsWith = (e) => editing && !palmPointer(e) && (e.pointerType === 'pen' || e.pointerType === 'mouse' || (e.pointerType === 'touch' && handDraw));
  let pinch = null;
  scroller.addEventListener('touchstart', (e) => {
    const all = e.touches;
    const stylusOn = [...all].some((t) => t.touchType === 'stylus');
    if (stylusOn) markPenUser();
    const f = fingers(all).filter((t) => !palmTouch(t));
    if (editing && (stylusOn || penBusy())) { if (tool !== 'text') e.preventDefault(); dropFinger(true); return; }   // 펜슬 쓰는 중 : 손은 전부 무시
    if (f.length >= 2) {
      e.preventDefault(); dropFinger(false);
      cancelStroke?.();
      if (!pinch) startPinch(f);
      return;
    }
    if (guard()) {
      // 기본 스크롤은 CSS(touch-action:none)로 꺼 둠. 여기서 막으면 텍스트 상자 탭이 안 됨
      if (f.length === 1 && fingers(all).length === 1) {
        const t = f[0];
        fing = { id: t.identifier, x0: t.clientX, y0: t.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop, t0: Date.now(), moved: false, v: [] };
        cancelAnimationFrame(fly);
      } else dropFinger(false);     // 손바닥만 닿음 : 아무것도 안 함
      return;
    }
    if (editing && tool !== 'text' && handDraw && e.target.classList?.contains('pv-ink')) e.preventDefault();
  }, { passive: false });
  scroller.addEventListener('touchmove', (e) => {
    const f = fingers(e.touches).filter((t) => !palmTouch(t));
    if (pinch?.src === 'touch' && f.length >= 2) { e.preventDefault(); movePinch(f); return; }
    if (editing && ([...e.touches].some((t) => t.touchType === 'stylus') || penBusy())) { e.preventDefault(); return; }
    if (guard()) {
      e.preventDefault();
      const t = fing && [...e.touches].find((x) => x.identifier === fing.id);
      if (!t) return;
      if (palmTouch(t)) { dropFinger(true); return; }         // 닿는 면이 넓어짐 = 손날
      const dx = t.clientX - fing.x0; const dy = t.clientY - fing.y0;
      if (!fing.moved && Math.hypot(dx, dy) < 8) return;
      fing.moved = true;
      scroller.scrollLeft = fing.sl - dx; scroller.scrollTop = fing.st - dy;
      const now = performance.now();
      fing.v.push([now, t.clientX, t.clientY]); if (fing.v.length > 5) fing.v.shift();
      return;
    }
    if (editing && tool !== 'text' && handDraw && e.target.classList?.contains('pv-ink')) e.preventDefault();
  }, { passive: false });
  const touchEnd = (e) => {
    if (pinch?.src === 'touch' && fingers(e.touches).filter((t) => !palmTouch(t)).length < 2) endPinch();
    if (fing && ![...e.touches].some((x) => x.identifier === fing.id)) {
      // 손을 뗀 속도로 조금 더 미끄러지기
      const v = fing.v; fing = null;
      if (v.length >= 2 && !penBusy()) {
        const [t1, x1, y1] = v[0]; const [t2, x2, y2] = v[v.length - 1]; const dt = Math.max(16, t2 - t1);
        let vx = ((x2 - x1) / dt) * 16; let vy = ((y2 - y1) / dt) * 16;
        if (performance.now() - t2 < 80 && Math.hypot(vx, vy) > 2) {
          const step = () => {
            scroller.scrollLeft -= vx; scroller.scrollTop -= vy;
            vx *= 0.94; vy *= 0.94;
            if (Math.hypot(vx, vy) > 0.4 && !penBusy()) fly = requestAnimationFrame(step);
          };
          fly = requestAnimationFrame(step);
        }
      }
    }
  };
  scroller.addEventListener('touchend', touchEnd);
  scroller.addEventListener('touchcancel', touchEnd);

  // 두 손가락 : 움직이는 동안은 화면만 늘리고(transform), 손을 떼면 그 크기로 다시 그림
  const mid = (t) => { const r = scroller.getBoundingClientRect(); return { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top }; };
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  function startPinch(t) {
    const m = mid(t);
    pinch = { src: 'touch', d0: dist(t), m0: m, s0: { x: scroller.scrollLeft, y: scroller.scrollTop }, s: 1, dx: 0, dy: 0 };
    list.style.transformOrigin = '0 0'; 
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
    if (Math.abs(s - 1) < 0.01 && !dx && !dy) { list.style.transform = ''; return; }
    list.style.transform = '';
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
    list.style.transformOrigin = '0 0'; 
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
      if (!pg.ctx) sizeInk(pg);
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
    if (curPage !== n + 1) markThumb(n + 1);
    curPage = n + 1; markBtn.classList.toggle('on', marks.includes(curPage));
  }, { passive: true });
  let curPage = 1;
  const goPage = (n, smooth = true) => { const pg = pages[n - 1]; if (pg) scroller.scrollTo({ top: pg.wrap.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' }); };

  // ── 쪽 미리보기 ──
  // 작게(폭 96px) 그리고, 보이는 근처만 그림. 그리기는 본문 다음 순서라 읽기를 방해하지 않음
  const thItems = []; const tq = []; let thIo = null; let thRel = null;
  const TW = 96;
  function addThumb(pg, n) {
    const cv = h('canvas');
    const el = h('button', { class: 'pv-thi', 'data-i': n - 1, 'aria-label': `${n}쪽으로 가기`, onclick: () => goPage(n, false) },
      h('span', { class: 'pv-thc', style: { aspectRatio: `${pg.vp.width} / ${pg.vp.height}` } }, cv), h('b', {}, n));
    thItems.push({ el, cv, pg, done: false, near: false });
    thumbs.append(el);
  }
  function watchThumbs() {
    thIo = new IntersectionObserver((es) => es.forEach((e) => {
      const t = thItems[+e.target.dataset.i];
      if (e.isIntersecting) { t.near = true; if (!t.done && !tq.includes(t)) { tq.push(t); pump(); } }
    }), { root: thumbs, rootMargin: '400px' });
    thRel = new IntersectionObserver((es) => es.forEach((e) => {
      const t = thItems[+e.target.dataset.i];
      if (!e.isIntersecting) { t.near = false; t.done = false; t.cv.width = 0; t.cv.height = 0; const k = tq.indexOf(t); if (k >= 0) tq.splice(k, 1); }
    }), { root: thumbs, rootMargin: '1600px' });
    thItems.forEach((t) => { thIo.observe(t.el); thRel.observe(t.el); });
  }
  async function renderThumb(t) {
    if (!t.near || t.done || !root.classList.contains('th-on')) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = t.pg.page.getViewport({ scale: (TW * dpr) / t.pg.vp.width });
    t.cv.width = Math.floor(vp.width); t.cv.height = Math.floor(vp.height);
    await t.pg.page.render({ canvasContext: t.cv.getContext('2d', { alpha: false }), viewport: vp }).promise;
    t.done = true;
    t.el.classList.add('in');
  }
  function markThumb(n) {
    thItems.forEach((t, i) => t.el.classList.toggle('cur', i === n - 1));
    const t = thItems[n - 1]; if (!t || !root.classList.contains('th-on')) return;
    // 미리보기 줄 안에서만 움직임 (본문 스크롤은 건드리지 않음)
    const el = t.el; const wide = getComputedStyle(body).flexDirection === 'row';
    if (wide) {
      const y = el.offsetTop - thumbs.clientHeight / 2 + el.offsetHeight / 2;
      thumbs.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    } else {
      const x = el.offsetLeft - thumbs.clientWidth / 2 + el.offsetWidth / 2;
      thumbs.scrollTo({ left: Math.max(0, x), behavior: 'smooth' });
    }
  }
  function setThumbs(on, save = true) {
    root.classList.toggle('th-on', on);
    thBtn.classList.toggle('on', on);
    if (save) { try { localStorage.setItem(TH_KEY, on ? '1' : '0'); } catch { /* 무시 */ } }
    if (on) { thItems.forEach((t) => { if (t.near && !t.done && !tq.includes(t)) tq.push(t); }); pump(); setTimeout(() => markThumb(curPage), 280); }
  }
  {
    let saved = null; try { saved = localStorage.getItem(TH_KEY); } catch { /* 무시 */ }
    setThumbs(saved == null ? !matchMedia('(max-width: 760px)').matches : saved === '1', false);
  }

  // ── 페이지 표시 (책갈피) : 나만 보기, 계정에 저장 ──
  const MK = `pvmark:${file.id}`;
  let marks = [];
  try { marks = JSON.parse(localStorage.getItem(`kmed:${MK}`) || '[]'); } catch { /* 무시 */ }
  sb.from('user_state').select('value').eq('user_id', S.user.id).eq('key', MK).maybeSingle()
    .then(({ data }) => { if (Array.isArray(data?.value?.pages)) { marks = data.value.pages; paintMarks(); } }, () => {});
  function saveMarks() {
    try { localStorage.setItem(`kmed:${MK}`, JSON.stringify(marks)); } catch { /* 무시 */ }
    sb.from('user_state').upsert({ user_id: S.user.id, key: MK, value: { pages: marks }, updated_at: new Date().toISOString() }).then(() => {}, () => {});
  }
  function paintMarks() {
    pages.forEach((pg, i) => pg.wrap.classList.toggle('marked', marks.includes(i + 1)));
    thItems.forEach((t, i) => t.el.classList.toggle('marked', marks.includes(i + 1)));
    markBtn.classList.toggle('on', marks.includes(curPage));
    markBtn.classList.toggle('has', marks.length > 0);
  }
  function openMarks() {
    if (!pages.length) return;
    const on = marks.includes(curPage);
    const p = popover(markBtn, h('div', { class: 'pv-marks' },
      h('button', { class: 'pv-mk-toggle' + (on ? ' on' : ''), onclick: () => {
        marks = on ? marks.filter((x) => x !== curPage) : [...marks, curPage].sort((a, b) => a - b);
        saveMarks(); paintMarks(); p.close(); toast(on ? `${curPage}쪽 표시를 뺐습니다` : `${curPage}쪽을 표시했습니다`);
      } }, icon('bookmark', 'icon s'), on ? `${curPage}쪽 표시 빼기` : `${curPage}쪽 표시하기`),
      marks.length ? h('div', { class: 'pv-mk-list' }, marks.map((n) => h('button', { class: n === curPage ? 'cur' : '', onclick: () => { p.close(); goPage(n); } }, h('b', {}, `${n}쪽`), icon('right', 'icon s')))) : null), { align: 'right', width: 220 });
  }

  // ── 찾기 (PDF 안 글자) ──
  const texts = new Map();
  async function pageText(i) {
    if (texts.has(i)) return texts.get(i);
    const pg = pages[i];
    const tc = await pg.page.getTextContent();
    const vp = pg.page.getViewport({ scale: 1 });
    const items = tc.items.filter((it) => it.str).map((it) => {
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const fh = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      return { s: it.str, x: x / vp.width, y: (y - fh) / vp.height, w: (it.width || 0) / vp.width, hgt: (fh * 1.15) / vp.height };
    });
    // 공백을 뺀 글자마다 어느 조각의 몇 번째 글자인지 기억 (여러 조각에 걸친 단어도 찾기)
    const chars = [];
    items.forEach((it) => { [...it.s].forEach((ch, k) => { if (!/\s/.test(ch)) chars.push({ it, k, ch: ch.toLowerCase() }); }); });
    const v = { items, chars, all: chars.map((c) => c.ch).join('') };
    texts.set(i, v);
    return v;
  }
  let find = null;
  function openFind() {
    if (find) { find.inp.focus(); find.inp.select(); return; }
    const inp = h('input', { type: 'search', placeholder: 'PDF 안에서 찾기', spellcheck: 'false' });
    const cnt = h('span', { class: 'pv-f-cnt' });
    const prev = h('button', { class: 'pv-t', 'aria-label': '이전', onclick: () => step(-1) }, icon('up'));
    const next = h('button', { class: 'pv-t', 'aria-label': '다음', onclick: () => step(1) }, icon('down'));
    const bar = h('div', { class: 'pv-find' }, icon('search', 'icon s'), inp, cnt, prev, next,
      h('button', { class: 'pv-t', 'aria-label': '닫기', onclick: () => closeFind() }, icon('x')));
    root.append(bar);
    find = { inp, cnt, bar, hits: [], at: -1, seq: 0 };
    let t = 0;
    inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 220); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { e.stopPropagation(); closeFind(); } });
    setTimeout(() => inp.focus(), 50);
  }
  function closeFind() { if (!find) return; find.bar.remove(); find = null; pages.forEach((pg) => pg.wrap.querySelector('.pv-hits').replaceChildren()); }
  async function run() {
    if (!find) return;
    const seq = ++find.seq;
    const q = find.inp.value.replace(/\s+/g, '').toLowerCase();
    pages.forEach((pg) => pg.wrap.querySelector('.pv-hits').replaceChildren());
    find.hits = []; find.at = -1;
    if (!q) { find.cnt.textContent = ''; return; }
    find.cnt.textContent = '찾는 중';
    for (let i = 0; i < pages.length; i++) {
      const tx = await pageText(i).catch(() => null);
      if (!find || seq !== find.seq) return;
      if (!tx || !tx.all.includes(q)) continue;
      // 찾은 곳마다 노란 표시 (조각에 걸치면 조각마다 나눠서)
      const box = pages[i].wrap.querySelector('.pv-hits');
      let marked = 0;
      let k = tx.all.indexOf(q);
      while (k >= 0) {
        const seg = new Map();
        tx.chars.slice(k, k + q.length).forEach((c) => { const r = seg.get(c.it) || [c.k, c.k]; seg.set(c.it, [Math.min(r[0], c.k), Math.max(r[1], c.k)]); });
        let first = null; const els = [];
        seg.forEach(([k0, k1], it) => {
          const L = [...it.s].length || 1;
          const el = h('i', { style: { left: `${(it.x + (it.w * k0) / L) * 100}%`, top: `${it.y * 100}%`, width: `${Math.max(0.6, ((it.w * (k1 - k0 + 1)) / L) * 100)}%`, height: `${it.hgt * 100}%` } });
          box.append(el); first = first || el; els.push(el);
        });
        if (first) { find.hits.push({ page: i + 1, el: first, els }); marked++; }
        k = tx.all.indexOf(q, k + q.length);
      }
      if (!marked) find.hits.push({ page: i + 1, el: null });
    }
    if (!find || seq !== find.seq) return;
    if (!find.hits.length) { find.cnt.textContent = '없음'; return; }
    step(1);
  }
  function step(d) {
    if (!find?.hits.length) return;
    find.at = (find.at + d + find.hits.length) % find.hits.length;
    const hit = find.hits[find.at];
    find.cnt.textContent = `${find.at + 1} / ${find.hits.length}`;
    pages.forEach((pg) => pg.wrap.querySelectorAll('.pv-hits i.cur').forEach((x) => x.classList.remove('cur')));
    if (hit.el) {
      hit.els.forEach((x) => x.classList.add('cur'));
      const pg = pages[hit.page - 1];
      const y = pg.wrap.offsetTop + hit.el.offsetTop - scroller.clientHeight / 3;
      scroller.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    } else goPage(hit.page);
  }

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
