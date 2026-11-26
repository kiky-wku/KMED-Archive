import { h, icon, toast, drawer, seg } from '../ui.js';
import { deckState } from '../data/hanja.js';
import { loadFlashAll, loadOcc, loadItems, saveItem, clearItems, loadMyHints, myHintOf } from '../data/study.js';
import { occView, occZoom } from './occ-view.js';
import { unitPicker } from './units.js';
import { hint } from './hint.js';
import { imgEl, zoomImg, preload } from '../data/images.js';

// ─────────────────────────────────────────────
// 플래시카드 : 앞 → 뒤 / 뒤 → 앞, 뒤집고 맞음 · 틀림, 💡 암기법
// ─────────────────────────────────────────────
export function flash(ctx, el) {
  let alive = true;
  const offs = [];
  el.append(h('div', { class: 'q-skel' },
    h('div', { class: 'bar' }, h('i', { class: 'skel', style: { width: '130px' } }), h('i', { class: 'skel', style: { width: '200px' } })),
    h('i', { class: 'skel card' }), h('i', { class: 'skel act' })));

  (async () => {
    const [all, sets] = await Promise.all([loadFlashAll(ctx.range.id).catch(() => []), loadOcc(ctx.range.id), loadMyHints()]);
    if (!alive) return;
    // 담당자 : 그림을 아직 안 넣었거나 테이프 이름이 빈 그림 카드 알림
    const todo = ctx.canWrite ? sets.filter((x) => !x.img || (x.kind === 'label' && (!(x.boxes || []).length || x.boxes.some((b) => !b.name)))).length : 0;
    const todoBar = todo && ctx.edit ? h('button', { class: 'occ-todo', onclick: () => ctx.edit('occ') }, icon('image', 'icon s'), h('span', {}, `그림 넣기가 필요한 그림 카드 ${todo}개`), icon('right', 'icon s')) : null;
    if (!all.length) { el.replaceChildren(...[todoBar, h('div', { class: 'empty' }, '등록된 카드가 없습니다')].filter(Boolean)); ctx.fit?.(false); return; }

    // 묶음
    const decks = [];
    // "5주차 > Combining Forms" 처럼 두 단계면 주차로 묶어서 보여 줌
    all.forEach((c) => {
      const d = c.deck || '기본'; if (decks.some((x) => x.id === d)) return;
      const k = d.indexOf(' > ');
      decks.push(k > 0 ? { id: d, group: d.slice(0, k).trim(), label: d.slice(k + 3).trim(), pill: `${d.slice(0, k).trim()} ${d.slice(k + 3).trim()}` } : { id: d, label: d });
    });
    const selKey = `kmed:fdeck:${ctx.range.id}`;
    let sel = [];
    try { sel = JSON.parse(localStorage.getItem(selKey) || '[]').filter((d) => decks.some((x) => x.id === d)); } catch { sel = []; }
    let mode = localStorage.getItem('kmed:fmode') === 'b' ? 'b' : 'f';
    // 카드 종류 : 전체 / 글 카드만 / 그림 카드만 (둘 다 있을 때만 고름)
    const hasPic = all.some((c) => c.occ); const hasText = all.some((c) => !c.occ);
    const kindKey = `kmed:fkind:${ctx.range.id}`;
    let ckind = hasPic && hasText ? (localStorage.getItem(kindKey) || 'all') : 'all';
    const byId = new Map(all.map((c) => [c.id, c]));

    let items = await loadItems(`flash_${mode}`);
    if (!alive) return;
    let scope; let deck;
    function build() {
      scope = all.filter((c) => (!sel.length || sel.includes(c.deck || '기본')) && (ckind === 'all' || (ckind === 'pic') === !!c.occ)).map((c) => c.id);
      deck = deckState(`flash:${ctx.range.id}:${mode}:${sel.slice().sort().join(',') || 'all'}${ckind === 'all' ? '' : `:${ckind}`}`, scope);
    }
    build();
    const st = (id) => items.get(id)?.status || null;

    el.replaceChildren();
    el.classList.add('q-in');
    const counts = h('div', { class: 'q-counts' });
    const bar = h('div', { class: 'q-prog' }, h('i', { class: 'ok' }), h('i', { class: 'no' }));
    const recBtn = h('button', { class: 'tool-ic rec-btn', title: '기록', 'aria-label': '기록', onclick: openRecords }, icon('list'));
    // 전체 화면 : 위쪽 머리글, 탭을 숨기고 카드만 크게 (가능하면 브라우저 전체 화면까지)
    const fullBtn = h('button', { class: 'tool-ic', title: '전체 화면', 'aria-label': '전체 화면', onclick: () => setFull(!document.documentElement.classList.contains('fc-focus')) }, icon('full'));
    function setFull(on) {
      const de = document.documentElement;
      de.classList.toggle('fc-focus', on);
      fullBtn.replaceChildren(icon(on ? 'unfull' : 'full'));
      fullBtn.title = on ? '전체 화면 끝내기' : '전체 화면'; fullBtn.setAttribute('aria-label', fullBtn.title);
      try {
        if (on && !document.fullscreenElement && de.requestFullscreen) de.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
        else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
      } catch { /* 안 되는 브라우저는 화면 안에서만 */ }
    }
    const onFs = () => { if (!document.fullscreenElement && document.documentElement.classList.contains('fc-focus') && fsWas) setFull(false); fsWas = !!document.fullscreenElement; };
    let fsWas = false;
    document.addEventListener('fullscreenchange', onFs);
    offs.push(() => { document.removeEventListener('fullscreenchange', onFs); if (document.documentElement.classList.contains('fc-focus')) setFull(false); });
    const stage = h('section', { class: 'stage' });
    let hideAll = localStorage.getItem('kmed:occ-one') !== '1';
    el.append(
      ...(todoBar ? [todoBar] : []),
      h('div', { class: 'q-bar' },
        decks.length > 1 || (hasPic && hasText) ? unitPicker(() => (ckind === 'all' ? decks : decks.filter((d) => all.some((c) => (c.deck || '기본') === d.id && (ckind === 'pic') === !!c.occ))), sel, (v) => { sel = v; try { localStorage.setItem(selKey, JSON.stringify(sel)); } catch { /* 무시 */ } build(); render(); }, '전체 묶음', {
          tag: () => (ckind === 'pic' ? '그림' : ckind === 'text' ? '글' : null),
          top: hasPic && hasText ? (repaint) => h('div', { class: 'unit-kind' }, seg([['all', '전체'], ['text', '글 카드'], ['pic', '그림 카드']], ckind, (v) => {
            ckind = v; try { localStorage.setItem(kindKey, v); } catch { /* 무시 */ }
            repaint(); build(); render();
          })) : null,
        }) : null,
        seg([['f', '앞면 먼저'], ['b', '뒷면 먼저']], mode, async (v) => {
          mode = v; try { localStorage.setItem('kmed:fmode', v); } catch { /* 무시 */ }
          items = await loadItems(`flash_${mode}`); build(); render();
        }),
        counts, h('div', { class: 'sp' }),
        h('div', { class: 'q-tools' }, h('button', { class: 'tool-ic', title: '섞기', 'aria-label': '섞기', onclick: () => { shuffle(deck.order); deck.pos = 0; deck.save(); render(); toast('카드를 섞었습니다'); } }, icon('shuffle')),
        h('button', { class: 'tool-ic', title: '원래 순서', 'aria-label': '원래 순서', onclick: () => { deck.order = scope.slice(); deck.pos = 0; deck.save(); render(); toast('원래 순서로 되돌렸습니다'); } }, icon('restore')),
        recBtn, fullBtn)),
      bar, stage);

    let phase = 'ask';
    const rem = () => deck.order.filter((id) => !st(id));
    const cur = () => { const r = rem(); if (deck.pos >= r.length) deck.pos = 0; return r[deck.pos]; };

    function record(ok) {
      const id = cur(); if (!id || phase !== 'shown') return;
      saveItem(`flash_${mode}`, items, id, { status: ok ? 'ok' : 'no' }, 0);
      deck.hist.push(id); deck.save();
      stage.classList.remove('nx'); void stage.offsetWidth; stage.classList.add('nx');
      render();
    }
    function back() {
      const id = deck.hist.pop(); if (!id) return;
      saveItem(`flash_${mode}`, items, id, { status: null }, 0);
      deck.pos = Math.max(0, rem().indexOf(id)); deck.save(); render();
    }
    function skip() {
      const r = rem(); if (r.length <= 1) { toast('건너뛸 다른 카드가 없습니다'); return; }
      deck.pos = (deck.pos + 1) % r.length; deck.save(); render();
    }

    function renderCounts() {
      const ok = scope.filter((id) => st(id) === 'ok').length;
      const no = scope.filter((id) => st(id) === 'no').length;
      counts.replaceChildren(
        h('span', {}, h('b', {}, scope.length - ok - no), ' 남음'),
        h('span', { class: 'ok' }, h('b', {}, ok), ' 맞음'),
        h('span', { class: 'no' }, h('b', {}, no), ' 틀림'));
      const t = scope.length || 1;
      bar.children[0].style.width = `${(ok / t) * 100}%`;
      bar.children[1].style.width = `${(no / t) * 100}%`;
      recBtn.classList.toggle('dot', ok + no > 0);
    }

    function renderStage() {
      phase = 'ask';
      const r = rem();
      if (!r.length) {
        const wrong = scope.filter((id) => st(id) === 'no').length;
        stage.replaceChildren(h('div', { class: 'q-done' },
          h('div', { class: 'emo' }, '🎉'), h('h2', {}, '카드를 다 넘겼습니다'),
          h('div', { class: 'sub' }, `맞음 ${scope.length - wrong}, 틀림 ${wrong}`),
          h('div', { class: 'row' },
            wrong ? h('button', { class: 'btn', onclick: retryWrong }, `틀린 ${wrong}장 다시`) : null,
            h('button', { class: 'btn ghost', onclick: openRecords }, '기록 보기'))));
        return;
      }
      const c = byId.get(cur());
      ctx.here = `${c.front} / ${c.back}`.slice(0, 120);
      const q = mode === 'f' ? c.front : c.back;
      const a = mode === 'f' ? c.back : c.front;
      const qi = mode === 'f' ? c.front_img : c.back_img;
      const ai = mode === 'f' ? c.back_img : c.front_img;
      // 다음 카드 사진 미리 받기
      r.slice(deck.pos + 1, deck.pos + 4).forEach((id) => { const n = byId.get(id); if (n) preload([n.front_img, n.back_img, n.occ?.set.img]); });
      const hn = hint(c.hint, myHintOf(c.id));
      const meta = h('div', { class: 'card-meta' },
        h('span', { class: 'idx' }, `${deck.pos + 1}`, h('i', {}, ` / ${r.length}`)),
        c.deck ? h('span', { class: 'fc-deck', title: c.deck.replace(/ > /g, ' › ') }, c.deck.split(' > ').pop()) : null,
        h('div', { class: 'meta-act' }, hn.btn,
          h('button', { class: 'tool-ic sm', title: '이전 카드', 'aria-label': '이전 카드', disabled: !deck.hist.length, onclick: (e) => { e.stopPropagation(); back(); } }, icon('undo', 'icon s')),
          h('button', { class: 'tool-ic sm', title: '건너뛰기', 'aria-label': '건너뛰기', onclick: (e) => { e.stopPropagation(); skip(); } }, icon('skip', 'icon s'))));
      let flip;
      if (c.occ) {
        // 그림 카드 : 앞 → 뒤 = 빨간 테이프 이름 맞히기, 뒤 → 앞 = 이름 보고 자리 찾기
        const { set, box } = c.occ;
        const whole = !box;
        const fAsk = mode === 'f' ? 'name' : 'where';
        const vf = whole ? (mode === 'f' ? occPic(set, {}) : null) : occPic(set, { target: box, ask: fAsk, hideAll });
        const vb = whole ? occPic(set, {}) : occPic(set, { target: box, reveal: true, ask: fAsk, hideAll });
        if (!whole) meta.querySelector('.meta-act').prepend(h('button', { class: 'tool-ic sm' + (hideAll ? '' : ' on'), title: hideAll ? '다른 이름 보이기' : '다른 이름 가리기', 'aria-label': hideAll ? '다른 이름 보이기' : '다른 이름 가리기', onclick: (e) => {
          e.stopPropagation(); hideAll = !hideAll; try { localStorage.setItem('kmed:occ-one', hideAll ? '0' : '1'); } catch { /* 무시 */ }
          const keep = phase; renderStage(); if (keep === 'shown') stage.turn?.(true);
        } }, icon(hideAll ? 'eyeoff' : 'eye', 'icon s')));
        const askText = whole ? '이 그림은 무엇입니까' : '빨간 칸의 이름은 무엇입니까';
        const front = mode === 'f'
          ? h('div', { class: 'face front has-img occ-face' }, meta, vf, h('div', { class: 'occ-ask' }, askText), hn.panel)
          : whole
            ? h('div', { class: 'face front occ-face' }, meta, h('div', { class: `fc-text ${size(c.back)}` }, c.back), hn.panel)
            : h('div', { class: 'face front has-img occ-face' }, meta, vf, h('div', { class: 'occ-ask' }, h('b', {}, c.back), ' 자리는 어디입니까'), hn.panel);
        const back = h('div', { class: 'face back has-img occ-face' }, h('div', { class: 'fc-q' }, set.title || '그림'), vb,
          h('div', { class: 'fc-text l occ-ans' }, c.back));
        // 뒤집지 않고 그 자리에서 정답만 : 앞면 그림을 정답 그림으로 바꾸고 아래에 정답
        flip = h('div', { class: 'flip fc occ-flat' }, front);
        flip.reveal = () => {
          const pic = front.querySelector('.occ.fc-img'); pic?.stop?.();
          pic?.replaceWith(vb);
          front.querySelector('.occ-ask')?.replaceWith(h('div', { class: 'fc-text l occ-ans occ-in-ans' }, c.back));
          front.classList.add('shown');
          void back;
        };
      } else {
        flip = h('div', { class: 'flip fc' },
          h('div', { class: 'face front' + (qi ? ' has-img' : '') }, meta, ...body(q, qi), hn.panel),
          h('div', { class: 'face back' + (ai ? ' has-img' : '') }, h('div', { class: 'fc-q' }, q || (qi ? '사진' : '')), ...body(a, ai)));
      }
      const actions = h('div', { class: 'stage-act' });
      const turn = (instant) => {
        if (phase !== 'ask') return;
        if (instant === true) { flip.style.transition = 'none'; requestAnimationFrame(() => { flip.style.transition = ''; }); }
        if (flip.reveal) flip.reveal(); else flip.classList.add('on');
        phase = 'shown';
        actions.replaceChildren(
          h('button', { class: 'gbtn no', onclick: () => record(false) }, icon('x', 'icon s'), '틀림', h('kbd', {}, '←')),
          h('button', { class: 'gbtn ok', onclick: () => record(true) }, icon('check', 'icon s'), '맞음', h('kbd', {}, '→')));
      };
      flip.addEventListener('click', () => turn());
      stage.turn = turn;
      actions.append(h('button', { class: 'btn ink', onclick: () => turn() }, c.occ ? '정답 보기' : '뒤집기', h('kbd', { class: 'k' }, 'Space')));
      stage.replaceChildren(h('div', { class: 'scene' }, flip), actions);
    }

    // ── 기록 서랍 ──
    let rec = null; let filter = 'all';
    function openRecords() {
      const body = h('div', { class: 'rec' });
      rec = { body, d: drawer({ title: '기록', body, onClose: () => { rec = null; } }) };
      drawRecords();
    }
    function drawRecords() {
      if (!rec) return;
      const ok = scope.filter((id) => st(id) === 'ok');
      const no = scope.filter((id) => st(id) === 'no');
      const list = filter === 'ok' ? ok : filter === 'no' ? no : [...no, ...ok];
      const tab = (v, label, n) => h('button', { class: v === filter ? 'on' : '', onclick: () => { filter = v; drawRecords(); } }, label, h('b', {}, n));
      rec.body.replaceChildren(
        h('div', { class: 'segc full' }, tab('all', '전체', ok.length + no.length), tab('no', '틀림', no.length), tab('ok', '맞음', ok.length)),
        list.length ? h('div', { class: 'fc-rec' }, list.map((id) => {
          const c = byId.get(id);
          return h('div', { class: 'fr ' + st(id) }, h('b', {}, c.front || '사진'), h('span', {}, c.back || '사진'));
        })) : h('div', { class: 'rec-empty' }, '기록이 없습니다'),
        h('div', { class: 'rec-foot' },
          h('button', { class: 'btn', onclick: () => { rec.d.close(); retryWrong(); } }, '틀린 카드만 다시'),
          h('button', { class: 'btn ghost', onclick: resetAll }, sel.length ? '고른 묶음 리셋' : '전체 리셋')));
    }
    function retryWrong() {
      const no = scope.filter((id) => st(id) === 'no');
      if (!no.length) { toast('틀린 카드가 없습니다'); return; }
      no.forEach((id) => saveItem(`flash_${mode}`, items, id, { status: null }, 0));
      deck.order = [...no, ...deck.order.filter((id) => !no.includes(id))];
      deck.pos = 0; deck.save(); render(); toast(`틀린 ${no.length}장을 다시 봅니다`);
    }
    let armed = false;
    function resetAll(e) {
      const btn = e.currentTarget;
      if (!armed) { armed = true; const t = btn.textContent; btn.textContent = '한 번 더 누르면 리셋'; setTimeout(() => { armed = false; if (document.contains(btn)) btn.textContent = t; }, 2500); return; }
      armed = false;
      clearItems(`flash_${mode}`, items, scope.filter((id) => items.has(id)));
      deck.hist = []; deck.pos = 0; deck.save(); render(); toast('초기화했습니다');
    }

    function render() { renderCounts(); renderStage(); drawRecords(); }
    // 통계에서 '틀린 것 다시 풀기'로 들어온 경우
    if (ctx.retry) { ctx.retry = false; render(); retryWrong(); } else render();

    const onKey = (e) => {
      if (document.querySelector('.modal-wrap, .drawer.on, .pop, .ds-wrap, .zimg')) return;
      const tag = (e.target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (phase === 'ask') { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); stage.turn?.(); } return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); record(false); }
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); record(true); }
    };
    document.addEventListener('keydown', onKey);
    offs.push(() => document.removeEventListener('keydown', onKey), () => rec?.d.close());
  })();

  return () => { alive = false; offs.forEach((f) => f()); };
}

