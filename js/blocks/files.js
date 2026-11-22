import { h, icon, toast, seg, modal, popover } from '../ui.js';
import { sb } from '../sb.js';
import { listFiles, addFile, replaceFile, deleteFile, myOldVersions, fmtSize, loadViews, markViewed } from '../data/files.js';
import { openPdf } from '../views/pdf-viewer.js';
import { openComments } from '../views/comments.js';
import { commentCounts } from '../data/comments.js';
import { loadFavs, isFav, toggleFav } from '../data/favs.js';

// ─────────────────────────────────────────────
// 자료 (써머리 · 기타 자료 한 목록) : 네이버 카페 대신
//  한 파일 갱신형 = 같은 이름 아래 파일들, 각 파일은 새 파일로 교체 가능
//  주차별형 = 같은 이름 아래 주차마다, 한 주차에 파일 여러 개 가능
// ─────────────────────────────────────────────
const CAT = [['summary', '써머리'], ['etc', '기타 자료']];
const md = (t) => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
const catOf = (f) => (f.category === 'etc' ? 'etc' : 'summary');
const fname = (f) => (f.filename || '').replace(/\.pdf$/i, '') || '파일';
const latest = (fs) => fs.reduce((t, f) => (f.updated_at > t ? f.updated_at : t), '');

