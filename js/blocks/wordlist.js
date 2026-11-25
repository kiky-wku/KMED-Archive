import { h, icon, toast, seg } from '../ui.js';
import { loadFlashAll, loadOcc, loadMyHints, myHintOf, saveMyHint } from '../data/study.js';
import { imgEl, zoomImg } from '../data/images.js';
import { occView, occZoom } from './occ-view.js';
import { unitPicker } from './units.js';

// ─────────────────────────────────────────────
// 단어 목록 : 플래시카드의 단어와 그림을 해설지처럼 한 번에
//  · 묶음(주차 > 소단원)별로, 글 카드는 앞면 | 뒷면 한 줄씩, 그림 카드는 번호 붙은 그림 + 이름 목록
//  · 줄마다 나만의 암기법 (비워 두면 안 보임, 쓰면 플래시카드 💡 에도 나옴)
//  · 뜻 가리기 : 뒷면을 가려 두고 눌러서 확인
// ─────────────────────────────────────────────
export function wordList(ctx, el) {
  let alive = true;
  el.append(h('div', { class: 'wl-sk' }, ...[0, 1, 2, 3, 4].map(() => h('i', { class: 'skel' }))));

  (async () => {
    const [cards, sets] = await Promise.all([loadFlashAll(ctx.range.id).catch(() => []), loadOcc(ctx.range.id), loadMyHints()]);
    if (!alive) return;
    const text = cards.filter((c) => !c.occ);
    const pics = sets.filter((x) => x.img && (x.kind === 'whole' ? (x.labels || [])[0] : (x.boxes || []).some((b) => b.name)));
    if (!text.length && !pics.length) { el.replaceChildren(h('div', { class: 'empty' }, '플래시카드에 넣은 단어가 없습니다')); return; }

    // 묶음 : 자료 순서대로, "주차 > 소단원" 은 주차로 묶어 보여 줌
    const decks = [];
    const addDeck = (d) => {
      d = d || '기본'; if (decks.some((x) => x.id === d)) return;
      const k = d.indexOf(' > ');
      decks.push(k > 0 ? { id: d, group: d.slice(0, k).trim(), label: d.slice(k + 3).trim(), pill: `${d.slice(0, k).trim()} ${d.slice(k + 3).trim()}` } : { id: d, label: d });
    };
    text.forEach((c) => addDeck(c.deck)); pics.forEach((x) => addDeck(x.deck));
    const selKey = `kmed:wldeck:${ctx.range.id}`;
    let sel = []; try { sel = JSON.parse(localStorage.getItem(selKey) || '[]').filter((d) => decks.some((x) => x.id === d)); } catch { sel = []; }
    let cover = localStorage.getItem('kmed:wlcover') === '1';
    let q = '';

    // 단어 / 그림 (둘 다 있을 때만 고름)
    const both = text.length && pics.length;
    let view = both ? (localStorage.getItem('kmed:wlview') === 'pic' ? 'pic' : 'word') : pics.length && !text.length ? 'pic' : 'word';
    // 찾기 : 동그란 버튼 → 누르면 펼쳐짐 (자료 탭과 같은 모양)
    const sInp = h('input', { type: 'search', placeholder: '찾기', spellcheck: 'false', oninput: () => { q = sInp.value.trim().toLowerCase(); paint(); } });
    const srch = h('div', { class: 'fl-srch wl-srch2' },
      h('button', { class: 'fl-srch-btn', 'aria-label': '찾기', title: '찾기', onclick: () => { srch.classList.add('on'); setTimeout(() => sInp.focus(), 60); } }, icon('search', 'icon s')),
      sInp,
      h('button', { class: 'fl-srch-x', 'aria-label': '찾기 닫기', onclick: () => { srch.classList.remove('on'); if (sInp.value) { sInp.value = ''; q = ''; paint(); } sInp.blur(); } }, icon('x', 'icon s')));
    sInp.addEventListener('blur', () => { setTimeout(() => { if (!sInp.value && document.activeElement !== sInp) srch.classList.remove('on'); }, 150); });
    const head = h('div', { class: 'wl-head' },
      both ? seg([['word', '단어'], ['pic', '그림']], view, (v) => { view = v; try { localStorage.setItem('kmed:wlview', v); } catch { /* 무시 */ } coverSeg.style.display = v === 'word' ? '' : 'none'; paint(); }) : h('div'),
      h('div', { class: 'sp' }), srch);
    const coverSeg = seg([['all', '다 보기'], ['cover', '뜻 가리기']], cover ? 'cover' : 'all', (v) => { cover = v === 'cover'; try { localStorage.setItem('kmed:wlcover', cover ? '1' : '0'); } catch { /* 무시 */ } paint(); });
    coverSeg.style.display = view === 'word' ? '' : 'none';
    const bar = h('div', { class: 'q-bar wl-bar' },
      decks.length > 1 ? unitPicker(() => decks.filter((d) => (view === 'pic' ? pics : text).some((x) => (x.deck || '기본') === d.id)), sel, (v) => { sel = v; try { localStorage.setItem(selKey, JSON.stringify(v)); } catch { /* 무시 */ } paint(); }, '전체 묶음') : null,
      h('div', { class: 'sp' }), coverSeg);
    const list = h('div', { class: 'wl-list' });
    el.replaceChildren(head, bar, list);

    const hit = (...t) => !q || t.some((x) => String(x || '').toLowerCase().includes(q));
    function paint() {
      const show = decks.filter((d) => !sel.length || sel.includes(d.id));
      const out = []; let lastG = null; let n = 0;
      for (const d of show) {
        const rows = view === 'word' ? text.filter((c) => (c.deck || '기본') === d.id && hit(c.front, c.back, c.hint, myHintOf(c.id))) : [];
        const ps = view === 'pic' ? pics.filter((x) => (x.deck || '기본') === d.id && hit(x.title, ...(x.labels || []), ...(x.boxes || []).map((b) => b.name))) : [];
        if (!rows.length && !ps.length) continue;
        if (d.group && d.group !== lastG) { out.push(h('h2', { class: 'wl-wk' }, d.group)); lastG = d.group; }
        if (!d.group) lastG = null;
        out.push(h('section', { class: 'wl-sec', style: { animationDelay: `${Math.min(n++, 8) * 0.03}s` } },
          h('h3', { class: 'wl-h' }, d.label, h('span', {}, `${rows.length + ps.reduce((s, x) => s + (x.kind === 'whole' ? 1 : x.boxes.filter((b) => b.name).length), 0)}`)),
          rows.length ? h('div', { class: 'wl-rows card' }, rows.map(row)) : null,
          ...ps.map(pic)));
      }
      list.replaceChildren(...(out.length ? out : [h('div', { class: 'empty sm-e' }, q ? '찾는 단어가 없습니다' : view === 'pic' ? '이 묶음에는 그림이 없습니다' : '이 묶음에는 단어가 없습니다')]));
    }

    // 뜻 (가리기 모드면 눌러서 보기)
    const meaning = (t, cls = '') => {
      const el2 = h('div', { class: `wl-b ${cls}` + (cover ? ' hid' : '') }, t);
      if (cover) el2.addEventListener('click', (e) => { e.stopPropagation(); el2.classList.toggle('hid'); });
      return el2;
    };

    // 글 카드 한 줄
    function row(c) {
      const imgs = [c.front_img, c.back_img].filter(Boolean);
      const r = h('div', { class: 'wl-r' + (myHintOf(c.id) ? ' hasmine' : '') },
        h('div', { class: 'wl-f' }, c.front || (c.front_img ? '사진' : '')),
        meaning(c.back || (c.back_img ? '사진' : '')),
        hintBtn(c.id),
        imgs.length ? h('div', { class: 'wl-imgs' }, imgs.map((k) => { const im = imgEl(k, 'wl-th'); im.addEventListener('click', () => zoomImg(k)); return im; })) : null,
        hintArea(c.id, c.hint));
      return r;
    }

    // 그림 카드 : 번호 붙은 그림 + 이름 목록
    function pic(x) {
      const whole = x.kind === 'whole';
      const v = occView(x, { numbers: !whole, hideAll: false, cls: 'wl-occ' });
      v.addEventListener('click', () => occZoom(x, { numbers: !whole, hideAll: false }));
      const names = whole ? [{ id: x.id, n: '', name: (x.labels || [])[0] }] : x.boxes.map((b, i) => ({ id: b.id, n: i + 1, name: b.name })).filter((b) => b.name);
      return h('div', { class: 'wl-pic card' },
        h('div', { class: 'wl-pic-t' }, icon('image', 'icon s'), x.title || '그림'),
        h('div', { class: 'wl-pic-body' }, v,
          h('div', { class: 'wl-pic-l' }, names.map((b) => h('div', { class: 'wl-r wl-pr' + (myHintOf(b.id) ? ' hasmine' : '') },
            b.n ? h('span', { class: 'wl-n' }, b.n) : null,
            meaning(b.name, 'wl-pn'),
            hintBtn(b.id),
            hintArea(b.id, x.hint))))));
    }

    // 암기법 : 💡 를 누르면 아래에 한 줄 (내 것은 바로 고쳐 씀, 자료 암기법은 읽기만)
    function hintBtn(id) {
      const has = !!myHintOf(id);
      return h('button', { class: 'tool-ic sm wl-hb' + (has ? ' on' : ''), title: '암기법', 'aria-label': '암기법', onclick: (e) => {
        e.stopPropagation();
        const r = e.currentTarget.closest('.wl-r'); const area = r.querySelector('.wl-ha');
        const open = r.classList.toggle('hopen');
        if (open) setTimeout(() => area.querySelector('textarea')?.focus(), 60);
      } }, icon('bulb', 'icon s'));
    }
    function hintArea(id, shared) {
      const mine = myHintOf(id);
      let t = 0;
      const ta = h('textarea', { class: 'wl-ta', rows: 1, placeholder: '나만의 암기법', spellcheck: 'false', oninput: () => {
        grow(); clearTimeout(t); t = setTimeout(commit, 700);
      }, onblur: () => { clearTimeout(t); commit(); } }, mine);
      const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };
      let last = mine;
      function commit() {
        const v = ta.value.trim(); if (v === last) return;
        last = v; saveMyHint(id, v);
        const r = ta.closest('.wl-r'); r?.querySelector('.wl-hb')?.classList.toggle('on', !!v);
        r?.classList.toggle('hasmine', !!v);
      }
      requestAnimationFrame(grow);
      return h('div', { class: 'wl-ha' },
        shared ? h('div', { class: 'wl-shared' }, icon('bulb', 'icon s'), shared) : null,
        ta);
    }
    paint();
  })().catch(() => { if (alive) el.replaceChildren(h('div', { class: 'empty' }, '불러오지 못했습니다')); toast('단어 목록을 불러오지 못했습니다'); });

  return () => { alive = false; };
}
