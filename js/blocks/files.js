import { h, icon, toast, seg, modal, popover } from '../ui.js';
import { listFiles, addFile, replaceFile, deleteFile, myOldVersions, fmtSize } from '../data/files.js';
import { openPdf } from '../views/pdf-viewer.js';

// ─────────────────────────────────────────────
// 자료 (써머리 · 기타 학습자료) : 네이버 카페 대신
//  한 파일 갱신형 = 같은 자리에 새 파일로 교체
//  주차별형 = 같은 이름 아래 주차마다 쌓임
// ─────────────────────────────────────────────
const CAT = [['summary', '써머리'], ['etc', '기타 자료']];
const isNew = (t) => Date.now() - new Date(t).getTime() < 3 * 86400e3;
const md = (t) => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };

export function filesBlock(ctx, el) {
  let alive = true;
  let cat = localStorage.getItem('kmed:fcat') === 'etc' ? 'etc' : 'summary';
  let all = [];
  const open = new Set();
  const list = h('div', { class: 'fl' });
  const canWrite = !!ctx.canWrite;

  el.append(h('div', { class: 'q-bar' },
    seg(CAT, cat, (v) => { cat = v; try { localStorage.setItem('kmed:fcat', v); } catch { /* 무시 */ } draw(); }),
    h('div', { class: 'sp' }),
    canWrite ? h('button', { class: 'tool-pill', onclick: () => uploadModal({}) }, icon('plus', 'icon s'), h('span', {}, '올리기')) : null), list);

  async function load() {
    list.replaceChildren(...[0, 1, 2].map(() => h('i', { class: 'skel fl-sk' })));
    try { all = await listFiles(ctx.subject.id, ctx.range?.id); }
    catch { list.replaceChildren(h('div', { class: 'box-empty' }, '자료를 불러올 수 없습니다')); return; }
    if (alive) draw();
  }

  function draw() {
    const rows = all.filter((f) => f.category === cat);
    if (!rows.length) {
      list.replaceChildren(h('div', { class: 'fl-empty' },
        h('div', { class: 'emo' }, cat === 'summary' ? '📄' : '🗂️'),
        h('b', {}, '아직 올라온 자료가 없습니다'),
        canWrite ? h('button', { class: 'btn sm ink', onclick: () => uploadModal({}) }, icon('plus', 'icon s'), '올리기') : null));
      return;
    }
    // 묶기 : 한 파일 = 한 칸, 주차별 = 이름별로 한 칸
    const groups = [];
    rows.forEach((f) => {
      if (f.mode === 'single') groups.push({ type: 'single', f, t: f.updated_at });
      else {
        let g = groups.find((x) => x.type === 'weekly' && x.series === f.series);
        if (!g) { g = { type: 'weekly', series: f.series, items: [], t: f.updated_at }; groups.push(g); }
        g.items.push(f); if (f.updated_at > g.t) g.t = f.updated_at;
      }
    });
    groups.sort((a, b) => (a.t < b.t ? 1 : -1));
    list.replaceChildren(...groups.map((g, i) => (g.type === 'single' ? single(g.f, i) : weekly(g, i))));
  }

  const meta = (f) => h('div', { class: 'fl-meta' },
    h('span', {}, `${md(f.updated_at)} ${f.created_at === f.updated_at ? '올림' : '업데이트'}`),
    f.uploader_name ? h('span', {}, f.uploader_name) : null,
    h('span', {}, fmtSize(f.size)));

  function single(f, i) {
    return h('article', { class: 'fl-card', style: { animationDelay: `${i * 0.03}s` } },
      h('button', { class: 'fl-main', onclick: () => view(f) },
        h('span', { class: 'fl-ic' }, 'PDF'),
        h('span', { class: 'fl-tx' }, h('b', {}, f.series || f.filename, isNew(f.updated_at) ? h('em', {}, 'NEW') : null), meta(f))),
      canWrite ? more(f) : null);
  }

  function weekly(g, i) {
    const items = g.items.slice().sort((a, b) => (weekNo(b.week) - weekNo(a.week)) || (a.created_at < b.created_at ? 1 : -1));
    const isOpen = open.has(g.series) || i === 0;
    const body = h('div', { class: 'fl-weeks' }, items.map((f) => h('div', { class: 'fl-wk' },
      h('button', { class: 'fl-wk-main', onclick: () => view(f) },
        h('b', {}, f.week || '자료'), isNew(f.updated_at) ? h('em', {}, 'NEW') : null, meta(f)),
      canWrite ? more(f) : null)),
    canWrite ? h('button', { class: 'fl-add', onclick: () => uploadModal({ series: g.series, mode: 'weekly', week: nextWeek(items) }) }, icon('plus', 'icon s'), '주차 추가') : null);
    const card = h('article', { class: 'fl-card wk' + (isOpen ? ' open' : ''), style: { animationDelay: `${i * 0.03}s` } },
      h('button', { class: 'fl-main', onclick: () => { card.classList.toggle('open'); card.classList.contains('open') ? open.add(g.series) : open.delete(g.series); } },
        h('span', { class: 'fl-ic stack' }, 'PDF'),
        h('span', { class: 'fl-tx' }, h('b', {}, g.series, isNew(g.t) ? h('em', {}, 'NEW') : null),
          h('div', { class: 'fl-meta' }, h('span', {}, `${items.length}개 주차`), h('span', {}, `${md(g.t)} 업데이트`))),
        icon('down', 'icon fl-chev')),
      body);
    return card;
  }

  // 열기 (내가 필기한 이전 파일이 있으면 고르기)
  async function view(f) {
    const old = await myOldVersions(f).catch(() => []);
    if (!old.length) { openPdf(f); return; }
    const m = modal({ title: f.series || f.filename, body: h('div', { class: 'menu-list fl-ver' },
      h('button', { onclick: () => { m.close(); openPdf(f); } }, h('span', {}, '지금 파일'), h('small', {}, md(f.updated_at))),
      ...old.map((v) => h('button', { onclick: () => { m.close(); openPdf(f, { key: v.key, label: `이전 파일 ${md(v.created_at)}` }); } }, h('span', {}, '이전 파일 (내 필기)'), h('small', {}, md(v.created_at))))) });
  }

  // ⋯ 메뉴 : 새 파일로 바꾸기 · 지우기
  function more(f) {
    const b = h('button', { class: 'tool-ic sm fl-more', 'aria-label': '더보기', onclick: (e) => {
      e.stopPropagation();
      let armed = false;
      const del = h('button', { class: 'danger', onclick: async () => {
        if (!armed) { armed = true; del.firstChild.textContent = '한 번 더 누르면 지웁니다'; return; }
        b.pop?.close?.();
        try { await deleteFile(f); toast('지웠습니다'); all = all.filter((x) => x.id !== f.id); draw(); } catch (err) { toast(err.message); }
      } }, h('span', {}, '지우기'));
      const menu = h('div', { class: 'menu-list' },
        h('button', { onclick: () => { b.pop?.close?.(); pickFile((file) => doReplace(f, file)); } }, h('span', {}, '새 파일로 바꾸기')), del);
      b.pop = popover(b, menu, { align: 'right', width: 220 });
    } }, icon('more', 'icon s'));
    return b;
  }

  async function doReplace(f, file) {
    const t = progressToast('바꾸는 중');
    try { await replaceFile(f, file, t.set); t.done('새 파일로 바꿨습니다'); load(); }
    catch (e) { t.fail(e.message); }
  }

  // ── 올리기 창 ──
  function uploadModal(pre) {
    let c = cat; let mode = pre.mode || 'single'; let file = null;
    const series = h('input', { class: 'input', placeholder: '예) 본초학 써머리', value: pre.series || '', list: 'fl-series' });
    const names = h('datalist', { id: 'fl-series' }, [...new Set(all.filter((f) => f.mode === 'weekly').map((f) => f.series))].map((s) => h('option', { value: s })));
    const week = h('input', { class: 'input', placeholder: '예) 3주차', value: pre.week || '' });
    const weekRow = h('label', { class: 'fld' }, h('span', {}, '주차'), week);
    const modeDesc = h('p', { class: 'fl-desc' });
    const paintMode = () => {
      weekRow.hidden = mode !== 'weekly';
      if (mode === 'weekly' && !week.value) week.value = '1주차';
      modeDesc.textContent = mode === 'single' ? '매번 같은 자리에 새 파일로 바꿔 올립니다. 항상 최신 파일 하나만 보입니다.' : '같은 이름 아래 주차마다 파일이 따로 쌓입니다.';
    };
    const drop = h('label', { class: 'fl-drop' }, h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true, onchange: (e) => setFile(e.target.files[0]) }),
      icon('import'), h('b', {}, 'PDF 파일 고르기'), h('span', {}, '여기로 끌어다 놓아도 됩니다'));
    ['dragover', 'dragenter'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); setFile(e.dataTransfer.files[0]); });
    function setFile(f) {
      if (!f) return;
      if (!/\.pdf$/i.test(f.name)) { toast('PDF 파일만 올릴 수 있습니다'); return; }
      if (f.size > 100 * 1048576) { toast('한 파일은 100MB까지 올릴 수 있습니다'); return; }
      file = f;
      drop.classList.add('has');
      drop.replaceChildren(drop.firstChild, h('span', { class: 'fl-ic' }, 'PDF'), h('b', {}, f.name), h('span', {}, fmtSize(f.size)));
      if (!series.value.trim()) series.value = f.name.replace(/\.pdf$/i, '');
    }
    const bar = h('div', { class: 'fl-prog' }, h('i'));
    const go = h('button', { class: 'btn ink', onclick: submit }, '올리기');
    const m = modal({
      title: pre.series ? `${pre.series}에 주차 추가` : '자료 올리기',
      body: h('div', { class: 'form1 fl-form' },
        pre.series ? null : h('div', { class: 'fld' }, h('span', {}, '종류'), seg(CAT, c, (v) => { c = v; })),
        pre.series ? null : h('div', { class: 'fld' }, h('span', {}, '올리는 방식'), seg([['single', '한 파일 계속 바꾸기'], ['weekly', '주차별로 쌓기']], mode, (v) => { mode = v; paintMode(); }), modeDesc),
        pre.series ? null : h('label', { class: 'fld' }, h('span', {}, '이름'), series, names),
        weekRow, drop, bar),
      actions: [h('button', { class: 'btn ghost', onclick: () => m.close() }, '취소'), go],
    });
    paintMode();
    async function submit() {
      if (!file) { toast('파일을 골라 주세요'); return; }
      const name = (pre.series || series.value).trim();
      if (!name) { toast('이름을 적어 주세요'); return; }
      if (mode === 'weekly' && !week.value.trim()) { toast('주차를 적어 주세요'); return; }
      go.disabled = true; go.textContent = '올리는 중'; bar.classList.add('on');
      try {
        await addFile({ subject: ctx.subject, range: ctx.range, category: pre.series ? cat : c, mode, series: name, week: mode === 'weekly' ? week.value.trim() : '', file,
          onProgress: (p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; } });
        m.close(); toast('올렸습니다'); if (pre.series) open.add(name); else cat = c; load();
      } catch (e) { go.disabled = false; go.textContent = '올리기'; bar.classList.remove('on'); toast(e.message || '올리지 못했습니다'); }
    }
  }

  load();
  return () => { alive = false; };
}

function pickFile(cb) {
  const i = h('input', { type: 'file', accept: 'application/pdf,.pdf' });
  i.onchange = () => { const f = i.files[0]; if (!f) return; if (!/\.pdf$/i.test(f.name)) { toast('PDF 파일만 올릴 수 있습니다'); return; } cb(f); };
  i.click();
}
function weekNo(w) { const m = String(w || '').match(/\d+/); return m ? +m[0] : 0; }
function nextWeek(items) { const n = Math.max(0, ...items.map((f) => weekNo(f.week))); return n ? `${n + 1}주차` : ''; }

// 화면 아래 진행 표시
function progressToast(label) {
  const bar = h('i');
  const el = h('div', { class: 'fl-ptoast' }, h('span', {}, label), h('div', { class: 'fl-prog on' }, bar));
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('on'));
  const end = () => { el.classList.remove('on'); setTimeout(() => el.remove(), 300); };
  return { set: (p) => { bar.style.width = `${Math.round(p * 100)}%`; }, done: (m) => { end(); toast(m); }, fail: (m) => { end(); toast(m || '실패했습니다'); } };
}