export function filesBlock(ctx, el) {
  let alive = true;
  let all = [];
  let seen = new Map(); let counts = new Map(); let ccount = new Map();
  let q = '';
  // NEW : 안 본 파일(2주 안에 올라온 것) 또는 내가 본 뒤 바뀐 파일
  const isNew = (f) => (seen.has(f.id) ? seen.get(f.id) !== f.key : Date.now() - new Date(f.updated_at).getTime() < 14 * 86400e3);
  const anyNew = (fs) => fs.some(isNew);
  const open = new Set();
  const list = h('div', { class: 'fl' });
  const canWrite = !!ctx.canWrite;

  const sInp = h('input', { type: 'search', placeholder: '자료 검색', spellcheck: 'false' });
  // 검색 : 업로드 옆 동그란 버튼 → 누르면 옆으로 펼쳐짐
  const sClose = h('button', { class: 'fl-srch-x', 'aria-label': '검색 닫기', onclick: (e) => { e.preventDefault(); closeSearch(); } }, icon('x', 'icon s'));
  const search = h('div', { class: 'fl-srch' },
    h('button', { class: 'fl-srch-btn', 'aria-label': '자료 검색', title: '자료 검색', onclick: () => openSearch() }, icon('search', 'icon s')),
    sInp, sClose);
  const openSearch = () => { search.classList.add('on'); setTimeout(() => sInp.focus(), 60); };
  function closeSearch() { search.classList.remove('on'); if (sInp.value) { sInp.value = ''; q = ''; draw(); } sInp.blur(); }
  sInp.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });
  sInp.addEventListener('blur', () => { setTimeout(() => { if (!sInp.value && document.activeElement !== sInp) search.classList.remove('on'); }, 150); });
  const tools = h('div', { class: 'fl-tools' }, search);
  let st = 0;
  sInp.addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => { q = sInp.value.trim().toLowerCase().replace(/\s+/g, ''); draw(); sInp.focus(); }, 120); });
  el.append(list);
  const up = canWrite ? h('button', { class: 'tool-pill fl-up', onclick: () => uploadModal({}) }, icon('plus', 'icon s'), h('span', {}, '업로드')) : null;
  if (up) tools.append(up);
  const upBtn = () => tools;

  async function load() {
    list.replaceChildren(...[0, 1, 2].map(() => h('i', { class: 'skel fl-sk' })));
    try {
      all = await listFiles(ctx.subject.id, ctx.range?.id);
      const ids = all.map((f) => f.id);
      [{ mine: seen, counts }, ccount] = await Promise.all([
        loadViews(ids).catch(() => ({ mine: new Map(), counts: new Map() })),
        commentCounts(ids).catch(() => new Map()),
        loadFavs().catch(() => []),
      ]);
    }
    catch { list.replaceChildren(h('div', { class: 'box-empty' }, '자료를 불러올 수 없습니다')); return; }
    if (alive) draw();
    // 알림에서 넘어온 경우 : 댓글 바로 열기
    const cid = ctx.openComments; ctx.openComments = null;
    const cf = cid && all.find((f) => f.id === cid);
    if (cf) setTimeout(() => comments(cf), 300);
  }
  function comments(f) {
    openComments(f, { canMod: canWrite, onChange: (n) => { ccount.set(f.id, n); if (alive) draw(); } });
  }

  function draw() {
    if (!all.length) {
      list.replaceChildren(h('div', { class: 'fl-empty' },
        h('div', { class: 'emo' }, '📄'),
        h('b', {}, '아직 올라온 자료가 없습니다'),
        canWrite ? h('button', { class: 'btn sm ink', onclick: () => uploadModal({}) }, icon('plus', 'icon s'), '업로드') : null));
      return;
    }
    search.style.display = all.length >= 2 ? '' : 'none';
    // 검색 : 이름 · 파일 이름 · 주차 · 올린 사람
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
    const hit = (f) => !q || [f.series, f.filename, f.week, f.uploader_name].some((x) => norm(x).includes(q));
    const shown = q ? all.filter((f) => hit(f) || norm(f.series).includes(q)) : all;
    if (!shown.length) { list.replaceChildren(h('div', { class: 'fl-h' }, h('h3', {}, '검색'), tools), h('div', { class: 'fl-none' }, `'${sInp.value.trim()}' 자료가 없습니다`)); return; }
    // 묶기 : 같은 방식 · 종류 · 이름이면 한 칸
    const groups = [];
    shown.forEach((f) => {
      const key = `${f.mode}|${catOf(f)}|${f.series}`;
      let g = groups.find((x) => x.key === key);
      if (!g) { g = { key, mode: f.mode, category: catOf(f), series: f.series, items: [] }; groups.push(g); }
      g.items.push(f);
    });
    groups.forEach((g) => { g.t = latest(g.items); });
    groups.sort((a, b) => (a.t < b.t ? 1 : -1));
    // 써머리 → 기타 자료, 박스 밖 굵은 제목 아래 쭉
    let n = 0;
    list.replaceChildren(...CAT.flatMap(([k, label]) => {
      const gs = groups.filter((g) => g.category === k);
      if (!gs.length) return [];
      const first = n === 0;
      return [h('div', { class: 'fl-h' }, h('h3', {}, label, h('span', {}, gs.length)), first ? upBtn() : null),
        ...gs.map((g) => (g.mode === 'weekly' ? weekly(g, n++) : single(g, n++)))];
    }));
  }

  const meta = (f) => h('div', { class: 'fl-meta' },
    h('span', {}, `${md(f.updated_at)} ${f.created_at === f.updated_at ? '올림' : '업데이트'}`),
    f.uploader_name ? h('span', {}, f.uploader_name) : null,
    h('span', {}, fmtSize(f.size)),
    counts.get(f.id) ? h('span', { class: 'fl-views' }, icon('eye', 'icon s'), counts.get(f.id)) : null,
    h('span', { class: 'fl-fav' + (isFav(f.id) ? ' on' : ''), role: 'button', tabindex: 0, title: '즐겨찾기', 'aria-label': '즐겨찾기',
      onclick: async (e) => {
        e.stopPropagation(); const b = e.currentTarget;
        b.classList.toggle('on'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
        try { const on = await toggleFav(f, ctx.subject); b.classList.toggle('on', on); toast(on ? '홈에 즐겨찾기로 고정했습니다' : '즐겨찾기에서 뺐습니다'); }
        catch { b.classList.toggle('on'); toast('저장하지 못했습니다'); }
      } }, icon('star', 'icon s')),
    h('span', { class: 'fl-cm' + (ccount.get(f.id) ? ' has' : ''), role: 'button', tabindex: 0, title: '댓글',
      onclick: (e) => { e.stopPropagation(); comments(f); } }, icon('chat', 'icon s'), ccount.get(f.id) || '댓글'));

  // 파일 한 줄 (묶음 안)
  const fileRow = (f, scope) => h('div', { class: 'fl-wk fl-file' },
    h('button', { class: 'fl-wk-main', onclick: () => view(f) },
      h('span', { class: 'fl-dot' }, 'PDF'), h('b', {}, fname(f)), isNew(f) ? h('em', {}, 'NEW') : null, meta(f)),
    canWrite ? more(f, scope) : null);

  // 한 파일 갱신형 : 파일 하나면 바로 열기, 여러 개면 펼쳐서
  function single(g, i) {
    const f0 = g.items[0];
    const head = (extra) => h('span', { class: 'fl-tx' }, h('b', {}, h('span', { class: 'fl-name' }, g.series || fname(f0)), anyNew(g.items) ? h('em', {}, 'NEW') : null), extra);
    if (g.items.length === 1) {
      return h('article', { class: 'fl-card', style: { animationDelay: `${i * 0.03}s` } },
        h('button', { class: 'fl-main', onclick: () => view(f0) }, h('span', { class: 'fl-ic' }, 'PDF'), head(meta(f0))),
        canWrite ? more(f0, { group: g }) : null);
    }
    const files = g.items.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    return foldCard(g, i, head(h('div', { class: 'fl-meta' }, h('span', {}, `${files.length}개 파일`), h('span', {}, `${md(g.t)} 업데이트`))),
      files.map((f) => fileRow(f, { group: g })),
      canWrite ? h('button', { class: 'fl-add', onclick: () => uploadModal({ series: g.series, category: g.category, mode: 'single', fixed: true }) }, icon('plus', 'icon s'), '파일 추가') : null);
  }

  // 주차별형 : 주차 숫자 순, 한 주차에 파일 여러 개
  function weekly(g, i) {
    const weeks = [];
    g.items.forEach((f) => { let w = weeks.find((x) => x.week === f.week); if (!w) { w = { week: f.week, files: [] }; weeks.push(w); } w.files.push(f); });
    weeks.forEach((w) => w.files.sort((a, b) => (a.created_at < b.created_at ? -1 : 1)));
    weeks.sort((a, b) => (weekNo(a.week) || 1e6) - (weekNo(b.week) || 1e6) || (a.files[0].created_at < b.files[0].created_at ? -1 : 1));
    const rows = weeks.flatMap((w) => {
      const scope = { group: g, week: w };
      if (w.files.length === 1) {
        const f = w.files[0];
        return [h('div', { class: 'fl-wk' },
          h('button', { class: 'fl-wk-main', onclick: () => view(f) }, h('b', {}, w.week || '자료'), isNew(f) ? h('em', {}, 'NEW') : null, meta(f)),
          canWrite ? more(f, scope) : null)];
      }
      return [h('div', { class: 'fl-wk fl-wk-h' },
        h('div', { class: 'fl-wk-main' }, h('b', {}, w.week || '자료'), anyNew(w.files) ? h('em', {}, 'NEW') : null,
          h('div', { class: 'fl-meta' }, h('span', {}, `${w.files.length}개 파일`))),
        canWrite ? h('button', { class: 'tool-ic sm fl-more', 'aria-label': '이 주차에 파일 추가', title: '이 주차에 파일 추가', onclick: () => uploadModal({ series: g.series, category: g.category, mode: 'weekly', week: w.week, fixed: true }) }, icon('plus', 'icon s')) : null),
      ...w.files.map((f) => fileRow(f, scope))];
    });
    return foldCard(g, i, h('span', { class: 'fl-tx' }, h('b', {}, h('span', { class: 'fl-name' }, g.series), anyNew(g.items) ? h('em', {}, 'NEW') : null),
      h('div', { class: 'fl-meta' }, h('span', {}, `${weeks.length}개 주차`), h('span', {}, `${md(g.t)} 업데이트`))),
    rows,
    canWrite ? h('button', { class: 'fl-add', onclick: () => uploadModal({ series: g.series, category: g.category, mode: 'weekly', week: nextWeek(weeks) }) }, icon('plus', 'icon s'), '주차 추가') : null);
  }

  // 펼치는 카드
  function foldCard(g, i, head, rows, addBtn) {
    const isOpen = open.has(g.key) || i === 0 || !!q;
    const card = h('article', { class: 'fl-card wk' + (isOpen ? ' open' : ''), style: { animationDelay: `${i * 0.03}s` } },
      h('button', { class: 'fl-main', onclick: () => { card.classList.toggle('open'); card.classList.contains('open') ? open.add(g.key) : open.delete(g.key); } },
        h('span', { class: 'fl-ic stack' }, 'PDF'), head, icon('down', 'icon fl-chev')),
      canWrite ? h('button', { class: 'tool-ic sm fl-more fl-more-g', 'aria-label': '수정하기', title: '수정하기', onclick: (e) => { e.stopPropagation(); editModal({ ids: g.items.map((x) => x.id), series: g.series, category: g.category, count: g.items.length }); } }, icon('pen', 'icon s')) : null,
      h('div', { class: 'fl-weeks' }, rows, addBtn));
    return card;
  }

  // 열기 (내가 필기한 이전 파일이 있으면 고르기)
  async function view(f) {
    // 읽음 표시 (NEW 지우기 · 조회 수)
    if (seen.get(f.id) !== f.key) {
      if (!seen.has(f.id)) counts.set(f.id, (counts.get(f.id) || 0) + 1);
      seen.set(f.id, f.key); markViewed(f);
      setTimeout(() => { if (alive) draw(); }, 400);
    }
    const old = await myOldVersions(f).catch(() => []);
    if (!old.length) { openPdf(f, { onComments: () => comments(f) }); return; }
    const m = modal({ title: f.series || fname(f), body: h('div', { class: 'menu-list fl-ver' },
      h('button', { onclick: () => { m.close(); openPdf(f, { onComments: () => comments(f) }); } }, h('span', {}, '지금 파일'), h('small', {}, md(f.updated_at))),
      ...old.map((v) => h('button', { onclick: () => { m.close(); openPdf(f, { key: v.key, label: `이전 파일 ${md(v.created_at)}`, onComments: () => comments(f) }); } }, h('span', {}, '이전 파일 (내 필기)'), h('small', {}, md(v.created_at))))) });
  }

  // ⋯ 메뉴 : 수정하기 · 파일 추가 · 새 파일로 바꾸기 · 지우기
  function more(f, { group, week }) {
    const b = h('button', { class: 'tool-ic sm fl-more', 'aria-label': '더보기', onclick: (e) => {
      e.stopPropagation();
      let armed = false;
      const del = h('button', { class: 'danger', onclick: async () => {
        if (!armed) { armed = true; del.firstChild.textContent = '한 번 더 누르면 지웁니다'; return; }
        b.pop?.close?.();
        try { await deleteFile(f); toast('지웠습니다'); all = all.filter((x) => x.id !== f.id); draw(); } catch (err) { toast(err.message); }
      } }, h('span', {}, '지우기'));
      const close = () => b.pop?.close?.();
      const edit = week
        ? () => editModal({ ids: week.files.map((x) => x.id), week: week.week, count: week.files.length })
        : () => editModal({ ids: group.items.map((x) => x.id), series: group.series, category: group.category, count: group.items.length });
      const add = week
        ? () => uploadModal({ series: group.series, category: group.category, mode: 'weekly', week: week.week, fixed: true })
        : () => uploadModal({ series: group.series, category: group.category, mode: 'single', fixed: true });
      const menu = h('div', { class: 'menu-list' },
        h('button', { onclick: () => { close(); edit(); } }, h('span', {}, '수정하기')),
        h('button', { onclick: () => { close(); add(); } }, h('span', {}, week ? '이 주차에 파일 추가' : '파일 추가')),
        h('button', { onclick: () => { close(); pickFile((file) => doReplace(f, file)); } }, h('span', {}, '새 파일로 바꾸기')), del);
      b.pop = popover(b, menu, { align: 'right', width: 220 });
    } }, icon('more', 'icon s'));
    return b;
  }

  async function doReplace(f, file) {
    const t = progressToast('바꾸는 중');
    try { await replaceFile(f, file, t.set); t.done('새 파일로 바꿨습니다'); load(); }
    catch (e) { t.fail(e.message); }
  }

  // ── 수정하기 : 이름 · 종류 (묶음 전체) 또는 주차 이름 ──
  function editModal({ ids, series, category, week, count }) {
    const isWeek = week !== undefined;
    let c = category === 'etc' ? 'etc' : 'summary';
    const name = h('input', { class: 'input', value: isWeek ? week : series });
    const m = modal({
      title: '수정하기',
      body: h('div', { class: 'form1 fl-form' },
        h('label', { class: 'fld' }, h('span', {}, isWeek ? '주차' : '이름'), name),
        isWeek ? null : h('div', { class: 'fld' }, h('span', {}, '종류'), seg(CAT, c, (v) => { c = v; })),
        count > 1 ? h('p', { class: 'fl-desc' }, `안에 있는 파일 ${count}개가 모두 함께 바뀝니다.`) : null),
      actions: [h('button', { class: 'btn ghost', onclick: () => m.close() }, '취소'), h('button', { class: 'btn ink', onclick: save }, '저장')],
    });
    setTimeout(() => name.focus(), 60);
    async function save() {
      const v = name.value.trim(); if (!v) { toast(isWeek ? '주차를 적어 주세요' : '이름을 적어 주세요'); return; }
      const patch = isWeek ? { week: v } : { series: v, category: c };
      const { error } = await sb.from('files').update(patch).in('id', ids);
      if (error) { toast('바꾸지 못했습니다'); return; }
      all = all.map((x) => (ids.includes(x.id) ? { ...x, ...patch } : x));
      m.close(); toast('수정했습니다'); draw();
    }
  }

  // ── 업로드 창 (여러 파일 한 번에) ──
  function uploadModal(pre) {
    const mode0 = pre.mode || 'single';
    let mode = mode0; let c = pre.category || 'summary';
    let files = [];
    const fixed = !!pre.fixed;           // 이미 있는 이름 · 주차에 파일 추가
    const sameSeries = !!pre.series;     // 이미 있는 이름 아래
    const series = h('input', { class: 'input', placeholder: '예) 본초학 써머리', value: pre.series || '' });
    const week = h('input', { class: 'input', placeholder: '예) 3주차', value: pre.week || '' });
    const weekRow = h('label', { class: 'fld' }, h('span', {}, '주차'), week);
    const modeDesc = h('p', { class: 'fl-desc' });
    const paintMode = () => {
      weekRow.hidden = mode !== 'weekly' || fixed;
      if (mode === 'weekly' && !week.value) week.value = '1주차';
      modeDesc.textContent = mode === 'single' ? '이름 하나 아래 파일을 두고, 필요할 때 새 파일로 바꿉니다.' : '같은 이름 아래 주차마다 따로 쌓입니다.';
    };
    const input = h('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true, onchange: (e) => addFiles(e.target.files) });
    const drop = h('label', { class: 'fl-drop' }, input);
    const paintDrop = () => {
      drop.classList.toggle('has', files.length > 0);
      drop.replaceChildren(input, ...(files.length
        ? [h('div', { class: 'fl-picked' }, files.map((f, i) => h('div', { class: 'fl-pk' }, h('span', { class: 'fl-dot' }, 'PDF'), h('b', {}, f.name), h('small', {}, fmtSize(f.size)),
          h('button', { type: 'button', class: 'tool-ic sm', 'aria-label': '빼기', onclick: (e) => { e.preventDefault(); files.splice(i, 1); paintDrop(); } }, icon('x', 'icon s'))))),
        h('span', { class: 'fl-more-pick' }, icon('plus', 'icon s'), '파일 더 고르기')]
        : [icon('import'), h('b', {}, 'PDF 파일 고르기'), h('span', {}, '여러 개를 한 번에 골라도 됩니다')]));
    };
    ['dragover', 'dragenter'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); });
    function addFiles(fl) {
      [...(fl || [])].forEach((f) => {
        if (!/\.pdf$/i.test(f.name)) { toast('PDF 파일만 올릴 수 있습니다'); return; }
        if (f.size > 100 * 1048576) { toast(`${f.name} : 한 파일은 100MB까지입니다`); return; }
        if (!files.some((x) => x.name === f.name && x.size === f.size)) files.push(f);
      });
      input.value = '';
      if (files[0] && !series.value.trim()) series.value = files[0].name.replace(/\.pdf$/i, '');
      const wk = files[0] && weekFromName(files[0].name);
      if (wk && mode === 'weekly' && !fixed && (!week.value || week.value === '1주차' || week.value === pre.week)) week.value = wk;
      paintDrop();
    }
    const bar = h('div', { class: 'fl-prog' }, h('i'));
    const go = h('button', { class: 'btn ink', onclick: submit }, '업로드');
    const title = fixed ? (mode0 === 'weekly' ? `${pre.series} ${pre.week}에 파일 추가` : `${pre.series}에 파일 추가`) : sameSeries ? `${pre.series}에 주차 추가` : '자료 업로드';
    const m = modal({
      title,
      body: h('div', { class: 'form1 fl-form' },
        sameSeries ? null : h('div', { class: 'fld' }, h('span', {}, '종류'), seg(CAT, c, (v) => { c = v; })),
        sameSeries ? null : h('div', { class: 'fld' }, h('span', {}, '올리는 방식'), seg([['single', '한 파일 계속 바꾸기'], ['weekly', '주차별로 쌓기']], mode, (v) => { mode = v; paintMode(); }), modeDesc),
        sameSeries ? null : h('label', { class: 'fld' }, h('span', {}, '이름'), series),
        weekRow, drop, bar),
      actions: [h('button', { class: 'btn ghost', onclick: () => m.close() }, '취소'), go],
    });
    paintMode(); paintDrop();
    async function submit() {
      if (!files.length) { toast('파일을 골라 주세요'); return; }
      const name = (pre.series || series.value).trim();
      if (!name) { toast('이름을 적어 주세요'); return; }
      if (mode === 'weekly' && !week.value.trim()) { toast('주차를 적어 주세요'); return; }
      go.disabled = true; bar.classList.add('on');
      let done = 0;
      try {
        for (const file of files) {
          go.textContent = files.length > 1 ? `업로드 중 ${done + 1}/${files.length}` : '업로드 중';
          await addFile({ subject: ctx.subject, range: ctx.range, category: c, mode, series: name, week: mode === 'weekly' ? week.value.trim() : '', file,
            onProgress: (p) => { bar.firstChild.style.width = `${Math.round(((done + p) / files.length) * 100)}%`; } });
          done++;
        }
        m.close(); toast(files.length > 1 ? `${files.length}개 업로드했습니다` : '업로드했습니다');
        open.add(`${mode}|${c}|${name}`); load();
      } catch (e) {
        go.disabled = false; go.textContent = '업로드'; bar.classList.remove('on');
        files = files.slice(done); paintDrop();
        toast(e.message || '업로드하지 못했습니다'); if (done) load();
      }
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
// 파일 이름 속 주차 : '3주차', '3주', 'week3', 'W3'
function weekFromName(n) { const m = String(n).match(/(\d{1,2})\s*주(차)?|week\s*(\d{1,2})|(?:^|[^a-z])w(\d{1,2})(?!\d)/i); const v = m && (m[1] || m[3] || m[4]); return v ? `${+v}주차` : ''; }
function weekNo(w) { const m = String(w || '').match(/\d+/); return m ? +m[0] : 0; }
function nextWeek(weeks) { const n = Math.max(0, ...weeks.map((w) => weekNo(w.week))); return n ? `${n + 1}주차` : ''; }

// 화면 아래 진행 표시
function progressToast(label) {
  const bar = h('i');
  const el = h('div', { class: 'fl-ptoast' }, h('span', {}, label), h('div', { class: 'fl-prog on' }, bar));
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('on'));
  const end = () => { el.classList.remove('on'); setTimeout(() => el.remove(), 300); };
  return { set: (p) => { bar.style.width = `${Math.round(p * 100)}%`; }, done: (m) => { end(); toast(m); }, fail: (m) => { end(); toast(m || '실패했습니다'); } };
}
