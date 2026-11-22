import { h, icon, toast, drawer, seg } from '../ui.js';
import { deckState } from '../data/hanja.js';
import { loadFlash, loadItems, saveItem, clearItems } from '../data/study.js';
import { unitPicker } from './units.js';
import { hint } from './hint.js';

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
    const all = await loadFlash(ctx.range.id).catch(() => []);
    if (!alive) return;
    if (!all.length) { el.replaceChildren(h('div', { class: 'empty' }, '등록된 카드가 없습니다')); ctx.fit?.(false); return; }

    // 묶음
    const decks = [];
    all.forEach((c) => { const d = c.deck || '기본'; if (!decks.some((x) => x.id === d)) decks.push({ id: d, label: d }); });
    const selKey = `kmed:fdeck:${ctx.range.id}`;
    let sel = [];
    try { sel = JSON.parse(localStorage.getItem(selKey) || '[]').filter((d) => decks.some((x) => x.id === d)); } catch { sel = []; }
    let mode = localStorage.getItem('kmed:fmode') === 'b' ? 'b' : 'f';
    const byId = new Map(all.map((c) => [c.id, c]));

    let items = await loadItems(`flash_${mode}`);
    if (!alive) return;
    let scope; let deck;
    function build() {
      scope = all.filter((c) => !sel.length || sel.includes(c.deck || '기본')).map((c) => c.id);
      deck = deckState(`flash:${ctx.range.id}:${mode}:${sel.slice().sort().join(',') || 'all'}`, scope);
    }
    build();
    const st = (id) => items.get(id)?.status || null;

    el.replaceChildren();
    el.classList.add('q-in');
    const counts = h('div', { class: 'q-counts' });
    const bar = h('div', { class: 'q-prog' }, h('i', { class: 'ok' }), h('i', { class: 'no' }));
    const recBtn = h('button', { class: 'tool-pill', onclick: openRecords }, icon('list', 'icon s'), h('span', {}, '기록'));
    const stage = h('section', { class: 'stage' });
    el.append(
      h('div', { class: 'q-bar' },
        decks.length > 1 ? unitPicker(decks, sel, (v) => { sel = v; try { localStorage.setItem(selKey, JSON.stringify(sel)); } catch { /* 무시 */ } build(); render(); }, '전체 묶음') : null,
        seg([['f', '앞 → 뒤'], ['b', '뒤 → 앞']], mode, async (v) => {
          mode = v; try { localStorage.setItem('kmed:fmode', v); } catch { /* 무시 */ }
          items = await loadItems(`flash_${mode}`); build(); render();
        }),
        counts, h('div', { class: 'sp' }),
        h('button', { class: 'tool-ic', title: '섞기', 'aria-label': '섞기', onclick: () => { shuffle(deck.order); deck.pos = 0; deck.save(); render(); toast('카드를 섞었습니다'); } }, icon('shuffle')),
        h('button', { class: 'tool-ic', title: '원래 순서', 'aria-label': '원래 순서', onclick: () => { deck.order = scope.slice(); deck.pos = 0; deck.save(); render(); toast('원래 순서로 되돌렸습니다'); } }, icon('restore')),
        recBtn),
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
      const hn = hint(c.hint);
      const meta = h('div', { class: 'card-meta' },
        h('span', { class: 'idx' }, `${deck.pos + 1}`, h('i', {}, ` / ${r.length}`)),
        c.deck ? h('span', { class: 'fc-deck' }, c.deck) : null,
        h('div', { class: 'meta-act' }, hn.btn,
          h('button', { class: 'tool-ic sm', title: '이전 카드', 'aria-label': '이전 카드', disabled: !deck.hist.length, onclick: (e) => { e.stopPropagation(); back(); } }, icon('undo', 'icon s')),
          h('button', { class: 'tool-ic sm', title: '건너뛰기', 'aria-label': '건너뛰기', onclick: (e) => { e.stopPropagation(); skip(); } }, icon('skip', 'icon s'))));
      const flip = h('div', { class: 'flip fc' },
        h('div', { class: 'face front' }, meta, h('div', { class: `fc-text ${size(q)}` }, q), hn.panel),
        h('div', { class: 'face back' }, h('div', { class: 'fc-q' }, q), h('div', { class: `fc-text ${size(a)}` }, a)));
      const actions = h('div', { class: 'stage-act' });
      const turn = () => {
        if (phase !== 'ask') return;
        flip.classList.add('on'); phase = 'shown';
        actions.replaceChildren(
          h('button', { class: 'gbtn no', onclick: () => record(false) }, icon('x', 'icon s'), '틀림', h('kbd', {}, '←')),
          h('button', { class: 'gbtn ok', onclick: () => record(true) }, icon('check', 'icon s'), '맞음', h('kbd', {}, '→')));
      };
      flip.addEventListener('click', turn);
      stage.turn = turn;
      actions.append(h('button', { class: 'btn ink', onclick: turn }, '뒤집기', h('kbd', { class: 'k' }, 'Space')));
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
          return h('div', { class: 'fr ' + st(id) }, h('b', {}, c.front), h('span', {}, c.back));
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
      if (document.querySelector('.modal-wrap, .drawer.on, .pop, .ds-wrap')) return;
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

// 글 길이에 맞춰 크기
function size(t) {
  const n = [...String(t || '')].length;
  return n <= 4 ? 'xl' : n <= 12 ? 'l' : n <= 40 ? 'm' : 's';
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
