import { sb } from '../sb.js';
import { h, icon, toast, seg, shake } from '../ui.js';
import { uploadImgFull, dropImgs, imgSrc } from '../data/images.js';
import { listFiles } from '../data/files.js';
import { getPdf } from '../data/offline.js';
import { pdfjs } from './pdf-viewer.js';

// ─────────────────────────────────────────────
// 그림 카드 만들기 (담당자)
//  ① 그림 넣기 : 과목 PDF 에서 오리기 또는 사진 올리기 (붙여넣기도 됨)
//  ② 테이프 붙이기 : 이름 자리에 네모 그리기 → 이름 목록에서 고르기 (다음 이름이 자동으로 골라져 있음)
//     손가락 하나 = 그리기, 옮기기 / 두 손가락 = 확대, 이동 / 펜슬 쓰는 중에는 손 터치 무시
//  저장 : 테이프마다 고정 번호(id)가 있어서 나중에 고쳐도 공부 기록이 유지됨
// ─────────────────────────────────────────────
const MAXW = 2000;           // 그림 긴 쪽 (작은 글씨도 읽히게 조금 크게)
const MIN = 0.012;           // 이보다 작게 그리면 그냥 누른 것으로 봄

export function openOccEditor({ sub, range, set: s0, decks = [], onSaved, queue = [], startCrop = false, lastFile = null }) {
  const set = s0 ? JSON.parse(JSON.stringify(s0)) : { id: null, deck: decks[decks.length - 1] || '', title: '', kind: 'label', labels: [], boxes: [], img: null, img_w: null, img_h: null, src_file: '', src_page: null, hint: '' };
  set.labels = Array.isArray(set.labels) ? set.labels.filter(Boolean) : [];
  set.boxes = Array.isArray(set.boxes) ? set.boxes : [];
  const origImg = s0?.img || null;
  const temp = new Set();            // 이번에 올렸지만 아직 저장 안 한 그림
  let dirty = false; let sel = null; let pick = null; // pick : 다음 테이프에 붙일 이름
  const mark = () => { dirty = true; };

  // ── 틀 ──
  const titleIn = h('input', { class: 'oe-title', placeholder: '그림 이름 (예: 팔 근육 앞면)', value: set.title, spellcheck: 'false', oninput: () => { set.title = titleIn.value; mark(); } });
  const saveBtn = h('button', { class: 'btn ink sm oe-save', onclick: () => save() }, '저장');
  const closeBtn = h('button', { class: 'ib', 'aria-label': '닫기', onclick: () => close() }, icon('x'));
  const stageWrap = h('div', { class: 'oe-main' });
  const panel = h('aside', { class: 'oe-panel' });
  const root = h('div', { class: 'oe', role: 'dialog', 'aria-modal': 'true' },
    h('header', { class: 'oe-head' }, closeBtn, titleIn, saveBtn),
    h('div', { class: 'oe-body' }, stageWrap, panel));
  root.addEventListener('dragstart', (e) => e.preventDefault());
  document.body.append(root);
  document.documentElement.classList.add('pv-open');
  requestAnimationFrame(() => root.classList.add('on'));

  let armed = 0;
  function close(force) {
    if (dirty && !force && Date.now() - armed > 2500) { armed = Date.now(); toast('저장하지 않은 내용이 있습니다. 한 번 더 누르면 닫습니다'); return; }
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('paste', onPaste, true);
    stage?.stop();
    if (temp.size) dropImgs([...temp]);     // 올렸지만 저장 안 한 그림 (저장한 그림은 save 에서 빠짐)
    document.documentElement.classList.remove('pv-open');
    root.classList.remove('on'); setTimeout(() => root.remove(), 260);
  }
  const onKey = (e) => {
    const tag = (e.target.tagName || '').toUpperCase();
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (cropper) { cropper.cancel(); return; } close(); return; }
    if (e.key === 'Enter' && cropper && !e.isComposing && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') { e.preventDefault(); cropper.enter(); return; }
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if ((e.key === 'Backspace' || e.key === 'Delete') && sel) { e.preventDefault(); removeBox(sel); }
  };
  document.addEventListener('keydown', onKey, true);
  // 그림 붙여넣기
  const onPaste = (e) => {
    const file = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault(); putImage(file);
  };
  document.addEventListener('paste', onPaste, true);

  // ── 그림 넣기 ──
  let cropper = null; let usedFile = lastFile;
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => { const f = fileIn.files?.[0]; fileIn.value = ''; if (f) putImage(f); } });
  root.append(fileIn);
  async function putImage(file) {
    showBusy('그림을 올리는 중');
    try {
      const r = await uploadImgFull(sub.id, file, null, MAXW);
      temp.add(r.key);
      const had = !!set.img;
      set.img = r.key; set.img_w = r.w; set.img_h = r.h; mark();
      if (had && set.boxes.length) toast('그림을 바꿨습니다. 테이프 위치를 한 번 확인해 주세요');
      paint();
    } catch (e) { toast(e.message || '그림을 올리지 못했습니다'); paint(); }
  }
  function showBusy(t) {
    stageWrap.replaceChildren(h('div', { class: 'oe-busy' }, h('i', { class: 'oe-spin' }), h('span', {}, t)));
  }
  function sourcePicker() {
    const hintTxt = set.src_file || set.src_page ? [set.src_file, set.src_page ? `${set.src_page}번째 장` : ''].filter(Boolean).join(' ') : '';
    return h('div', { class: 'oe-src' },
      h('div', { class: 'oe-src-t' }, '그림을 넣어 주세요'),
      hintTxt ? h('div', { class: 'oe-src-h' }, icon('file', 'icon s'), hintTxt) : null,
      h('div', { class: 'oe-src-b' },
        h('button', { class: 'oe-src-btn', onclick: () => openCropper() }, icon('file'), h('b', {}, 'PDF에서 오리기'), h('span', {}, '자료 탭의 PDF')),
        h('button', { class: 'oe-src-btn', onclick: () => fileIn.click() }, icon('image'), h('b', {}, '사진 올리기'), h('span', {}, '붙여넣기도 됩니다'))),
      set.img ? h('button', { class: 'btn ghost sm oe-src-cancel', onclick: () => paint() }, '그대로 두기') : null);
  }

  // ── PDF 에서 오리기 ──
  async function openCropper() {
    showBusy('자료를 불러오는 중');
    let files = [];
    try { files = (await listFiles(sub.id)).filter((f) => /\.pdf$/i.test(f.filename || '') || f.key); } catch { files = []; }
    if (!files.length) { toast('이 과목에 올라온 PDF가 없습니다'); paint(); return; }
    // AI 가 적어 준 파일 이름과 가장 비슷한 것
    const want = norm(set.src_file);
    const score = (f) => {
      if (!want) return 0;
      const fn = norm(f.filename || ''); const n = norm(`${f.series || ''}${f.filename || ''}`);
      if (fn && (fn === want || n.includes(want) || want.includes(fn))) return 2;
      return [...want].filter((c) => n.includes(c)).length / want.length;
    };
    let file = files.slice().sort((a, b) => score(b) - score(a))[0];
    if (!want) file = files.find((f) => f.id === lastFile) || files.find((f) => f.range_id === range.id) || files[0];
    let doc = null; let pageNo = Math.max(1, set.src_page || 1); let rect = null; let view = null; let pageObj = null;
    const sel2 = h('select', { class: 'input sel oe-file' }, files.map((f) => h('option', { value: f.id, selected: f.id === file.id }, `${f.series || f.filename}${f.week ? ` ${f.week}주차` : ''}`)));
    const pgIn = h('input', { class: 'oe-pg', type: 'number', min: 1, value: pageNo });
    const pgN = h('span', { class: 'oe-pgn' });
    const canvas = h('canvas', { class: 'oe-pdf' });
    const band = h('i', { class: 'oe-crop', hidden: true });
    const holder = h('div', { class: 'oe-pdfbox' }, canvas, band);
    const scroller = h('div', { class: 'oe-pdfscroll' }, holder);
    const cutBtn = h('button', { class: 'btn ink sm', disabled: true, onclick: () => cut() }, icon('check', 'icon s'), '오리기');
    const bar = h('div', { class: 'oe-cbar' },
      h('button', { class: 'tool-ic', 'aria-label': '뒤로', title: '뒤로', onclick: () => cancel() }, icon('back')),
      sel2,
      h('div', { class: 'oe-pgs' },
        h('button', { class: 'tool-ic', 'aria-label': '이전 장', onclick: () => go(pageNo - 1) }, icon('back', 'icon s')),
        pgIn, pgN,
        h('button', { class: 'tool-ic', 'aria-label': '다음 장', onclick: () => go(pageNo + 1) }, icon('right', 'icon s'))),
      h('div', { class: 'sp' }),
      h('button', { class: 'btn ghost sm', onclick: () => { rect = { x: 0, y: 0, w: 1, h: 1 }; drawBand(); } }, '장 전체'),
      cutBtn);
    const tip = h('div', { class: 'oe-ctip' }, '그림 부분을 쭉 그어서 네모로 고르세요');
    const nextTip = h('div', { class: 'oe-ntip', hidden: true }, h('kbd', {}, 'Enter'), queue.length ? `오리고 다음 그림으로 (남은 ${queue.length}개)` : '오리기');
    stageWrap.replaceChildren(h('div', { class: 'oe-cropper' }, bar, scroller, tip, nextTip));
    cropper = { cancel, enter: () => { if (rect) cut(queue.length > 0); } };

    async function load() {
      holder.classList.add('ld');
      try {
        const L = await pdfjs();
        const data = await getPdf(file, null);
        doc = await L.getDocument({ data, isEvalSupported: false, isOffscreenCanvasSupported: false, maxImageSize: 4096 * 4096 }).promise;
        pgN.textContent = `/ ${doc.numPages}`;
        await go(Math.min(pageNo, doc.numPages));
      } catch (e) { toast(e.message || 'PDF를 열지 못했습니다'); holder.classList.remove('ld'); }
    }
    async function go(n) {
      if (!doc) return;
      n = Math.max(1, Math.min(doc.numPages, n | 0 || 1));
      pageNo = n; pgIn.value = n; rect = null; drawBand();
      holder.classList.add('ld');
      pageObj = await doc.getPage(n);
      const base = pageObj.getViewport({ scale: 1 });
      const W = Math.max(280, scroller.clientWidth - 32); const H = Math.max(280, scroller.clientHeight - 32);
      const sc = Math.min(W / base.width, H / base.height);
      view = pageObj.getViewport({ scale: sc });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(view.width * dpr); canvas.height = Math.round(view.height * dpr);
      canvas.style.width = `${view.width}px`; canvas.style.height = `${view.height}px`;
      holder.style.width = `${view.width}px`; holder.style.height = `${view.height}px`;
      await pageObj.render({ canvasContext: canvas.getContext('2d'), viewport: view, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      holder.classList.remove('ld');
    }
    pgIn.addEventListener('change', () => go(+pgIn.value));
    sel2.addEventListener('change', async () => { file = files.find((f) => f.id === sel2.value); doc?.destroy?.(); doc = null; pageNo = 1; await load(); });
    function drawBand() {
      cutBtn.disabled = !rect;
      band.hidden = !rect;
      if (rect) Object.assign(band.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` });
      tip.classList.toggle('off', !!rect);
      nextTip.hidden = !rect;
    }
    // 네모 고르기 (손가락 · 펜슬 · 마우스 하나)
    let st = null;
    holder.addEventListener('pointerdown', (e) => {
      if (st || !view) return;
      const r = holder.getBoundingClientRect();
      st = { id: e.pointerId, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
      holder.setPointerCapture(e.pointerId); e.preventDefault();
    });
    holder.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id) return;
      const r = holder.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width); const y = clamp((e.clientY - r.top) / r.height);
      rect = { x: Math.min(st.x, x), y: Math.min(st.y, y), w: Math.abs(x - st.x), h: Math.abs(y - st.y) };
      if (!st.raf) st.raf = requestAnimationFrame(() => { if (st) st.raf = 0; drawBand(); });
    });
    const up = (e) => { if (!st || e.pointerId !== st.id) return; if (st.raf) cancelAnimationFrame(st.raf); st = null; if (rect && (rect.w < 0.03 || rect.h < 0.03)) rect = null; drawBand(); };
    holder.addEventListener('pointerup', up); holder.addEventListener('pointercancel', up);

    // 고른 부분만 크게 다시 그려서 올리기
    let cutting = false;
    async function cut(goNext = false) {
      if (!rect || !pageObj || cutting) return;
      cutting = true;
      cutBtn.disabled = true;
      try {
        const base = pageObj.getViewport({ scale: 1 });
        const cw = rect.w * base.width; const ch = rect.h * base.height;
        const sc = Math.min(4, Math.max(1.5, MAXW / Math.max(cw, ch)));
        const vp = pageObj.getViewport({ scale: sc });
        const out = document.createElement('canvas');
        out.width = Math.round(cw * sc); out.height = Math.round(ch * sc);
        const c = out.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, out.width, out.height);
        await pageObj.render({ canvasContext: c, viewport: vp, transform: [1, 0, 0, 1, -rect.x * vp.width, -rect.y * vp.height] }).promise;
        const blob = await new Promise((ok) => out.toBlob(ok, 'image/png'));
        set.src_page = pageNo; usedFile = file.id;
        cropper = null; doc?.destroy?.();
        await putImage(blob);
        if (goNext && set.img) await save({ next: true });
      } catch (e) { toast(e.message || '오리지 못했습니다'); cutBtn.disabled = false; }
      cutting = false;
    }
    function cancel() { cropper = null; doc?.destroy?.(); paint(); }
    requestAnimationFrame(load);
  }

  // ── 테이프 붙이는 화면 ──
  let stage = null;
  function buildStage() {
    const img = h('img', { alt: '', draggable: 'false' });
    const layer = h('div', { class: 'oe-layer' });
    const canvasEl = h('div', { class: 'oe-stage' }, img, layer);
    const scroll = h('div', { class: 'oe-scroll' }, canvasEl);
    const zoomTxt = h('span', { class: 'oe-zt' }, '100%');
    const tools = h('div', { class: 'oe-ztools' },
      h('button', { class: 'tool-ic', 'aria-label': '축소', title: '축소', onclick: () => zoomTo(zoom / 1.3) }, icon('minus')),
      zoomTxt,
      h('button', { class: 'tool-ic', 'aria-label': '확대', title: '확대', onclick: () => zoomTo(zoom * 1.3) }, icon('plus')),
      h('i', { class: 'oe-zdiv' }),
      h('button', { class: 'tool-ic', 'aria-label': '그림 바꾸기', title: '그림 바꾸기', onclick: () => { stage.stop(); stageWrap.replaceChildren(sourcePicker()); } }, icon('image')));
    const box = h('div', { class: 'oe-stagewrap' }, scroll, tools);
    let ratio = set.img_w && set.img_h ? set.img_w / set.img_h : 1;
    let fitW = 0; let fitH = 0; let zoom = 1;
    const size = () => {
      const W = scroll.clientWidth - 24; const H = scroll.clientHeight - 24;
      if (W <= 0 || H <= 0) return;
      fitW = W; fitH = W / ratio; if (fitH > H) { fitH = H; fitW = H * ratio; }
      canvasEl.style.width = `${fitW * zoom}px`; canvasEl.style.height = `${fitH * zoom}px`;
      zoomTxt.textContent = `${Math.round(zoom * 100)}%`;
    };
    function zoomTo(z, cx, cy) {
      const r = scroll.getBoundingClientRect();
      const px = cx ?? r.left + r.width / 2; const py = cy ?? r.top + r.height / 2;
      const before = canvasEl.getBoundingClientRect();
      const fx = (px - before.left) / before.width; const fy = (py - before.top) / before.height;
      zoom = Math.max(1, Math.min(6, z));
      size();
      const after = canvasEl.getBoundingClientRect();
      scroll.scrollLeft += (after.left + fx * after.width) - px;
      scroll.scrollTop += (after.top + fy * after.height) - py;
    }
    const ro = new ResizeObserver(size); ro.observe(scroll);
    canvasEl.classList.add('ld');
    imgSrc(set.img).then((u) => {
      img.onload = () => { if (!set.img_w) { set.img_w = img.naturalWidth; set.img_h = img.naturalHeight; ratio = set.img_w / set.img_h; size(); } canvasEl.classList.remove('ld'); };
      img.src = u;
    }, () => { canvasEl.classList.remove('ld'); toast('그림을 불러오지 못했습니다'); });

    // 테이프 그리기
    function drawBoxes() {
      layer.replaceChildren(...set.boxes.map((b, i) => {
        const on = sel === b.id;
        const el = h('div', { class: 'oe-box' + (on ? ' on' : '') + (b.name ? '' : ' empty'), 'data-id': b.id, style: { left: pc(b.x), top: pc(b.y), width: pc(b.w), height: pc(b.h) } },
          h('span', { class: 'oe-bn' }, i + 1),
          set.kind === 'label' ? h('span', { class: 'oe-bl' }, b.name || '이름 없음') : null,
          ...(on ? ['nw', 'ne', 'sw', 'se'].map((c) => h('i', { class: `oe-hd ${c}`, 'data-h': c })) : []),
          on ? h('button', { class: 'oe-bx', 'aria-label': '테이프 지우기', onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); removeBox(b.id); } }, icon('x', 'icon s')) : null);
        return el;
      }));
    }
    // 손가락 · 펜슬 · 마우스
    const pts = new Map(); let act = null; let pinch = null; let penAt = 0;
    const rel = (e) => { const r = canvasEl.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    canvasEl.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'pen') penAt = Date.now();
      if (e.pointerType === 'touch' && Date.now() - penAt < 1500) return;   // 펜슬 쓰는 중 손바닥
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvasEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      if (pts.size === 2) {
        // 두 손가락 : 그리던 것 취소하고 확대 · 이동
        if (act?.kind === 'new') set.boxes = set.boxes.filter((b) => b !== act.box);
        else if (act?.orig) Object.assign(act.box, act.orig);
        act = null; drawBoxes();
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        return;
      }
      if (pts.size > 2) return;
      const [x, y] = rel(e);
      const hd = e.target.closest?.('.oe-hd');
      const be = e.target.closest?.('.oe-box');
      if (hd && sel) {
        const b = set.boxes.find((q) => q.id === sel);
        act = { kind: 'resize', box: b, h: hd.dataset.h, orig: { ...b } };
      } else if (be) {
        const b = set.boxes.find((q) => q.id === be.dataset.id);
        sel = b.id; if (b.name) pick = null;
        act = { kind: 'move', box: b, sx: x, sy: y, orig: { ...b }, moved: false };
        drawBoxes(); paintPanel();
      } else if (set.kind === 'label') {
        const b = { id: uuid(), x, y, w: 0, h: 0, name: '' };
        act = { kind: 'new', box: b, sx: x, sy: y };
        set.boxes.push(b);
      } else { sel = null; drawBoxes(); }
    });
    canvasEl.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      if (e.pointerType === 'mouse' && !e.buttons) { end(e); return; }   // 창 밖에서 버튼을 뗀 경우
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y); const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
        zoomTo(pinch.z * (d / pinch.d), mx, my);
        scroll.scrollLeft -= mx - pinch.mx; scroll.scrollTop -= my - pinch.my;
        pinch.mx = mx; pinch.my = my;
        return;
      }
      if (!act) return;
      const [x, y] = rel(e).map((v) => clamp(v));
      const b = act.box;
      if (act.kind === 'new') {
        b.x = Math.min(act.sx, x); b.y = Math.min(act.sy, y); b.w = Math.abs(x - act.sx); b.h = Math.abs(y - act.sy);
        sel = b.id;
      } else if (act.kind === 'move') {
        const dx = x - act.sx; const dy = y - act.sy;
        if (Math.abs(dx) + Math.abs(dy) > 0.004) act.moved = true;
        b.x = clamp(act.orig.x + dx, 0, 1 - b.w); b.y = clamp(act.orig.y + dy, 0, 1 - b.h);
      } else if (act.kind === 'resize') {
        const o = act.orig; let x1 = o.x; let y1 = o.y; let x2 = o.x + o.w; let y2 = o.y + o.h;
        if (act.h.includes('w')) x1 = Math.min(x, x2 - MIN); if (act.h.includes('e')) x2 = Math.max(x, x1 + MIN);
        if (act.h.includes('n')) y1 = Math.min(y, y2 - MIN); if (act.h.includes('s')) y2 = Math.max(y, y1 + MIN);
        Object.assign(b, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      }
      queueBox(b);
    });
    // 끌 때는 그 테이프 하나만 위치를 바꿈 (다시 그리면 깜빡이고 튀어 보임), 화면 한 번 그릴 때 한 번만
    let raf = 0; let pend = null;
    function queueBox(b) {
      pend = b; if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0; const q = pend; pend = null; if (!q) return;
        let el = layer.querySelector(`[data-id="${q.id}"]`);
        if (!el || (sel === q.id && !el.classList.contains('on'))) { drawBoxes(); el = layer.querySelector(`[data-id="${q.id}"]`); }
        if (el) Object.assign(el.style, { left: pc(q.x), top: pc(q.y), width: pc(q.w), height: pc(q.h) });
      });
    }
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pinch) { if (pts.size < 2) pinch = null; return; }
      if (!act) return;
      const a = act; act = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; pend = null; }
      if (a.kind === 'new') {
        if (a.box.w < MIN || a.box.h < MIN) { set.boxes = set.boxes.filter((b) => b !== a.box); sel = null; }
        else {
          // 다음 이름 자동으로
          a.box.name = pick || nextName() || '';
          pick = null; sel = a.box.id; mark();
        }
      } else if (a.kind === 'move' || a.kind === 'resize') { if (a.kind === 'resize' || a.moved) mark(); }
      drawBoxes(); paintPanel();
    };
    canvasEl.addEventListener('pointerup', end); canvasEl.addEventListener('pointercancel', end);
    // 트랙패드 · 마우스 휠 확대 (ctrl + 휠 = 핀치)
    scroll.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX, e.clientY); }, { passive: false });

    drawBoxes();
    box.draw = drawBoxes;
    box.stop = () => ro.disconnect();
    return box;
  }

  // ── 오른쪽(아래) 칸 ──
  const deckIn = h('input', { class: 'input', placeholder: '묶음', value: set.deck, list: 'oe-decks', spellcheck: 'false', oninput: () => { set.deck = deckIn.value.trim(); mark(); } });
  const deckList = h('datalist', { id: 'oe-decks' }, decks.map((d) => h('option', { value: d })));
  const hintIn = h('textarea', { class: 'input', rows: 2, placeholder: '없으면 비워 둡니다', spellcheck: 'false', oninput: () => { set.hint = hintIn.value; mark(); } }, set.hint || '');
  const wholeIn = h('input', { class: 'input', placeholder: '이 그림의 이름', value: set.kind === 'whole' ? (set.labels[0] || '') : '', spellcheck: 'false', oninput: () => { set.labels = wholeIn.value.trim() ? [wholeIn.value.trim()] : []; mark(); } });
  const addIn = h('input', { class: 'oe-addin', placeholder: '이름 추가', spellcheck: 'false', onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addName(); } } });
  const kindSeg = seg([['label', '이름 가리기'], ['whole', '그림 전체']], set.kind, (v) => {
    if (v === set.kind) return;
    set.kind = v; mark();
    if (v === 'whole') wholeIn.value = set.labels[0] || '';
    sel = null; paint();
  });
  const delBtn = s0 ? h('button', { class: 'btn sm danger oe-del', onclick: () => del() }, '그림 카드 지우기') : null;

  function nextName() {
    const used = new Set(set.boxes.map((b) => b.name).filter(Boolean));
    return set.labels.find((n) => !used.has(n)) || null;
  }
  function addName() {
    const v = addIn.value.trim(); if (!v) return;
    v.split(/\s*[|,\n]\s*/).filter(Boolean).forEach((n) => { if (!set.labels.includes(n)) set.labels.push(n); });
    addIn.value = ''; mark();
    // 골라 둔 테이프가 이름이 없으면 바로 붙임
    const b = set.boxes.find((q) => q.id === sel);
    if (b && !b.name) b.name = v.split(/\s*[|,\n]\s*/)[0];
    stage?.draw(); paintPanel();
  }
  function assign(name) {
    const b = set.boxes.find((q) => q.id === sel);
    if (!b) { pick = pick === name ? null : name; paintPanel(); return; }   // 테이프 안 고른 상태 : 다음 테이프 이름으로 예약
    b.name = name; mark();          // 같은 이름표가 그림에 두 번 있을 수 있어서 겹쳐도 됨
    // 이름이 비어 있는 다음 테이프로
    const nxt = set.boxes.find((q) => !q.name);
    sel = nxt ? nxt.id : sel;
    stage?.draw(); paintPanel();
  }
  function removeName(name) {
    set.labels = set.labels.filter((n) => n !== name);
    set.boxes.forEach((b) => { if (b.name === name) b.name = ''; });
    mark(); stage?.draw(); paintPanel();
  }
  function removeBox(id) {
    set.boxes = set.boxes.filter((b) => b.id !== id);
    if (sel === id) sel = null; mark();
    stage?.draw(); paintPanel();
  }

  function paintPanel() {
    const parts = [h('div', { class: 'oe-sec' }, kindSeg)];
    if (set.kind === 'label') {
      const used = new Map();
      set.boxes.forEach((b, i) => { if (b.name) used.set(b.name, [...(used.get(b.name) || []), i + 1]); });
      const names = [...set.labels, ...set.boxes.map((b) => b.name).filter((n) => n && !set.labels.includes(n))];
      const cur = set.boxes.find((b) => b.id === sel);
      const nx = cur ? null : (pick || nextName());
      const named = set.boxes.filter((b) => b.name).length;
      parts.push(h('div', { class: 'oe-sec' },
        h('div', { class: 'oe-lab' }, h('b', {}, '이름'), h('span', {}, `테이프 ${set.boxes.length}개${set.boxes.length ? `, 이름 ${named}개` : ''}`)),
        h('p', { class: 'oe-help' }, cur ? `${set.boxes.indexOf(cur) + 1}번 테이프에 붙일 이름을 누르세요` : nx ? `다음에 그리는 테이프는 ${nx}` : '이름 자리에 네모를 그리세요'),
        h('div', { class: 'oe-chips' }, names.map((n) => {
          const no = used.get(n);
          const on = cur ? cur.name === n : nx === n;
          return h('div', { class: 'oe-chip' + (no ? ' used' : '') + (on ? ' on' : '') },
            h('button', { class: 'oe-chip-b', onclick: () => assign(n) }, ...(no || []).map((k) => h('i', {}, k)), h('span', {}, n)),
            !no ? h('button', { class: 'oe-chip-x', 'aria-label': `${n} 빼기`, onclick: () => removeName(n) }, icon('x', 'icon s')) : null);
        }), h('label', { class: 'oe-chip oe-add' }, icon('plus', 'icon s'), addIn))));
    } else {
      parts.push(h('div', { class: 'oe-sec' }, h('div', { class: 'oe-lab' }, h('b', {}, '정답')), wholeIn));
    }
    parts.push(h('div', { class: 'oe-sec' }, h('div', { class: 'oe-lab' }, h('b', {}, '묶음')), deckIn, deckList),
      h('div', { class: 'oe-sec' }, h('div', { class: 'oe-lab' }, h('b', {}, '암기법')), hintIn));
    if (delBtn) parts.push(h('div', { class: 'oe-sec oe-foot' }, delBtn));
    panel.replaceChildren(...parts);
  }

  function paint() {
    stage?.stop(); stage = null;
    if (!set.img && startCrop) { startCrop = false; paintPanel(); openCropper(); return; }
    if (!set.img) stageWrap.replaceChildren(sourcePicker());
    else { stage = buildStage(); stageWrap.replaceChildren(stage); }
    paintPanel();
  }
  paint();

  // ── 저장 · 지우기 ──
  async function save({ next = false } = {}) {
    if (set.kind === 'label') {
      const empty = set.boxes.findIndex((b) => !b.name);
      if (empty >= 0) { sel = set.boxes[empty].id; stage?.draw(); paintPanel(); toast(`${empty + 1}번 테이프에 이름을 붙여 주세요`); shake(panel); return; }
    } else if (!set.labels[0]) { toast('그림의 이름(정답)을 적어 주세요'); shake(panel); wholeIn.focus(); return; }
    saveBtn.disabled = true;
    const row = { range_id: range.id, deck: set.deck || '', title: set.title.trim(), kind: set.kind, labels: set.labels, boxes: set.kind === 'label' ? set.boxes.map(({ id, x, y, w, h: hh, name }) => ({ id, x: r4(x), y: r4(y), w: r4(w), h: r4(hh), name })) : [],
      img: set.img, img_w: set.img_w, img_h: set.img_h, src_file: set.src_file || '', src_page: set.src_page || null, hint: (set.hint || '').trim(), updated_at: new Date().toISOString() };
    try {
      let r;
      if (set.id) r = await sb.from('occ_sets').update(row).eq('id', set.id).select().single();
      else {
        const { data: mx } = await sb.from('occ_sets').select('sort').eq('range_id', range.id).order('sort', { ascending: false }).limit(1);
        r = await sb.from('occ_sets').insert({ ...row, sort: (mx?.[0]?.sort ?? -1) + 1 }).select().single();
      }
      if (r.error) throw r.error;
      temp.delete(set.img);
      if (origImg && origImg !== set.img) dropImgs([origImg]);
      dirty = false;
      onSaved?.(r.data);
      close('saved');
      if (next && queue.length) {
        const [n, ...rest] = queue;
        toast(`다음 그림 : ${n.title || '그림'}`);
        setTimeout(() => openOccEditor({ sub, range, set: n, decks, onSaved, queue: rest, startCrop: true, lastFile: usedFile }), 280);
      } else toast(set.kind === 'label' && !set.img ? '저장했습니다. 그림을 넣으면 카드가 생깁니다' : next ? '그림을 모두 넣었습니다' : '저장했습니다');
    } catch (e) { toast(e.message || '저장하지 못했습니다'); saveBtn.disabled = false; }
  }
  let delArmed = 0;
  async function del() {
    if (Date.now() - delArmed > 2500) { delArmed = Date.now(); delBtn.textContent = '한 번 더 누르면 지웁니다'; delBtn.classList.add('armed'); setTimeout(() => { if (delBtn.isConnected) { delBtn.textContent = '그림 카드 지우기'; delBtn.classList.remove('armed'); } }, 2500); return; }
    try {
      const r = await sb.from('occ_sets').delete().eq('id', set.id);
      if (r.error) throw r.error;
      dropImgs([origImg, set.img]);
      dirty = false; toast('지웠습니다');
      onSaved?.(null, set.id);
      close(true);
    } catch (e) { toast(e.message || '지우지 못했습니다'); }
  }
}

const pc = (v) => `${v * 100}%`;
const r4 = (v) => Math.round(v * 10000) / 10000;
function clamp(v, a = 0, b = 1) { return Math.max(a, Math.min(b, v)); }
const norm = (s) => {
  let t = String(s || '').normalize('NFC').toLowerCase().replace(/\.pdf$/i, '');
  t = t.replace(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}[_\-\s]*/, '').replace(/^[0-9a-f]{6,}[_\-]/, '');   // 올릴 때 붙은 무작위 글자
  if (/\ufffd|[ÃÂ][\x80-\xbf]|[ì-ïê-ë][\x80-\xbf]/.test(t)) return '';   // 글자가 깨졌으면 이름으로 찾지 않음
  return t.replace(/[\s_\-.()[\]]/g, '');
};
const uuid = () => crypto.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
