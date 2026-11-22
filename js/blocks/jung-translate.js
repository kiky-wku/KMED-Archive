import { h, icon, toast, drawer } from '../ui.js';
import { deckState } from '../data/hanja.js';
import { loadJung, loadItems, saveItem, clearItems } from '../data/study.js';
import { hint } from './hint.js';

// ─────────────────────────────────────────────
// 정한문 해석 쓰기 : 원문 한 쪽씩 → 내 해석 → 정답 확인 → 맞음/틀림
// ─────────────────────────────────────────────
const KIND = 'jung';

export function jungTranslate(ctx, el) {
  let alive = true;
  const offs = [];
  el.append(h('div', { class: 'q-skel' },
    h('div', { class: 'bar' }, h('i', { class: 'skel', style: { width: '200px' } })),
    h('div', { class: 'jt-skel' }, h('i', { class: 'skel' }), h('i', { class: 'skel' }))));

  (async () => {
    const [groups, items] = await Promise.all([loadJung(ctx.range.id), loadItems(KIND)]);
    if (!alive) return;
    el.replaceChildren();
    el.classList.add('q-in');
    if (!groups.length) { el.append(h('div', { class: 'empty' }, '등록된 해석 문제가 없습니다')); return; }

    const ids = groups.map((g) => g.id);
    const byId = new Map(groups.map((g) => [g.id, g]));
    const deck = deckState(`jung:${ctx.range.id}`, ids);
    const st = (id) => items.get(id)?.status || null;

    // ── 뼈대 ──
    const counts = h('div', { class: 'q-counts' });
    const bar = h('div', { class: 'q-prog' }, h('i', { class: 'ok' }), h('i', { class: 'no' }));
    const recBtn = h('button', { class: 'tool-ic rec-btn', title: '기록', 'aria-label': '기록', onclick: openRecords }, icon('list'));
    el.append(
      h('div', { class: 'q-bar' }, counts, h('div', { class: 'sp' }),
        h('button', { class: 'tool-ic', title: '섞기', 'aria-label': '섞기', onclick: () => { shuffle(deck.order); deck.pos = 0; deck.save(); render(); toast('순서를 섞었습니다'); } }, icon('shuffle')),
        h('button', { class: 'tool-ic', title: '원래 순서', 'aria-label': '원래 순서', onclick: () => { deck.order = ids.slice(); deck.pos = 0; deck.save(); render(); toast('원래 순서로 되돌렸습니다'); } }, icon('restore')),
        recBtn),
      bar);
    const stage = h('section', { class: 'jt-stage' });
    el.append(stage);

    let shown = false;
    const cur = () => byId.get(deck.order[Math.min(deck.pos, deck.order.length - 1)]);

    function renderCounts() {
      const ok = ids.filter((i) => st(i) === 'ok').length;
      const no = ids.filter((i) => st(i) === 'no').length;
      counts.replaceChildren(
        h('span', {}, h('b', {}, ids.length - ok - no), ' 남음'),
        h('span', { class: 'ok' }, h('b', {}, ok), ' 맞음'),
        h('span', { class: 'no' }, h('b', {}, no), ' 틀림'));
      bar.children[0].style.width = `${(ok / ids.length) * 100}%`;
      bar.children[1].style.width = `${(no / ids.length) * 100}%`;
      recBtn.classList.toggle('dot', ok + no > 0);
    }

    function go(d) {
      const n = deck.pos + d;
      if (n < 0 || n >= deck.order.length) return;
      deck.pos = n; deck.save();
      stage.classList.remove('nx', 'go-prev'); void stage.offsetWidth; stage.classList.add(d > 0 ? 'nx' : 'go-prev');   // 'pv' 는 PDF 보기 화면 이름이라 쓰면 안 됨
      renderStage();
    }

    function renderStage() {
      shown = false;
      const g = cur();
      const it = items.get(g.id);
      const s = st(g.id);
      const ta = h('textarea', { class: 'jt-in', placeholder: '해석을 적어보세요', spellcheck: 'false' });
      ta.value = it?.data?.t || '';
      ta.addEventListener('input', () => saveItem(KIND, items, g.id, { data: { t: ta.value } }, 700));
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); reveal(); } });

      ctx.here = g.lines.map((l) => l.hanja).join(' ').slice(0, 120);
      const hn = hint(g.hint);
      const meta = h('div', { class: 'jt-meta' },
        h('span', { class: 'idx' }, `${deck.pos + 1}`, h('i', {}, ` / ${deck.order.length}`)),
        s ? h('span', { class: 'st ' + s }, s === 'ok' ? '맞음' : '틀림') : null,
        h('div', { class: 'meta-act' }, hn.btn,
          h('button', { class: 'tool-ic sm', title: '이전', 'aria-label': '이전', disabled: deck.pos === 0, onclick: () => go(-1) }, icon('back', 'icon s')),
          h('button', { class: 'tool-ic sm', title: '다음', 'aria-label': '다음', disabled: deck.pos >= deck.order.length - 1, onclick: () => go(1) }, icon('right', 'icon s'))));

      const ask = h('div', { class: 'jt-card jt-q' }, meta,
        h('div', { class: 'jt-han' }, g.lines.map((l) => h('p', {}, l.hanja))),
        hn.panel,
        h('div', { class: 'jt-div' }),
        ta);
      const ans = h('div', { class: 'jt-card jt-a' },
        h('button', { class: 'jt-reveal', onclick: reveal }, icon('eye'), h('span', {}, '정답 확인'), h('kbd', {}, '⌘ Enter')));
      const act = h('div', { class: 'stage-act jt-act' });

      function reveal() {
        if (shown) return; shown = true;
        const notes = g.lines.flatMap((l) => l.notes || []);
        const point = notes.filter((n) => /^\s*→/.test(n));
        const bullets = notes.filter((n) => !/^\s*→/.test(n));
        ans.classList.add('on');
        ans.replaceChildren(h('div', { class: 'jt-ans' },
          g.lines.map((l) => h('div', { class: 'jt-line' },
            h('div', { class: 'hj' }, l.hanja),
            l.eum ? h('div', { class: 'eu' }, l.eum) : null,
            h('div', { class: 'tr' }, l.translation))),
          bullets.length ? h('ul', { class: 'jt-notes' }, bullets.map((n) => h('li', {}, n))) : null,
          point.map((n) => h('div', { class: 'jt-point' }, n.replace(/^\s*→\s*/, '')))));
        act.replaceChildren(
          h('button', { class: 'gbtn no', onclick: () => grade(false) }, icon('x', 'icon s'), '틀림', h('kbd', {}, '←')),
          h('button', { class: 'gbtn ok', onclick: () => grade(true) }, icon('check', 'icon s'), '맞음', h('kbd', {}, '→')));
      }
      stage.reveal = reveal;
      stage.replaceChildren(h('div', { class: 'jt-grid' }, ask, ans), act);
    }

    function grade(ok) {
      const g = cur();
      saveItem(KIND, items, g.id, { status: ok ? 'ok' : 'no' }, 0);
      renderCounts(); drawRecords();
      if (deck.pos < deck.order.length - 1) go(1);
      else { renderStage(); toast('마지막 문제입니다'); }
    }

    // ── 기록 서랍 ──
    let rec = null;
    function openRecords() {
      const body = h('div', { class: 'rec' });
      rec = { body, d: drawer({ title: '기록', body, onClose: () => { rec = null; } }) };
      drawRecords();
    }
    function drawRecords() {
      if (!rec) return;
      const wrong = ids.filter((i) => st(i) === 'no').length;
      rec.body.replaceChildren(
        h('div', { class: 'jt-rec' }, deck.order.map((id, i) => {
          const g = byId.get(id);
          return h('button', { class: 'jr ' + (st(id) || '') + (i === deck.pos ? ' cur' : ''), onclick: () => { deck.pos = i; deck.save(); rec.d.close(); renderStage(); } },
            h('b', {}, i + 1), h('span', {}, g.lines[0].hanja.slice(0, 4)));
        })),
        h('div', { class: 'rec-foot' },
          h('button', { class: 'btn', disabled: !wrong, onclick: () => { rec.d.close(); retryWrong(); } }, wrong ? `틀린 ${wrong}개부터` : '틀린 문제 없음'),
          h('button', { class: 'btn ghost', onclick: resetAll }, '전체 리셋')));
    }
    function retryWrong() {
      const no = ids.filter((i) => st(i) === 'no');
      deck.order = [...no, ...deck.order.filter((i) => !no.includes(i))];
      deck.pos = 0; deck.save(); render(); toast('틀린 문제부터 다시 풉니다');
    }
    let armed = false;
    function resetAll(e) {
      const btn = e.currentTarget;
      if (!armed) { armed = true; const t = btn.textContent; btn.textContent = '한 번 더 누르면 리셋'; setTimeout(() => { armed = false; if (document.contains(btn)) btn.textContent = t; }, 2500); return; }
      armed = false;
      clearItems(KIND, items, ids.filter((i) => items.has(i)));
      deck.pos = 0; deck.save(); render(); toast('해석과 기록을 지웠습니다');
    }

    function render() { renderCounts(); renderStage(); drawRecords(); }
    // 통계에서 '틀린 것 다시 풀기'로 들어온 경우
    if (ctx.retry) { ctx.retry = false; render(); retryWrong(); } else render();

    const onKey = (e) => {
      if (document.querySelector('.modal-wrap, .drawer.on, .pop')) return;
      const tag = (e.target.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (!shown) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); stage.reveal?.(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }   // 기본 동작(화면 밀기) 막기
        else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
        return;
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); grade(false); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); grade(true); }
    };
    document.addEventListener('keydown', onKey);
    offs.push(() => document.removeEventListener('keydown', onKey), () => rec?.d.close());
  })();

  return () => { alive = false; offs.forEach((f) => f()); };
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
