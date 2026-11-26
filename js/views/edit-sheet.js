import { sb } from '../sb.js';
import { h, icon, toast, shake, skelRows } from '../ui.js';
import { fetchAll, resetCaches, resetHints } from '../data/hanja.js';
import { resetStudyCaches } from '../data/study.js';
import { uploadImg, dropImgs, imgEl, zoomImg } from '../data/images.js';
import { openOccEditor } from './occ-edit.js';

// ─────────────────────────────────────────────
// 데이터 고치기 (담당 · 관리자)
//  종류 고르기 → 검색 → 항목 눌러서 바로 고치기 (암기법 포함)
// ─────────────────────────────────────────────
const KINDS = [
  ['flash', '플래시카드', ['flash']],
  ['occ', '그림 카드', ['flash']],
  ['hanja', '한자', ['hanja_r', 'hanja_h', 'hanja_grid']],
  ['jung', '정한문 해석', ['jung_translate']],
  ['um', '엄한문 문장', ['um_order', 'um_answers']],
];
export const editKindOf = (block) => KINDS.find((k) => k[2].includes(block))?.[0] || null;
export const editKinds = (blocks) => KINDS.filter((k) => k[2].some((b) => blocks.includes(b)));

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
const ok = (r) => { if (r.error) throw r.error; return r.data; };

