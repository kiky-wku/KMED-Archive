import { h, icon, toast } from '../ui.js';
import { loadCards, loadProgress, uniqueCards, readingText, matchReading, setStatus, deckState } from '../data/hanja.js';
import { pencilPad } from './pencil.js';

// ─────────────────────────────────────────────
// 한자 → 훈음 (mode 'r') / 훈음 → 한자 (mode 'h')
// ─────────────────────────────────────────────
export function hanjaQuiz(ctx, el, mode) {
  let alive = true;
  const offs = [];
  el.append(h('div', { class: 'loading' }, h('i')));

  (async () => {
    const [{ cards, units }, prog] = await Promise.all([loadCards(ctx.range.id), loadProgress(ctx.pool)]);
    if (!alive) return;
    el.replaceChildren();
    if (!cards.length) { el.append(h('div', { class: 'empty' }, '등록된 한자가 없습니다')); return; }
    const status = prog[mode];

    // ── 단원 선택 (여러 개) ──
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

    // ── 화면 뼈대 ──
    const unitBar = units.length ? h('div', { class: 'unit-bar' }) : null;
    const tools = h('div', { class: 'q-tools' },
      h('button', { class: 'mini', onclick: () => { shuffle(deck.order); deck.pos = 0; deck.save(); render(); toast('문제를 섞었습니다'); } }, '셔플'),
      h('button', { class: 'mini', onclick: () => { deck.order = scope.slice(); deck.pos = 0; deck.save(); render(); toast('원래 순서로 되돌렸습니다'); } }, '원래 순서'),
    );
    const quiz = h('section', { class: 'card q-card' });
    const panel = h('aside', { class: 'card q-panel' });
    el.append(h('div', { class: 'q-top' }, unitBar, tools), h('div', { class: 'q-grid' }, quiz, panel));

    function drawUnits() {
      if (!unitBar) return;
      const all = h('button', { class: 'chipt' + (sel.length ? '' : ' on'), onclick: () => { sel = []; changeUnits(); } }, '전체');
      unitBar.replaceChildren(all, ...units.map((u) => h('button', {
        class: 'chipt' + (sel.includes(u.id) ? ' on' : ''),
        onclick: () => { sel = sel.includes(u.id) ? sel.filter((x) => x !== u.id) : [...sel, u.id]; changeUnits(); },
      }, u.label)));
    }
    function changeUnits() {
      try { localStorage.setItem(selKey, JSON.stringify(sel)); } catch { /* 무시 */ }
      buildDeck(); drawUnits(); render();
    }
    drawUnits();

    // ── 상태 ──
    let phase = 'ask'; // ask → shown
    let filter = 'all';
    const picked = new Set();
    let pad = null;
    const rem = () => deck.order.filter((c) => !status.has(c));
    const cur = () => { const r = rem(); if (deck.pos >= r.length) deck.pos = 0; return r[deck.pos]; };

    function record(ok) {
      const c = cur(); if (!c) return;
      setStatus(ctx.pool, mode, c, ok ? 'ok' : 'no');
      deck.hist.push(c); deck.save();
      phase = 'ask'; render();
    }
    function back() {
      if (!deck.hist.length) { toast('되돌릴 문제가 없습니다'); return; }
      const c = deck.hist.pop();
      setStatus(ctx.pool, mode, c, null);
      deck.pos = Math.max(0, rem().indexOf(c)); deck.save();
      phase = 'ask'; render();
    }
    function skip() {
      const r = rem(); if (r.length <= 1) { toast('건너뛸 다른 문제가 없습니다'); return; }
      deck.pos = (deck.pos + 1) % r.length; deck.save(); phase = 'ask'; render();
    }

    // ── 문제 카드 ──
    function renderQuiz() {
      const r = rem();
      if (!r.length) {
        const wrong = scope.filter((c) => status.get(c) === 'no').length;
        quiz.replaceChildren(h('div', { class: 'q-done' },
          h('div', { class: 'emo' }, '🎉'), h('h2', {}, '한 바퀴 다 풀었습니다'),
          h('div', { class: 'sub' }, `맞음 ${scope.length - wrong} · 틀림 ${wrong}`),
          wrong ? h('button', { class: 'btn', onclick: retryWrong }, `틀린 ${wrong}개 다시`) : null));
        return;
      }
      const c = cmap.get(cur());
      const head = h('div', { class: 'q-head' },
        h('button', { class: 'mini', disabled: !deck.hist.length, onclick: back }, icon('back', 'icon s'), '이전'),
        h('button', { class: 'mini', onclick: skip }, '건너뛰기', icon('right', 'icon s')),
        h('span', { class: 'counter' }, `${deck.pos + 1} / ${r.length}`));

      if (mode === 'r') {
        const input = h('input', { class: 'input q-in', placeholder: '훈과 음', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
        const verdict = h('div', { class: 'verdict' });
        const flip = h('div', { class: 'flip' },
          h('div', { class: 'face front' }, h('div', { class: 'big-h' }, c.ch)),
          h('div', { class: 'face back' }, h('div', { class: 'big-r' }, readingText(c)), verdict));
        const submit = () => {
          if (phase !== 'ask') return;
          const ok = matchReading(input.value, c);
          verdict.className = 'verdict ' + (ok ? 'ok' : 'no');
          verdict.textContent = ok ? '정답과 일치합니다' : (input.value.trim() ? '입력과 다릅니다' : '입력 없음');
          flip.classList.add('on'); phase = 'shown'; input.blur();
          actions.replaceChildren(...gradeBtns(ok));
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
        const actions = h('div', { class: 'q-actions' }, input, h('button', { class: 'btn', onclick: submit }, '확인'));
        quiz.replaceChildren(head, h('div', { class: 'scene' }, flip), actions);
        setTimeout(() => { if (alive && document.contains(input)) input.focus({ preventScroll: true }); }, 60);
      } else {
        const hidden = h('div', { class: 'big-h reveal' }, c.ch);
        const card = h('div', { class: 'r-card' }, h('div', { class: 'big-r' }, readingText(c)), hidden);
        pad?.destroy(); pad = pencilPad();
        const reveal = () => {
          if (phase !== 'ask') return;
          card.classList.add('on'); pad.ghost(c.ch); phase = 'shown';
          actions.replaceChildren(...gradeBtns(null));
        };
        const actions = h('div', { class: 'q-actions' }, h('button', { class: 'btn', onclick: reveal }, '정답 보기'));
        quiz.replaceChildren(head, h('div', { class: 'h-row' }, card, pad.el), actions);
      }
    }
    function gradeBtns(ok) {
      const w = h('button', { class: 'btn grade no' + (ok === false ? ' hint' : ''), onclick: () => record(false) }, '틀림');
      const r = h('button', { class: 'btn grade ok' + (ok === true ? ' hint' : ''), onclick: () => record(true) }, '맞음');
      return [w, r];
    }

    // ── 오른쪽 : 진행 · 기록 ──
    function renderPanel() {
      const ok = scope.filter((c) => status.get(c) === 'ok');
      const no = scope.filter((c) => status.get(c) === 'no');
      const list = filter === 'ok' ? ok : filter === 'no' ? no : [...ok, ...no];
      [...picked].forEach((c) => { if (!list.includes(c)) picked.delete(c); });
      const chip = (v, label, n) => h('button', { class: 'fchip ' + v + (filter === v ? ' on' : ''), onclick: () => { filter = v; picked.clear(); renderPanel(); } }, label, h('b', {}, n));
      const grid = list.length
        ? h('div', { class: 'rv-grid' }, list.map((c) => h('button', {
          class: 'rv ' + status.get(c) + (picked.has(c) ? ' sel' : ''),
          onclick: () => { picked.has(c) ? picked.delete(c) : picked.add(c); renderPanel(); },
        }, h('span', { class: 'h' }, c), h('span', { class: 'u' }, cmap.get(c)?.readings[0] || ''))))
        : h('div', { class: 'rv-empty' }, '기록이 없습니다');
      const selBar = picked.size ? h('div', { class: 'selbar' }, h('span', {}, `${picked.size}개 선택`),
        filter !== 'no' ? h('button', { onclick: () => move('no') }, '틀림으로') : null,
        filter !== 'ok' ? h('button', { onclick: () => move('ok') }, '맞음으로') : null,
        h('button', { onclick: () => move(null) }, '기록 지우기')) : null;
      panel.replaceChildren(...[
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('b', {}, rem().length), h('span', {}, '남은 문제')),
          h('div', { class: 'stat ok' }, h('b', {}, ok.length), h('span', {}, '맞음')),
          h('div', { class: 'stat no' }, h('b', {}, no.length), h('span', {}, '틀림'))),
        h('div', { class: 'fchips' }, chip('all', '전체', ok.length + no.length), chip('ok', '맞음', ok.length), chip('no', '틀림', no.length)),
        grid, selBar,
        h('div', { class: 'p-foot' },
          h('button', { class: 'btn ghost sm', onclick: retryWrong }, '틀린 문제만 다시'),
          h('button', { class: 'btn ghost sm', onclick: resetAll }, sel.length ? '이 단원 리셋' : '전체 리셋')),
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
      deck.pos = 0; deck.save(); phase = 'ask'; render(); toast(`틀린 ${no.length}개를 다시 풉니다`);
    }
    let armed = false;
    function resetAll(e) {
      const btn = e.currentTarget;
      if (!armed) { armed = true; const t = btn.textContent; btn.textContent = '한 번 더 누르면 리셋'; setTimeout(() => { armed = false; if (document.contains(btn)) btn.textContent = t; }, 2500); return; }
      armed = false;
      const done = scope.filter((c) => status.has(c));
      if (done.length) setStatus(ctx.pool, mode, done, null);
      deck.hist = []; deck.pos = 0; deck.save(); phase = 'ask'; render(); toast('초기화했습니다');
    }

    function render() { phase = 'ask'; renderQuiz(); renderPanel(); }
    render();

    // ── 단축키 : 틀림 ← / 맞음 → Space Enter ──
    const onKey = (e) => {
      if (document.querySelector('.modal-wrap')) return;
      const tag = (e.target.tagName || '').toUpperCase();
      if (phase === 'ask') {
        if (mode === 'h' && (e.key === ' ' || e.key === 'Enter') && tag !== 'INPUT') { e.preventDefault(); quiz.querySelector('.q-actions .btn')?.click(); }
        return;
      }
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); record(false); }
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); record(true); }
    };
    document.addEventListener('keydown', onKey);
    offs.push(() => document.removeEventListener('keydown', onKey));
  })();

  return () => { alive = false; offs.forEach((f) => f()); };
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