// 그림 카드 그림 + 크게 보기 버튼
function occPic(set, opts) {
  const v = occView(set, { ...opts, cls: 'fc-img' });
  v.append(h('button', { class: 'fc-zoom', title: '크게 보기', 'aria-label': '크게 보기', onclick: (e) => { e.stopPropagation(); occZoom(set, opts); } }, icon('expand', 'icon s')));
  return v;
}

// 카드 한 면 : 사진이 있으면 사진 + 글 (글은 한 단계 작게)
function body(t, key) {
  if (!key) return [h('div', { class: `fc-text ${size(t)}` }, t)];
  const im = imgEl(key, 'fc-img');
  im.append(h('button', { class: 'fc-zoom', title: '크게 보기', 'aria-label': '크게 보기', onclick: (e) => { e.stopPropagation(); zoomImg(key); } }, icon('expand', 'icon s')));
  const down = { xl: 'l', l: 'm', m: 's', s: 's' };
  return [im, t ? h('div', { class: `fc-text ${down[size(t)]}` }, t) : null].filter(Boolean);
}

// 글 길이에 맞춰 크기
function size(t) {
  const n = [...String(t || '')].length;
  return n <= 4 ? 'xl' : n <= 12 ? 'l' : n <= 40 ? 'm' : 's';
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