export function openEditSheet({ sub, range, pool, kind: k0, query = '', onDone }) {
  const kinds = editKinds((sub.blocks || []).map((b) => b.kind));
  if (!kinds.length) { toast('편집할 데이터가 없습니다'); return; }
  let kind = kinds.find((k) => k[0] === k0)?.[0] || kinds[0][0];
  let items = []; let units = new Map(); let hints = new Map();
  let shown = 60; let openId = null; let changed = false;
  const temp = new Set();   // 올렸지만 아직 저장 안 한 사진 (닫을 때 정리)
  let deckNames = [];

  const search = h('input', { class: 'es-q', type: 'search', placeholder: '검색', value: query, spellcheck: 'false' });
  const count = h('span', { class: 'es-cnt' });
  const addBtn = h('button', { class: 'btn sm ghost es-add', onclick: () => (kind === 'occ' ? openOcc(null) : addFlash()) }, icon('plus', 'icon s'), h('span', {}, '카드 추가'));
  // 이 범위의 지금 종류 데이터 전부 지우기 (두 번 눌러야 지워짐)
  let wipeArmed = 0; let wipeT = 0;
  const wipeBtn = h('button', { class: 'tool-ic es-wipe', title: '전부 지우기', 'aria-label': '전부 지우기', onclick: () => wipe() }, icon('trash', 'icon s'));
  async function wipe() {
    const n = kind === 'jung' ? items.reduce((a, x) => a + x.lines.length, 0) : items.length;
    if (!n) { toast('지울 데이터가 없습니다'); return; }
    const name = KINDS.find((k) => k[0] === kind)[1];
    if (Date.now() - wipeArmed > 3000) {
      wipeArmed = Date.now(); wipeBtn.classList.add('armed');
      toast(`한 번 더 누르면 ${range.name} ${name} ${n}개를 모두 지웁니다`);
      clearTimeout(wipeT); wipeT = setTimeout(() => wipeBtn.classList.remove('armed'), 3000);
      return;
    }
    wipeArmed = 0; wipeBtn.classList.remove('armed'); wipeBtn.disabled = true;
    try {
      const rid = range.id;
      if (kind === 'flash') {
        const keys = items.flatMap((x) => [x.front_img, x.back_img]).filter(Boolean);
        ok(await sb.from('flash_cards').delete().eq('range_id', rid));
        if (keys.length) dropImgs(keys);
      } else if (kind === 'occ') {
        const keys = items.map((x) => x.img).filter(Boolean);
        ok(await sb.from('occ_sets').delete().eq('range_id', rid));
        if (keys.length) dropImgs(keys);
      } else if (kind === 'hanja') {
        ok(await sb.from('hanja_cards').delete().eq('range_id', rid));
        ok(await sb.from('hanja_units').delete().eq('range_id', rid));
      } else if (kind === 'jung') ok(await sb.from('jung_lines').delete().eq('range_id', rid));
      else if (kind === 'um') ok(await sb.from('um_sentences').delete().eq('range_id', rid));
      changed = true; resetStudyCaches(); resetCaches?.();
      toast(`${name} ${n}개를 지웠습니다`);
      load();
    } catch (e) { toast(e.message || '지우지 못했습니다'); }
    wipeBtn.disabled = false;
  }
  const tabs = h('div', { class: 'es-kinds' });
  const list = h('div', { class: 'es-list' });
  const sheet = h('div', { class: 'ds es', role: 'dialog', 'aria-modal': 'true' },
    h('header', { class: 'ds-head' },
      h('div', { class: 'ds-ttl' }, h('span', { class: 'emo' }, sub.icon || ''), h('div', {}, h('h2', {}, '데이터 편집'), h('span', {}, `${sub.name} ${range.name}`))),
      h('button', { class: 'ib', 'aria-label': '닫기', onclick: close }, icon('x'))),
    h('div', { class: 'es-bar' }, tabs,
      h('div', { class: 'es-row' }, h('label', { class: 'es-search' }, icon('search', 'icon s'), search), count, addBtn, wipeBtn)),
    h('div', { class: 'ds-body' }, list));
  const wrap = h('div', { class: 'ds-wrap', onclick: (e) => { if (e.target === wrap) close(); } }, sheet);
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('on'));
  const onKey = (e) => { if (e.key === 'Escape' && !document.activeElement?.closest?.('.es-ed')) close(); };
  document.addEventListener('keydown', onKey);
  function close() {
    wrap.classList.remove('on'); document.removeEventListener('keydown', onKey);
    setTimeout(() => wrap.remove(), 320);
    if (temp.size) dropImgs([...temp]);
    if (changed) { resetCaches(); resetHints(); resetStudyCaches(); onDone?.(); }
  }

  let qt = 0;
  search.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { shown = 60; paint(); }, 120); });

  function paintTabs() {
    tabs.replaceChildren(...(kinds.length > 1 ? kinds.map(([v, label]) => h('button', { class: 'es-k' + (v === kind ? ' on' : ''), onclick: () => { if (kind === v) return; kind = v; openId = null; shown = 60; load(); } }, label)) : []));
    addBtn.style.display = kind === 'flash' || kind === 'occ' ? '' : 'none';
    addBtn.lastChild.textContent = kind === 'occ' ? '그림 추가' : '카드 추가';
  }

  async function load() {
    paintTabs();
    list.replaceChildren(skelRows(6, 58));
    count.textContent = '';
    try {
      const rid = range.id;
      if (kind === 'flash') {
        items = await fetchAll(() => sb.from('flash_cards').select('*').eq('range_id', rid).order('sort'));
      } else if (kind === 'occ') {
        const [sets, fl] = await Promise.all([
          fetchAll(() => sb.from('occ_sets').select('*').eq('range_id', rid).order('sort')).catch(() => { throw new Error('그림 카드를 쓰려면 22 SQL을 먼저 실행해야 합니다'); }),
          fetchAll(() => sb.from('flash_cards').select('deck').eq('range_id', rid).order('sort')).catch(() => []),
        ]);
        items = sets;
        deckNames = [...new Set([...fl.map((x) => x.deck), ...sets.map((x) => x.deck)].filter(Boolean))];
      } else if (kind === 'hanja') {
        const [cards, us, hs] = await Promise.all([
          fetchAll(() => sb.from('hanja_cards').select('*').eq('range_id', rid).order('sort')),
          sb.from('hanja_units').select('id,code,label').eq('range_id', rid),
          fetchAll(() => sb.from('hanja_hints').select('ch,hint').eq('pool', pool).order('ch')),
        ]);
        units = new Map((us.data || []).map((u) => [u.id, u]));
        hints = new Map(hs.map((x) => [x.ch, x.hint]));
        items = cards;
      } else if (kind === 'jung') {
        const rows = await fetchAll(() => sb.from('jung_lines').select('*').eq('range_id', rid).order('sort'));
        items = []; let cur = null;
        for (const r of rows) {
          if (!cur || r.page !== cur.page) { cur = { id: r.id, page: r.page, lines: [] }; items.push(cur); }
          cur.lines.push(r);
        }
      } else if (kind === 'um') {
        const [rows, us] = await Promise.all([
          fetchAll(() => sb.from('um_sentences').select('*').eq('range_id', rid).order('sort')),
          sb.from('hanja_units').select('id,code,label').eq('range_id', rid),
        ]);
        units = new Map((us.data || []).map((u) => [u.id, u]));
        items = rows;
      }
      paint();
      if (query && filtered().length === 1) { openId = filtered()[0].id; paint(); }
    } catch (e) {
      list.replaceChildren(h('div', { class: 'rp-empty' }, e.message || '불러오지 못했습니다'));
    }
  }

  // 검색 글자
  const hay = (it) => {
    if (kind === 'flash') return [it.deck, it.front, it.back, it.hint].join(' ');
    if (kind === 'occ') return [it.deck, it.title, ...(it.labels || []), ...(it.boxes || []).map((b) => b.name)].join(' ');
    if (kind === 'hanja') return [it.ch, it.reading, hints.get(it.ch), units.get(it.unit_id)?.label].join(' ');
    if (kind === 'jung') return [it.page, ...it.lines.flatMap((l) => [l.hanja, l.eum, l.translation, l.hint, ...(l.notes || [])])].join(' ');
    return [it.sentence, it.translation, it.source, it.hint, units.get(it.unit_id)?.label].join(' ');
  };
  const filtered = () => { const q = norm(search.value); return q ? items.filter((it) => norm(hay(it)).includes(q)) : items; };

  function paint() {
    const rows = filtered();
    count.textContent = search.value.trim() ? `${rows.length} / ${items.length}` : `${items.length}개`;
    if (!rows.length) { list.replaceChildren(h('div', { class: 'rp-empty' }, items.length ? '찾는 항목이 없습니다' : '아직 데이터가 없습니다')); return; }
    const els = rows.slice(0, shown).map((it, i) => row(it, i));
    if (rows.length > shown) els.push(h('button', { class: 'es-more', onclick: () => { shown += 100; paint(); } }, `${rows.length - shown}개 더 보기`));
    list.replaceChildren(...els);
  }

  // 목록 한 줄
  function row(it, i) {
    const open = openId === it.id;
    let main; let sub2; let hasHint = false;
    if (kind === 'flash') { main = it.front || '사진'; sub2 = it.back || (it.back_img ? '사진' : ''); hasHint = !!it.hint; }
    else if (kind === 'hanja') { main = h('span', { class: 'es-ch' }, it.ch); sub2 = [it.reading, units.get(it.unit_id)?.label].filter(Boolean).join('   '); hasHint = !!hints.get(it.ch); }
    else if (kind === 'jung') { main = it.lines.map((l) => l.hanja).join(' '); sub2 = it.page ? `${it.page}쪽, ${it.lines.length}줄` : `${it.lines.length}줄`; hasHint = it.lines.some((l) => l.hint); }
    else { main = it.sentence; sub2 = it.translation; hasHint = !!it.hint; }
    const head = h('button', { class: 'es-h', onclick: () => { openId = open ? null : it.id; paint(); } },
      kind === 'flash' && it.deck ? h('span', { class: 'es-deck', title: it.deck.replace(/ > /g, ' › ') }, it.deck.split(' > ').pop()) : null,
      h('span', { class: 'es-tx' }, h('span', { class: 'es-m' }, main), sub2 ? h('span', { class: 'es-s' }, sub2) : null),
      kind === 'flash' && (it.front_img || it.back_img) ? h('span', { class: 'es-hint es-picon', title: '사진 있음' }, icon('image', 'icon s')) : null,
      hasHint ? h('span', { class: 'es-hint', title: '암기법 있음' }, icon('bulb', 'icon s')) : null,
      h('span', { class: 'es-chev' }, icon('down', 'icon s')));
    if (kind === 'occ') return occRow(it, i);
    const el = h('div', { class: 'es-i' + (open ? ' open' : ''), style: { animationDelay: `${Math.min(i, 12) * 0.02}s` } }, head);
    if (open) el.append(editor(it));
    return el;
  }

  // 그림 카드 한 줄 : 누르면 만들기 화면
  function occRow(it, i) {
    const nb = (it.boxes || []).length;
    const miss = it.kind === 'label' && (it.boxes || []).some((b) => !b.name);
    const st = !it.img ? ['bad', '그림 넣기 필요'] : it.kind === 'whole' ? ['', '그림 전체'] : !nb ? ['bad', '테이프 필요'] : miss ? ['bad', '이름 필요'] : ['', `${nb}장`];
    const names = it.kind === 'whole' ? (it.labels || [])[0] || '' : (nb ? it.boxes.map((b) => b.name).filter(Boolean) : it.labels || []).join(', ');
    return h('div', { class: 'es-i', style: { animationDelay: `${Math.min(i, 12) * 0.02}s` } },
      h('button', { class: 'es-h', onclick: () => openOcc(it) },
        it.deck ? h('span', { class: 'es-deck', title: it.deck.replace(/ > /g, ' › ') }, it.deck.split(' > ').pop()) : null,
        h('span', { class: 'es-tx' }, h('span', { class: 'es-m' }, it.title || '그림'), names ? h('span', { class: 'es-s' }, names) : null),
        h('span', { class: `es-occst ${st[0]}` }, st[1]),
        h('span', { class: 'es-chev r' }, icon('right', 'icon s'))));
  }
  function openOcc(it) {
    // 그림이 아직 없는 다음 그림 카드들 (Enter 로 이어서 오리기)
    // 아직 할 일이 남은 그림 카드 (그림 없음, 테이프 없음, 이름 없는 테이프)
    const todo = (x) => !x.img || (x.kind === 'label' && (!(x.boxes || []).length || x.boxes.some((b) => !b.name)));
    const nav = it && todo(it) ? {
      pos(id) { const L = items.filter(todo); const i = L.findIndex((x) => x.id === id); return { i: i < 0 ? null : i + 1, n: L.length }; },
      next(id, batch) {
        const at = items.findIndex((x) => x.id === id);
        const order = at < 0 ? items.slice() : [...items.slice(at + 1), ...items.slice(0, at)];
        if (batch) { const c = order.find((x) => !x.img); if (c) return c; }
        return order.find(todo) || null;
      },
    } : null;
    openOccEditor({ sub, range, set: it, decks: deckNames, nav, startCrop: !!(it && !it.img && (it.src_file || it.src_page)), onSaved: (row, goneId) => {
      changed = true;
      const cur = row && items.find((x) => x.id === row.id);
      if (!row) items = items.filter((x) => x.id !== goneId);
      else if (cur) Object.assign(cur, row);
      else items.push(row);
      if (row?.deck && !deckNames.includes(row.deck)) deckNames.push(row.deck);
      paint();
    } });
  }

  // ── 입력 칸 ──
  const field = (label, value, { area = false, rows = 2, ph = '' } = {}) => {
    const inp = area ? h('textarea', { rows, placeholder: ph, spellcheck: 'false' }) : h('input', { placeholder: ph, spellcheck: 'false' });
    inp.value = value ?? '';
    if (area) { const fit = () => { inp.style.height = 'auto'; inp.style.height = `${inp.scrollHeight + 2}px`; }; inp.addEventListener('input', fit); requestAnimationFrame(fit); }
    const wrapF = h('label', { class: 'es-f' }, h('span', {}, label), inp);
    wrapF.inp = inp;
    return wrapF;
  };

  // 사진 칸 하나 : 비어 있으면 올리기, 있으면 미리보기 + 빼기
  function imgSlot(label, key0) {
    const slot = { key: key0 || null, busy: false };
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => { const fl = input.files?.[0]; input.value = ''; if (fl) slot.put(fl); } });
    const body = h('div', { class: 'es-pic-b' });
    slot.el = h('div', { class: 'es-pic' }, h('span', { class: 'es-pic-l' }, label), body, input);
    function paint() {
      if (slot.busy) { body.replaceChildren(h('div', { class: 'es-pic-box skel' }, h('i', { class: 'es-pic-bar' }))); return; }
      if (!slot.key) {
        body.replaceChildren(h('button', { class: 'es-pic-box es-pic-add', type: 'button', title: '사진 넣기', 'aria-label': `${label} 넣기`, onclick: () => input.click() }, icon('image')));
        return;
      }
      const th = imgEl(slot.key, 'es-pic-box');
      th.addEventListener('click', () => zoomImg(slot.key));
      th.append(h('button', { class: 'es-pic-x', type: 'button', title: '사진 빼기', 'aria-label': `${label} 빼기`, onclick: (e) => { e.stopPropagation(); slot.key = null; paint(); } }, icon('x', 'icon s')));
      body.replaceChildren(th, h('button', { class: 'es-pic-re', type: 'button', title: '다른 사진으로', 'aria-label': `${label} 바꾸기`, onclick: () => input.click() }, icon('restore', 'icon s')));
    }
    slot.put = async (file) => {
      if (slot.busy) return;
      slot.busy = true; paint();
      try {
        const k = await uploadImg(sub.id, file, (p) => { const b = body.querySelector('.es-pic-bar'); if (b) b.style.width = `${Math.round(p * 100)}%`; });
        temp.add(k); slot.key = k;
      } catch (e) { toast(e.message || '사진을 올리지 못했습니다'); }
      slot.busy = false; paint();
    };
    paint();
    return slot;
  }

  function editor(it) {
    const box = h('div', { class: 'es-ed' });
    const saveBtn = h('button', { class: 'btn sm', onclick: () => save() }, '저장');
    let armed = 0;
    const delBtn = h('button', { class: 'btn sm danger', onclick: () => del() }, '지우기');
    const foot = h('div', { class: 'es-foot' }, delBtn, h('div', { class: 'sp' }), h('button', { class: 'btn sm ghost', onclick: () => { openId = null; paint(); } }, '닫기'), saveBtn);
    let get;

    if (kind === 'flash') {
      const f = { deck: field('묶음', it.deck), front: field('앞', it.front, { area: true }), back: field('뒤', it.back, { area: true, rows: 3 }), hint: field('암기법', it.hint, { area: true, ph: '없으면 비워 둡니다' }) };
      const pic = { front: imgSlot('앞 사진', it.front_img), back: imgSlot('뒤 사진', it.back_img) };
      box.append(h('div', { class: 'es-grid' }, f.deck, f.front, f.back, f.hint), h('div', { class: 'es-pics' }, pic.front.el, pic.back.el));
      // 사진 붙여넣기 : 뒤 칸에 커서가 있으면 뒤 사진, 아니면 앞 사진
      box.addEventListener('paste', (e) => {
        const file = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
        if (!file) return;
        e.preventDefault();
        (document.activeElement === f.back.inp ? pic.back : pic.front).put(file);
      });
      get = () => {
        const v = { deck: f.deck.inp.value.trim(), front: f.front.inp.value.trim(), back: f.back.inp.value.trim(), hint: f.hint.inp.value.trim() };
        if (pic.front.key !== (it.front_img || null)) v.front_img = pic.front.key;
        if (pic.back.key !== (it.back_img || null)) v.back_img = pic.back.key;
        v.busy = pic.front.busy || pic.back.busy;
        return v;
      };
    } else if (kind === 'hanja') {
      const same = items.filter((x) => x.ch === it.ch).length;
      const f = { reading: field('훈음', it.reading, { ph: '여러 개면 / 로 나눕니다' }), hint: field('암기법', hints.get(it.ch), { area: true, ph: '없으면 비워 둡니다' }) };
      box.append(h('div', { class: 'es-grid' }, f.reading, f.hint),
        h('p', { class: 'es-note' }, same > 1 ? `암기법은 ${it.ch} 글자 전체(${same}곳)에 같이 보입니다` : '암기법은 같은 글자를 쓰는 과목에 같이 보입니다'));
      get = () => ({ reading: f.reading.inp.value.trim(), hint: f.hint.inp.value.trim() });
    } else if (kind === 'jung') {
      const hint = field('암기법', it.lines.find((l) => l.hint)?.hint, { area: true, ph: '없으면 비워 둡니다' });
      const lines = it.lines.map((l, i) => {
        const f = { hanja: field('원문', l.hanja, { area: true }), eum: field('음', l.eum, { area: true }), tr: field('해석', l.translation, { area: true }), notes: field('주석 (한 줄에 하나)', (l.notes || []).join('\n'), { area: true }) };
        const el = h('div', { class: 'es-line' }, h('div', { class: 'es-ln' }, `${i + 1}줄`), h('div', { class: 'es-grid' }, f.hanja, f.eum, f.tr, f.notes));
        return { l, f, el };
      });
      box.append(...lines.map((x) => x.el), h('div', { class: 'es-grid' }, hint));
      get = () => ({ hint: hint.inp.value.trim(), lines: lines.map(({ l, f }) => ({ id: l.id, hanja: f.hanja.inp.value.trim(), eum: f.eum.inp.value.trim(), translation: f.tr.inp.value.trim(), notes: f.notes.inp.value.split('\n').map((x) => x.trim()).filter(Boolean) })) });
    } else {
      const f = {
        cards: field('카드 ( / 로 나눔)', (it.cards || []).join(' / ')),
        orders: field('순서 ( / 로 나눔)', (it.orders || []).join(' / ')),
        tr: field('해석', it.translation, { area: true }),
        src: field('출처', it.source),
        hint: field('암기법', it.hint, { area: true, ph: '없으면 비워 둡니다' }),
      };
      box.append(h('div', { class: 'es-grid' }, f.cards, f.orders, f.tr, f.src, f.hint));
      get = () => {
        const cards = f.cards.inp.value.split('/').map((x) => x.trim()).filter(Boolean);
        const orders = f.orders.inp.value.split('/').map((x) => x.trim()).filter(Boolean).map(Number);
        return { cards, orders, sentence: cards.join(''), translation: f.tr.inp.value.trim(), source: f.src.inp.value.trim(), hint: f.hint.inp.value.trim() };
      };
    }
    box.append(foot);

    async function save() {
      const v = get();
      // 확인
      if (kind === 'flash') {
        if (v.busy) { toast('사진을 올리는 중입니다'); return; }
        delete v.busy;
        const fi = 'front_img' in v ? v.front_img : it.front_img; const bi = 'back_img' in v ? v.back_img : it.back_img;
        if ((!v.front && !fi) || (!v.back && !bi)) { toast('앞과 뒤에 글이나 사진을 넣어주세요'); shake(box); return; }
      }
      if (kind === 'um') {
        if (!v.cards.length) { toast('카드를 적어주세요'); shake(box); return; }
        if (v.cards.length !== v.orders.length) { toast(`카드 ${v.cards.length}개, 순서 ${v.orders.length}개로 개수가 다릅니다`); shake(box); return; }
        if (v.orders.some((n) => !Number.isInteger(n) || n < 1)) { toast('순서는 1 이상의 숫자로 적어주세요'); shake(box); return; }
      }
      saveBtn.disabled = true;
      try {
        if (kind === 'flash') {
          const gone = ['front_img', 'back_img'].filter((k) => k in v && it[k]).map((k) => it[k]);
          ok(await sb.from('flash_cards').update(v).eq('id', it.id));
          [v.front_img, v.back_img].forEach((k) => k && temp.delete(k));
          Object.assign(it, v);
          if (gone.length) dropImgs(gone);
        }
        else if (kind === 'hanja') {
          if (v.reading !== it.reading) { ok(await sb.from('hanja_cards').update({ reading: v.reading }).eq('id', it.id)); it.reading = v.reading; }
          if (v.hint !== (hints.get(it.ch) || '')) {
            if (v.hint) ok(await sb.from('hanja_hints').upsert({ pool, ch: it.ch, hint: v.hint, updated_at: new Date().toISOString() }, { onConflict: 'pool,ch' }));
            else ok(await sb.from('hanja_hints').delete().eq('pool', pool).eq('ch', it.ch));
            hints.set(it.ch, v.hint);
          }
        } else if (kind === 'jung') {
          for (const [i, ln] of v.lines.entries()) {
            const patch = { hanja: ln.hanja, eum: ln.eum, translation: ln.translation, notes: ln.notes, hint: i === 0 ? v.hint : '' };
            ok(await sb.from('jung_lines').update(patch).eq('id', ln.id));
            Object.assign(it.lines[i], patch);
          }
        } else { ok(await sb.from('um_sentences').update(v).eq('id', it.id)); Object.assign(it, v); }
        changed = true;
        toast('저장했습니다');
        openId = null; paint();
      } catch (e) { toast(e.message || '저장하지 못했습니다'); saveBtn.disabled = false; }
    }

    async function del() {
      if (Date.now() - armed > 2500) {
        armed = Date.now(); delBtn.textContent = '한 번 더 누르면 지웁니다'; delBtn.classList.add('armed');
        setTimeout(() => { if (delBtn.isConnected) { delBtn.textContent = '지우기'; delBtn.classList.remove('armed'); } }, 2500);
        return;
      }
      try {
        if (kind === 'flash') { ok(await sb.from('flash_cards').delete().eq('id', it.id)); dropImgs([it.front_img, it.back_img]); }
        else if (kind === 'hanja') ok(await sb.from('hanja_cards').delete().eq('id', it.id));
        else if (kind === 'jung') ok(await sb.from('jung_lines').delete().in('id', it.lines.map((l) => l.id)));
        else ok(await sb.from('um_sentences').delete().eq('id', it.id));
        items = items.filter((x) => x !== it);
        changed = true; openId = null; paint(); toast('지웠습니다');
      } catch (e) { toast(e.message || '지우지 못했습니다'); }
    }
    return box;
  }

  // 플래시카드 한 장 추가 (지금 검색어 묶음 또는 마지막 묶음으로)
  async function addFlash() {
    const deck = items[items.length - 1]?.deck || '';
    const sort = (items.reduce((m, x) => Math.max(m, x.sort || 0), 0) || 0) + 1;
    try {
      const row = ok(await sb.from('flash_cards').insert({ range_id: range.id, deck, front: '새 카드', back: '뒷면', hint: '', sort }).select().single());
      items.push(row); changed = true;
      search.value = ''; openId = row.id; shown = Math.max(shown, items.length); paint();
      setTimeout(() => {
        const el = list.querySelector('.es-i.open');
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const inp = el?.querySelectorAll('textarea')[0]; if (inp) { inp.focus(); inp.select(); }
      }, 80);
    } catch (e) { toast(e.message || '추가하지 못했습니다'); }
  }

  load();
}
