import { h, icon, toast, seg } from '../ui.js';
import { loadCards, uniqueCards, readingText, matchReading } from '../data/hanja.js';
import { loadJung, loadWordbook, wbAdd, wbRemove, wbResult } from '../data/study.js';
import { pencilPad } from './pencil.js';

// ─────────────────────────────────────────────
// 단어장 (과목별) : 담기 → 시험 → 결과
// ─────────────────────────────────────────────
export function wordbook(ctx, el) {
  let alive = true;
  let pad = null;
  let offKey = null;
  el.append(h('div', { class: 'q-skel' },
    h('div', { class: 'bar' }, h('i', { class: 'skel', style: { width: '160px' } })),
    h('div', { class: 'wb-sk' }, h('i', { class: 'skel' }), h('i', { class: 'skel' })),
    h('i', { class: 'skel ox-sk' })));

  (async () => {
    const [{ cards, units }, wb] = await Promise.all([loadCards(ctx.range.id), loadWordbook(ctx.subject.id)]);
    const lines = units.length ? [] : await loadJung(ctx.range.id).catch(() => []);
    if (!alive) return;

    const all = uniqueCards(cards, []);
    const cmap = new Map(all.map((c) => [c.ch, c]));
    // 묶음 : 엄한문은 단원, 정한문은 쪽
    const groups = [];
    if (units.length) {
      units.forEach((u) => { const cs = uniqueCards(cards, [u.id]).map((c) => c.ch); if (cs.length) groups.push({ id: u.id, label: u.label, chars: cs }); });
    } else {
      const used = new Set();
      lines.forEach((g) => {
        const cs = [];
        g.lines.forEach((l) => [...(l.hanja || '')].forEach((c) => { if (cmap.has(c) && !cs.includes(c)) { cs.push(c); used.add(c); } }));
        if (cs.length) groups.push({ id: g.id, label: /^\d+$/.test(g.page) ? `문장 ${g.page}` : g.page, chars: cs });
      });
      const rest = all.map((c) => c.ch).filter((c) => !used.has(c));
      if (rest.length) groups.push({ id: 'etc', label: groups.length ? '기타' : '전체', chars: rest });
    }
    const valid = (c) => cmap.has(c);
    const inList = (c) => wb.has(c);
    const mine = () => [...wb.keys()].filter(valid);

    let mode = localStorage.getItem('kmed:wb-mode') || 'r';
    let range = 'all';
    let shuf = localStorage.getItem('kmed:wb-shuf') !== '0';
    const homeSel = new Set();

    function swap(nodes) {
      pad?.destroy(); pad = null; offKey?.(); offKey = null;
      el.replaceChildren(...nodes.filter(Boolean));
      el.classList.remove('q-in'); void el.offsetWidth; el.classList.add('q-in');
      window.scrollTo({ top: 0 });
    }
    const cell = (c, cls = '', on) => h('button', { class: `hc wc ${wb.get(c) || ''} ${cls}`, onclick: on },
      h('div', { class: 'h' }, c), h('div', { class: 'u' }, cmap.get(c)?.readings[0] || ''));

    // ── 홈 ──
    function home() {
      const list = mine();
      if (!list.length) {
        swap([h('div', { class: 'wb-empty' },
          h('div', { class: 'emo' }, '📒'), h('h2', {}, '아직 담은 한자가 없습니다'),
          h('button', { class: 'btn ink', onclick: pick }, icon('plus', 'icon s'), '한자 담기'))]);
        return;
      }
      [...homeSel].forEach((c) => { if (!inList(c)) homeSel.delete(c); });
      const ok = list.filter((c) => wb.get(c) === 'ok').length;
      const no = list.filter((c) => wb.get(c) === 'no').length;
      const nw = list.length - ok - no;
      if ((range === 'no' && !no) || (range === 'new' && !nw)) range = 'all';
      const pool = () => (range === 'no' ? list.filter((c) => wb.get(c) === 'no') : range === 'new' ? list.filter((c) => !wb.get(c)) : list);
      const startBtn = h('button', { class: 'btn ink', onclick: () => test(pool()) });
      const paintStart = () => startBtn.replaceChildren(`시험 시작 · ${pool().length}문제`);
      paintStart();

      const grid = h('div', { class: 'wb-groups' });
      const selbar = h('div', { class: 'selbar wb-sel' });
      const drawList = () => {
        const shown = new Set();
        grid.replaceChildren(...groups.map((g) => {
          const cs = g.chars.filter((c) => inList(c) && !shown.has(c)); if (!cs.length) return null;
          cs.forEach((c) => shown.add(c));
          return h('div', { class: 'wb-g' }, h('div', { class: 'wb-gh' }, h('b', {}, g.label), h('span', {}, `${cs.length}자`)),
            h('div', { class: 'hg' }, cs.map((c) => cell(c, homeSel.has(c) ? 'sel' : '', () => { homeSel.has(c) ? homeSel.delete(c) : homeSel.add(c); drawList(); }))));
        }).filter(Boolean));
        selbar.style.display = homeSel.size ? '' : 'none';
        selbar.replaceChildren(h('span', {}, `${homeSel.size}자`),
          h('button', { onclick: () => { homeSel.clear(); drawList(); } }, '해제'),
          h('button', { onclick: () => test(list.filter((c) => homeSel.has(c))) }, '이것만 시험'),
          h('button', { onclick: () => { const n = homeSel.size; wbRemove(ctx.subject.id, wb, [...homeSel]); homeSel.clear(); home(); toast(`${n}자를 뺐습니다`); } }, '빼기'));
      };
      drawList();

      swap([
        h('div', { class: 'q-bar' }, h('div', { class: 'q-counts' },
          h('span', {}, h('b', {}, list.length), ' 담음'), h('span', { class: 'ok' }, h('b', {}, ok), ' 맞음'), h('span', { class: 'no' }, h('b', {}, no), ' 틀림')),
        h('div', { class: 'sp' }), h('button', { class: 'tool-pill', onclick: pick }, icon('plus', 'icon s'), h('span', {}, '한자 담기'))),
        h('section', { class: 'wb-test' },
          h('div', { class: 'f' }, h('label', {}, '방식'), seg([['r', '한자 → 훈음'], ['h', '훈음 → 한자']], mode, (v) => { mode = v; try { localStorage.setItem('kmed:wb-mode', v); } catch { /* 무시 */ } })),
          h('div', { class: 'f' }, h('label', {}, '범위'), seg([['all', `전체 ${list.length}`], ...(no ? [['no', `틀린 것 ${no}`]] : []), ...(nw ? [['new', `안 본 것 ${nw}`]] : [])], range, (v) => { range = v; paintStart(); })),
          h('div', { class: 'f' }, h('label', {}, '순서'), seg([['1', '섞기'], ['0', '그대로']], shuf ? '1' : '0', (v) => { shuf = v === '1'; try { localStorage.setItem('kmed:wb-shuf', v); } catch { /* 무시 */ } })),
          startBtn),
        grid, selbar]);
    }

    // ── 담기 ──
    function pick() {
      let q = '';
      const count = h('span', { class: 'wb-cnt' });
      const body = h('div', { class: 'wb-groups' });
      const draw = () => {
        const nq = q.replace(/\s+/g, '');
        const hit = (c) => !nq || c.includes(nq) || (cmap.get(c)?.readings.join(' ') || '').replace(/\s+/g, '').includes(nq);
        count.textContent = `담은 한자 ${mine().length}자`;
        const out = groups.map((g) => {
          const cs = g.chars.filter(hit); if (!cs.length) return null;
          const a = g.chars.filter(inList).length; const full = a === g.chars.length;
          return h('div', { class: 'wb-g' },
            h('div', { class: 'wb-gh' }, h('b', {}, g.label), h('span', {}, `${a} / ${g.chars.length}`),
              h('button', { class: 'txt-btn', onclick: () => { full ? wbRemove(ctx.subject.id, wb, g.chars) : wbAdd(ctx.subject.id, wb, g.chars); draw(); } }, full ? '모두 빼기' : '모두 담기')),
            h('div', { class: 'hg' }, cs.map((c) => cell(c, inList(c) ? 'in' : 'out', () => { inList(c) ? wbRemove(ctx.subject.id, wb, [c]) : wbAdd(ctx.subject.id, wb, [c]); draw(); }))));
        }).filter(Boolean);
        body.replaceChildren(...(out.length ? out : [h('div', { class: 'box-empty' }, '검색 결과가 없습니다')]));
      };
      const search = h('input', { type: 'search', placeholder: '한자 · 훈 · 음 검색' });
      search.addEventListener('input', () => { q = search.value.trim(); draw(); });
      draw();
      swap([h('div', { class: 'q-bar' },
        h('button', { class: 'tool-pill', onclick: home }, icon('back', 'icon s'), h('span', {}, '단어장')),
        h('label', { class: 'srch' }, icon('search', 'icon s'), search), count, h('div', { class: 'sp' }),
        h('button', { class: 'btn sm ink', onclick: home }, '완료')), body]);
    }

    // ── 시험 ──
    function test(chars) {
      if (!chars.length) { toast('시험볼 한자가 없습니다'); return; }
      const T = { queue: shuf ? shuffle(chars.slice()) : chars.slice(), pos: 0, ok: [], no: [], hist: [], mode };
      const counter = h('div', { class: 'q-counts' });
      const bar = h('div', { class: 'q-prog' }, h('i', { class: 'ok' }), h('i', { class: 'no' }));
      const stage = h('section', { class: 'stage' });
      let phase = 'ask';
      swap([h('div', { class: 'q-bar' },
        h('button', { class: 'tool-pill', onclick: quit }, icon('x', 'icon s'), h('span', {}, '그만하기')),
        counter, h('div', { class: 'sp' })), bar, stage]);

      function quit() { if (!T.hist.length) home(); else result(T); }
      function back() {
        const x = T.hist.pop(); if (!x) return;
        (x.ok ? T.ok : T.no).pop();
        wbResult(ctx.subject.id, wb, x.c, x.prev);
        T.pos--; draw();
      }
      function record(ok) {
        if (phase !== 'shown') return;
        const c = T.queue[T.pos];
        (ok ? T.ok : T.no).push(c); T.hist.push({ c, ok, prev: wb.get(c) ?? null });
        wbResult(ctx.subject.id, wb, c, ok ? 'ok' : 'no');
        T.pos++;
        if (T.pos >= T.queue.length) { result(T); return; }
        stage.classList.remove('nx'); void stage.offsetWidth; stage.classList.add('nx');
        draw();
      }
      function draw() {
        phase = 'ask';
        const c = cmap.get(T.queue[T.pos]);
        const n = T.queue.length;
        counter.replaceChildren(h('span', {}, h('b', {}, T.pos + 1), ` / ${n}`),
          h('span', { class: 'ok' }, h('b', {}, T.ok.length), ' 맞음'), h('span', { class: 'no' }, h('b', {}, T.no.length), ' 틀림'));
        bar.children[0].style.width = `${(T.ok.length / n) * 100}%`;
        bar.children[1].style.width = `${(T.no.length / n) * 100}%`;
        const meta = h('div', { class: 'card-meta' }, h('span', { class: 'idx' }, `${T.pos + 1}`, h('i', {}, ` / ${n}`)),
          h('div', { class: 'meta-act' }, h('button', { class: 'tool-ic sm', title: '이전 문제', 'aria-label': '이전 문제', disabled: !T.hist.length, onclick: back }, icon('undo', 'icon s'))));
        const grades = (ok) => [
          h('button', { class: 'gbtn no' + (ok === false ? ' hint' : ''), onclick: () => record(false) }, icon('x', 'icon s'), '틀림', h('kbd', {}, '←')),
          h('button', { class: 'gbtn ok' + (ok === true ? ' hint' : ''), onclick: () => record(true) }, icon('check', 'icon s'), '맞음', h('kbd', {}, '→'))];
        if (T.mode === 'r') {
          const input = h('input', { class: 'ans-in', placeholder: '훈과 음을 입력하세요', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
          const verdict = h('div', { class: 'verdict' });
          const flip = h('div', { class: 'flip' },
            h('div', { class: 'face front' }, meta, h('div', { class: 'glyph' }, c.ch)),
            h('div', { class: 'face back' }, h('div', { class: 'reading' }, readingText(c)), verdict));
          const actions = h('div', { class: 'stage-act' });
          const submit = () => {
            if (phase !== 'ask') return;
            const ok = matchReading(input.value, c);
            verdict.className = 'verdict ' + (ok ? 'ok' : 'no');
            verdict.textContent = ok ? '정답과 일치합니다' : (input.value.trim() ? `입력 · ${input.value.trim()}` : '입력 없음');
            flip.classList.add('on'); phase = 'shown'; input.blur();
            actions.replaceChildren(...grades(ok));
          };
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
          actions.append(h('div', { class: 'ans' }, input, h('button', { class: 'ans-go', 'aria-label': '확인', onclick: submit }, icon('right'))));
          stage.replaceChildren(h('div', { class: 'scene' }, flip), actions);
          setTimeout(() => { if (document.contains(input)) input.focus({ preventScroll: true }); }, 60);
        } else {
          const card = h('div', { class: 'qcard rcard' }, meta, h('div', { class: 'reading' }, readingText(c)), h('div', { class: 'glyph reveal' }, c.ch));
          pad?.destroy(); pad = pencilPad();
          const actions = h('div', { class: 'stage-act' });
          const reveal = () => { if (phase !== 'ask') return; card.classList.add('on'); pad.ghost(c.ch); phase = 'shown'; actions.replaceChildren(...grades(null)); };
          actions.append(h('button', { class: 'btn ink', onclick: reveal }, '정답 보기'));
          stage.reveal = reveal;
          stage.replaceChildren(h('div', { class: 'h-row' }, card, pad.el), actions);
        }
      }
      const onKey = (e) => {
        if (document.querySelector('.modal-wrap, .drawer.on, .pop')) return;
        const tag = (e.target.tagName || '').toUpperCase();
        if (phase === 'ask') { if (T.mode === 'h' && (e.key === ' ' || e.key === 'Enter') && tag !== 'INPUT') { e.preventDefault(); stage.reveal?.(); } return; }
        if (tag === 'INPUT') return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); record(false); }
        else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); record(true); }
      };
      draw();
      document.addEventListener('keydown', onKey);
      offKey = () => document.removeEventListener('keydown', onKey);
    }

    // ── 결과 ──
    function result(T) {
      const done = T.hist.length; const ok = T.ok.length; const no = T.no.length;
      const pct = done ? Math.round((ok / done) * 100) : 0;
      const sel = new Set();
      const grid = h('div', { class: 'wb-groups' });
      const selbar = h('div', { class: 'selbar wb-sel' });
      const drawRes = () => {
        const part = (label, arr, cls) => (arr.length ? h('div', { class: 'wb-g' }, h('div', { class: 'wb-gh ' + cls }, h('b', {}, label), h('span', {}, `${arr.length}자`)),
          h('div', { class: 'hg' }, arr.map((c) => cell(c, (inList(c) ? '' : 'gone') + (sel.has(c) ? ' sel' : ''), () => {
            if (!inList(c)) { wbAdd(ctx.subject.id, wb, [c]); toast(`${c} 다시 담았습니다`); drawRes(); return; }
            sel.has(c) ? sel.delete(c) : sel.add(c); drawRes();
          })))) : null);
        grid.replaceChildren(...[part('틀린 한자', T.no, 'no'), part('맞은 한자', T.ok, 'ok')].filter(Boolean));
        selbar.style.display = sel.size ? '' : 'none';
        selbar.replaceChildren(h('span', {}, `${sel.size}자`), h('button', { onclick: () => { sel.clear(); drawRes(); } }, '해제'),
          h('button', { onclick: () => { const n = sel.size; wbRemove(ctx.subject.id, wb, [...sel]); sel.clear(); drawRes(); toast(`${n}자를 단어장에서 뺐습니다`); } }, '단어장에서 빼기'));
      };
      drawRes();
      swap([
        h('section', { class: 'wb-res' },
          h('div', { class: 'emo' }, pct === 100 ? '🏆' : pct >= 80 ? '🎉' : pct >= 50 ? '💪' : '📚'),
          h('div', { class: 'pct' }, `${pct}%`),
          h('div', { class: 'sub' }, `${done}문제 중 ${ok}개 맞음${done < T.queue.length ? ` · ${T.queue.length - done}문제 남음` : ''}`),
          h('div', { class: 'row' },
            no ? h('button', { class: 'btn ink', onclick: () => test(T.no.filter(inList)) }, `틀린 ${no}자 다시`) : null,
            h('button', { class: 'btn ghost', onclick: () => test([...T.ok, ...T.no].filter(inList)) }, '다시 시험'),
            h('button', { class: 'btn ghost', onclick: home }, '단어장으로')),
          ok ? h('button', { class: 'txt-btn', onclick: () => { T.ok.filter(inList).forEach((c) => sel.add(c)); drawRes(); } }, '맞은 한자 모두 고르기') : null),
        grid, selbar]);
    }

    home();
  })();

  return () => { alive = false; pad?.destroy(); offKey?.(); };
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
