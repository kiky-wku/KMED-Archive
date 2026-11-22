import { h, icon, toast, drawer } from '../ui.js';
import { loadCards, loadProgress, uniqueCards, readingText, matchReading, setStatus, deckState, loadHints } from '../data/hanja.js';
import { hint } from './hint.js';
import { pencilPad } from './pencil.js';
import { unitPicker } from './units.js';

// ─────────────────────────────────────────────
// 한자 → 훈음 (mode 'r') / 훈음 → 한자 (mode 'h')
//  화면 : 도구 줄 → 진행 막대 → 가운데 카드 → 버튼. 기록은 옆 서랍.
// ─────────────────────────────────────────────
export function hanjaQuiz(ctx, el, mode) {
  let alive = true;
  const offs = [];
  el.append(h('div', { class: 'q-skel' },
    h('div', { class: 'bar' }, h('i', { class: 'skel', style: { width: '130px' } }), h('i', { class: 'skel', style: { width: '200px' } })),
    h('i', { class: 'skel card' }), h('i', { class: 'skel act' })));

  (async () => {
    const [{ cards, units }, prog, hints] = await Promise.all([loadCards(ctx.range.id), loadProgress(ctx.pool), loadHints(ctx.pool)]);
    if (!alive) return;
    el.replaceChildren();
    el.classList.add('q-in');
    if (!cards.length) { el.append(h('div', { class: 'empty' }, '등록된 한자가 없습니다')); return; }
    const status = prog[mode];

    // ── 단원 ──
    const selKey = `kmed:units:${ctx.range.id}`;
    let sel = [];
    try { sel = JSON.parse(localStorage.getItem(selKey) || '[]').filter((u) => units.some((x) => x.id === u)); } catch { sel = []; }
    let deck, cmap, scope;
    function buildDeck() {
      const list = uniqueCards(cards, sel);
      cmap = new Map(list.map((c) => [c.ch, c]));
      scope = list.map((c) => c.ch);
      deck = deckState(`${ctx.range.id}:${mode}:${sel.slice().sort().join(',') || 'all'}`, scope);
    }
    buildDeck();

    // ── 뼈대 ──
    const counts = h('div', { class: 'q-counts' });
    const bar = h('div', { class: 'q-prog' }, h('i', { class: 'ok' }), h('i', { class: 'no' }));
    const recBtn = h('button', { class: 'tool-pill', onclick: openRecords }, icon('list', 'icon s'), h('span', {}, '기록'));
    const toolbar = h('div', { class: 'q-bar' },
      units.length ? unitPicker(units, sel, (v) => { sel = v; try { localStorage.setItem(selKey, JSON.stringify(sel)); } catch { /* 무시 */ } buildDeck(); render(); }) : null,
      counts, h('div', { class: 'sp' }),
      h('button', { class: 'tool-ic', 'aria-label': '섞기', title: '섞기', onclick: () => { shuffle(deck.order); deck.pos = 0; deck.save(); render(); toast('문제를 섞었습니다'); } }, icon('shuffle')),
      h('button', { class: 'tool-ic', 'aria-label': '원래 순서', title: '원래 순서', onclick: () => { deck.order = scope.slice(); deck.pos = 0; deck.save(); render(); toast('원래 순서로 되돌렸습니다'); } }, icon('restore')),
      recBtn);
    const stage = h('section', { class: 'stage' });
    el.append(toolbar, bar, stage);

    // ── 상태 ──
    let phase = 'ask';
    let pad = null;
    let rec = null; // 열린 기록 서랍
    const rem = () => deck.order.filter((c) => !status.has(c));
    const cur = () => { const r = rem(); if (deck.pos >= r.length) deck.pos = 0; return r[deck.pos]; };

    function record(ok) {
      const c = cur(); if (!c) return;
      setStatus(ctx.pool, mode, c, ok ? 'ok' : 'no');
      deck.hist.push(c); deck.save();
      stage.classList.remove('nx'); void stage.offsetWidth; stage.classList.add('nx');
      render();
    }
    function back() {
      if (!deck.hist.length) { toast('되돌릴 문제가 없습니다'); return; }
      const c = deck.hist.pop();
      setStatus(ctx.pool, mode, c, null);
      deck.pos = Math.max(0, rem().indexOf(c)); deck.save(); render();
    }
    function skip() {
      const r = rem(); if (r.length <= 1) { toast('건너뛸 다른 문제가 없습니다'); return; }
      deck.pos = (deck.pos + 1) % r.length; deck.save(); render();
    }

    // ── 진행 ──
    function renderCounts() {
      const ok = scope.filter((c) => status.get(c) === 'ok').length;
      const no = scope.filter((c) => status.get(c) === 'no').length;
      counts.replaceChildren(
        h('span', {}, h('b', {}, scope.length - ok - no), ' 남음'),
        h('span', { class: 'ok' }, h('b', {}, ok), ' 맞음'),
        h('span', { class: 'no' }, h('b', {}, no), ' 틀림'));
      const t = scope.length || 1;
      bar.children[0].style.width = `${(ok / t) * 100}%`;
      bar.children[1].style.width = `${(no / t) * 100}%`;
      recBtn.classList.toggle('dot', ok + no > 0);
    }

    // ── 카드 ──
    function renderStage() {
      phase = 'ask';
      const r = rem();
      if (!r.length) {
        const wrong = scope.filter((c) => status.get(c) === 'no').length;
        stage.replaceChildren(h('div', { class: 'q-done' },
          h('div', { class: 'emo' }, '🎉'), h('h2', {}, '한 바퀴를 다 풀었습니다'),
          h('div', { class: 'sub' }, `맞음 ${scope.length - wrong} · 틀림 ${wrong}`),
          h('div', { class: 'row' },
            wrong ? h('button', { class: 'btn', onclick: retryWrong }, `틀린 ${wrong}개 다시`) : null,
            h('button', { class: 'btn ghost', onclick: openRecords }, '기록 보기'))));
        return;
      }
      const c = cmap.get(cur());
      ctx.here = `${c.ch} ${c.reading || ''}`.trim();
      const hn = hint(hints.get(c.ch));
      const meta = h('div', { class: 'card-meta' },
        h('span', { class: 'idx' }, `${deck.pos + 1}`, h('i', {}, ` / ${r.length}`)),
        h('div', { class: 'meta-act' }, hn.btn,
          h('button', { class: 'tool-ic sm', 'aria-label': '이전 문제', title: '이전 문제', disabled: !deck.hist.length, onclick: back }, icon('undo', 'icon s')),
          h('button', { class: 'tool-ic sm', 'aria-label': '건너뛰기', title: '건너뛰기', onclick: skip }, icon('skip', 'icon s'))));

      if (mode === 'r') {
        const input = h('input', { class: 'ans-in', placeholder: '훈과 음을 입력하세요', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
        const verdict = h('div', { class: 'verdict' });
        const flip = h('div', { class: 'flip' },
          h('div', { class: 'face front' }, meta, h('div', { class: 'glyph' }, c.ch), hn.panel),
          h('div', { class: 'face back' }, h('div', { class: 'reading' }, readingText(c)), verdict));
        const submit = () => {
          if (phase !== 'ask') return;
          const ok = matchReading(input.value, c);
          verdict.className = 'verdict ' + (ok ? 'ok' : 'no');
          verdict.textContent = ok ? '정답과 일치합니다' : (input.value.trim() ? `입력 · ${input.value.trim()}` : '입력 없음');
          flip.classList.add('on'); phase = 'shown'; input.blur();
          actions.replaceChildren(...gradeBtns(ok));
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
        const actions = h('div', { class: 'stage-act' }, h('div', { class: 'ans' }, input, h('button', { class: 'ans-go', 'aria-label': '확인', onclick: submit }, icon('right'))));
        stage.replaceChildren(h('div', { class: 'scene' }, flip), actions);
        setTimeout(() => { if (alive && document.contains(input)) input.focus({ preventScroll: true }); }, 60);
      } else {
        const card = h('div', { class: 'qcard rcard' }, meta,
          h('div', { class: 'reading' }, readingText(c)),
          h('div', { class: 'glyph reveal' }, c.ch), hn.panel);
        pad?.destroy(); pad = pencilPad();
        const reveal = () => {
          if (phase !== 'ask') return;
          card.classList.add('on'); pad.ghost(c.ch); phase = 'shown';
          actions.replaceChildren(...gradeBtns(null));
        };
        const actions = h('div', { class: 'stage-act' }, h('button', { class: 'btn ink', onclick: reveal }, '정답 보기'));
        stage.replaceChildren(h('div', { class: 'h-row' }, card, pad.el), actions);
      }
    }
    function gradeBtns(ok) {
      return [
        h('button', { class: 'gbtn no' + (ok === false ? ' hint' : ''), onclick: () => record(false) }, icon('x', 'icon s'), '틀림', h('kbd', {}, '←')),
        h('button', { class: 'gbtn ok' + (ok === true ? ' hint' : ''), onclick: () => record(true) }, icon('check', 'icon s'), '맞음', h('kbd', {}, '→')),
      ];
    }

    // ── 기록 서랍 ──
    let filter = 'all';
    const picked = new Set();
    function openRecords() {
      const body = h('div', { class: 'rec' });
      rec = { body, d: drawer({ title: '기록', body, onClose: () => { rec = null; picked.clear(); } }) };
      drawRecords();
    }
    function drawRecords() {
      if (!rec) return;
      const ok = scope.filter((c) => status.get(c) === 'ok');
      const no = scope.filter((c) => status.get(c) === 'no');
      const list = filter === 'ok' ? ok : filter === 'no' ? no : [...no, ...ok];
      [...picked].forEach((c) => { if (!list.includes(c)) picked.delete(c); });
      const tab = (v, label, n) => h('button', { class: v === filter ? 'on' : '', onclick: () => { filter = v; picked.clear(); drawRecords(); } }, label, h('b', {}, n));
      rec.body.replaceChildren(...[
        h('div', { class: 'segc full' }, tab('all', '전체', ok.length + no.length), tab('no', '틀림', no.length), tab('ok', '맞음', ok.length)),
        list.length
          ? h('div', { class: 'rec-grid' }, list.map((c) => h('button', {
            class: 'rc ' + status.get(c) + (picked.has(c) ? ' sel' : ''),
            onclick: () => { picked.has(c) ? picked.delete(c) : picked.add(c); drawRecords(); },
          }, h('span', { class: 'g' }, c), h('span', { class: 'u' }, cmap.get(c)?.readings[0] || ''))))
          : h('div', { class: 'rec-empty' }, '기록이 없습니다'),
        picked.size ? h('div', { class: 'selbar' }, h('span', {}, `${picked.size}개`),
          filter !== 'no' ? h('button', { onclick: () => move('no') }, '틀림으로') : null,
          filter !== 'ok' ? h('button', { onclick: () => move('ok') }, '맞음으로') : null,
          h('button', { onclick: () => move(null) }, '지우기')) : null,
        h('div', { class: 'rec-foot' },
          h('button', { class: 'btn', onclick: () => { rec.d.close(); retryWrong(); } }, '틀린 문제만 다시'),
          h('button', { class: 'btn ghost', onclick: resetAll }, sel.length ? '고른 단원 리셋' : '전체 리셋')),
      ].filter(Boolean));
    }
    function move(st) {
      const list = [...picked]; picked.clear();
      setStatus(ctx.pool, mode, list, st);
      render(); toast('적용했습니다');
    }
    function retryWrong() {
      const no = scope.filter((c) => status.get(c) === 'no');
      if (!no.length) { toast('틀린 문제가 없습니다'); return; }
      setStatus(ctx.pool, mode, no, null);
      deck.order = [...no, ...deck.order.filter((c) => !no.includes(c))];
      deck.pos = 0; deck.save(); render(); toast(`틀린 ${no.length}개를 다시 풉니다`);
    }
    let armed = false;
    function resetAll(e) {
      const btn = e.currentTarget;
      if (!armed) { armed = true; const t = btn.textContent; btn.textContent = '한 번 더 누르면 리셋'; setTimeout(() => { armed = false; if (document.contains(btn)) btn.textContent = t; }, 2500); return; }
      armed = false;
      const done = scope.filter((c) => status.has(c));
      if (done.length) setStatus(ctx.pool, mode, done, null);
      deck.hist = []; deck.pos = 0; deck.save(); render(); toast('초기화했습니다');
    }

    function render() { renderCounts(); renderStage(); drawRecords(); }
    // 통계에서 '틀린 것 다시 풀기'로 들어온 경우
    if (ctx.retry) { ctx.retry = false; render(); retryWrong(); } else render();

    // ── 단축키 ──
    const onKey = (e) => {
      if (document.querySelector('.modal-wrap, .drawer.on, .pop')) return;
      const tag = (e.target.tagName || '').toUpperCase();
      if (phase === 'ask') {
        if (mode === 'h' && (e.key === ' ' || e.key === 'Enter') && tag !== 'INPUT') { e.preventDefault(); stage.querySelector('.stage-act .btn')?.click(); }
        return;
      }
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); record(false); }
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); record(true); }
    };
    document.addEventListener('keydown', onKey);
    offs.push(() => document.removeEventListener('keydown', onKey), () => { rec?.d.close(); pad?.destroy(); });
  })();

  return () => { alive = false; offs.forEach((f) => f()); };
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
