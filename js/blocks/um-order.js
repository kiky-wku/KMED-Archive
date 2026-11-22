import { h, icon, toast, seg } from '../ui.js';
import { loadCards } from '../data/hanja.js';
import { loadSentences, loadItems, saveItem, clearItems } from '../data/study.js';
import { unitPicker } from './units.js';

// ─────────────────────────────────────────────
// 엄한문 순서 맞추기 : 해석 순서대로 카드 누르기 → 채점 → 정답 순서 다시 보기
// ─────────────────────────────────────────────
const KIND = 'um_order';
const SPEED = { slow: 900, mid: 560, fast: 320 };

export function umOrder(ctx, el) {
  let alive = true;
  const offs = [];
  const timers = new Map();
  el.append(h('div', { class: 'q-skel' },
    h('div', { class: 'bar' }, h('i', { class: 'skel', style: { width: '130px' } }), h('i', { class: 'skel', style: { width: '220px' } })),
    h('i', { class: 'skel ox-sk' }), h('i', { class: 'skel ox-sk' })));

  (async () => {
    const [{ units }, sents, items] = await Promise.all([loadCards(ctx.range.id), loadSentences(ctx.range.id), loadItems(KIND)]);
    if (!alive) return;
    el.replaceChildren();
    el.classList.add('q-in');
    if (!sents.length) { el.append(h('div', { class: 'empty' }, '등록된 문장이 없습니다')); return; }

    const selKey = `kmed:units:${ctx.range.id}`;
    let sel = [];
    try { sel = JSON.parse(localStorage.getItem(selKey) || '[]').filter((u) => units.some((x) => x.id === u)); } catch { sel = []; }
    let filter = 'all';
    let speed = localStorage.getItem('kmed:speed') || 'mid';
    let order = null; // 섞은 순서 (id 배열)

    const st = (id) => items.get(id)?.status || null;
    const picksOf = (id) => (Array.isArray(items.get(id)?.data?.picks) ? items.get(id).data.picks : []);
    const scope = () => sents.filter((s) => !sel.length || sel.includes(s.unit_id));

    const counts = h('div', { class: 'q-counts' });
    const list = h('div', { class: 'ox-list' });
    const fSeg = seg([['all', '전체'], ['no', '틀린 문장']], filter, (v) => { filter = v; draw(); });
    el.append(
      h('div', { class: 'q-bar' },
        units.length ? unitPicker(units, sel, (v) => { sel = v; order = null; try { localStorage.setItem(selKey, JSON.stringify(sel)); } catch { /* 무시 */ } draw(); }) : null,
        fSeg, counts, h('div', { class: 'sp' }),
        h('div', { class: 'spd' }, h('span', {}, '속도'), seg([['slow', '느림'], ['mid', '보통'], ['fast', '빠름']], speed, (v) => { speed = v; try { localStorage.setItem('kmed:speed', v); } catch { /* 무시 */ } })),
        h('button', { class: 'tool-ic', title: '섞기', 'aria-label': '섞기', onclick: () => { order = shuffle(scope().map((s) => s.id)); draw(); toast('문장을 섞었습니다'); } }, icon('shuffle')),
        h('button', { class: 'tool-ic', title: '원래 순서', 'aria-label': '원래 순서', onclick: () => { order = null; draw(); toast('원래 순서로 되돌렸습니다'); } }, icon('restore')),
        h('button', { class: 'tool-ic', title: '입력 지우기', 'aria-label': '입력 지우기', onclick: clearAll }, icon('trash'))),
      list,
      h('div', { class: 'ox-foot' }, h('button', { class: 'btn ink', onclick: gradeAll }, '보이는 문장 모두 채점')));

    function visible() {
      let arr = scope();
      if (order) { const m = new Map(order.map((id, i) => [id, i])); arr = arr.slice().sort((a, b) => (m.get(a.id) ?? 1e9) - (m.get(b.id) ?? 1e9)); }
      if (filter === 'no') arr = arr.filter((s) => st(s.id) === 'no');
      return arr;
    }
    function renderCounts() {
      const sc = scope();
      const ok = sc.filter((s) => st(s.id) === 'ok').length;
      const no = sc.filter((s) => st(s.id) === 'no').length;
      counts.replaceChildren(
        h('span', {}, h('b', {}, sc.length - ok - no), ' 남음'),
        h('span', { class: 'ok' }, h('b', {}, ok), ' 정답'),
        h('span', { class: 'no' }, h('b', {}, no), ' 오답'));
    }

    const views = new Map(); // id → { el, row, ans, btn }
    function draw() {
      timers.forEach((t) => t.forEach(clearTimeout)); timers.clear();
      views.clear();
      renderCounts();
      const arr = visible();
      if (!arr.length) { list.replaceChildren(h('div', { class: 'box-empty' }, filter === 'no' ? '틀린 문장이 없습니다' : '문장이 없습니다')); return; }
      list.replaceChildren(...arr.map((s, i) => item(s, i)));
    }

    function item(s, i) {
      const row = h('div', { class: 'ox-cards' });
      const ans = h('div', { class: 'ox-ans' });
      const btn = h('button', { class: 'btn sm ink ox-check' });
      const ta = h('textarea', { class: 'ox-tr', rows: 1, placeholder: '해석 (선택)', spellcheck: 'false' });
      ta.value = items.get(s.id)?.data?.t || '';
      const fit = () => { if (!ta.isConnected || !ta.value) { ta.style.height = ''; return; } ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };
      ta.addEventListener('input', () => { fit(); saveItem(KIND, items, s.id, { data: { t: ta.value } }, 700); });
      requestAnimationFrame(fit);
      const node = h('article', { class: 'ox', style: { animationDelay: `${Math.min(i, 8) * 0.03}s` } },
        h('header', {},
          h('span', { class: 'num' }, i + 1),
          h('div', { class: 'sen' }, s.sentence || s.cards.join('')),
          s.source ? h('span', { class: 'src' }, s.source) : null),
        row,
        h('div', { class: 'ox-tools' },
          h('button', { class: 'txt-btn', onclick: () => { saveItem(KIND, items, s.id, { status: null, data: { picks: [] } }); paint(s); renderCounts(); } }, icon('undo', 'icon s'), '다시 고르기')),
        ta, ans, h('div', { class: 'ox-act' }, btn));
      views.set(s.id, { el: node, row, ans, btn });
      paint(s);
      return node;
    }

    // 카드 · 채점 표시
    function paint(s) {
      const v = views.get(s.id); if (!v) return;
      stopAnim(s.id);
      const picks = picksOf(s.id);
      const graded = st(s.id);
      v.row.classList.remove('anim');
      v.row.replaceChildren(...s.cards.map((c, ci) => {
        const p = picks.indexOf(ci);
        let cls = 'oc';
        let badge = p >= 0 ? p + 1 : null;
        if (graded) { cls += p + 1 === s.orders[ci] ? ' good' : ' bad'; badge = s.orders[ci]; }
        else if (p >= 0) cls += ' picked';
        return h('button', { class: cls, onclick: () => pick(s, ci) }, badge != null ? h('i', {}, badge) : null, h('span', {}, c));
      }));
      v.el.classList.toggle('ok', graded === 'ok');
      v.el.classList.toggle('no', graded === 'no');
      if (graded) {
        const seq = s.cards.map((c, ci) => ({ c, o: s.orders[ci] })).sort((a, b) => a.o - b.o);
        v.ans.replaceChildren(
          h('div', { class: 'vd ' + graded }, graded === 'ok' ? '순서 정답' : '순서 오답'),
          h('div', { class: 'tr' }, s.translation),
          h('div', { class: 'seq' }, seq.map((x, n) => h('span', {}, h('b', {}, n + 1), x.c))));
        v.ans.classList.add('on');
        v.btn.replaceChildren(icon('play', 'icon s'), '순서 다시 보기');
        v.btn.onclick = () => play(s);
      } else {
        v.ans.classList.remove('on'); v.ans.replaceChildren();
        v.btn.replaceChildren('채점');
        v.btn.onclick = () => check(s);
      }
    }
    function pick(s, ci) {
      const picks = st(s.id) ? [] : picksOf(s.id).slice();
      const at = picks.indexOf(ci);
      if (at >= 0) picks.splice(at, 1); else picks.push(ci);
      saveItem(KIND, items, s.id, { status: null, data: { picks } });
      paint(s); renderCounts();
      if (picks.length === s.cards.length) setTimeout(() => { if (alive && !st(s.id) && picksOf(s.id).length === s.cards.length) check(s); }, 250);
    }
    function check(s) {
      const picks = picksOf(s.id);
      const ok = s.cards.every((_, ci) => picks.indexOf(ci) + 1 === s.orders[ci]);
      saveItem(KIND, items, s.id, { status: ok ? 'ok' : 'no' }, 0);
      paint(s); renderCounts();
      const v = views.get(s.id);
      v?.el.classList.remove('pulse'); void v?.el.offsetWidth; v?.el.classList.add('pulse');
    }
    function gradeAll() {
      const arr = visible().filter((s) => !st(s.id) && picksOf(s.id).length);
      if (!arr.length) { toast('채점할 문장이 없습니다'); return; }
      arr.forEach(check);
      const ok = arr.filter((s) => st(s.id) === 'ok').length;
      toast(`${arr.length}문장 중 ${ok}개 정답`);
    }

    // 정답 순서대로 하나씩 켜기
    function stopAnim(id) { (timers.get(id) || []).forEach(clearTimeout); timers.delete(id); }
    function play(s) {
      const v = views.get(s.id); if (!v) return;
      stopAnim(s.id);
      const gap = SPEED[speed] || 560;
      const btns = [...v.row.children];
      v.row.classList.add('anim');
      btns.forEach((b) => { b.className = 'oc'; b.querySelector('i')?.remove(); });
      const seq = s.cards.map((_, ci) => ({ ci, o: s.orders[ci] })).sort((a, b) => a.o - b.o);
      v.btn.replaceChildren(icon('skip', 'icon s'), '건너뛰기');
      v.btn.onclick = () => paint(s);
      const t = seq.map((x, n) => setTimeout(() => {
        const b = btns[x.ci]; if (!b) return;
        b.prepend(h('i', {}, n + 1));
        b.classList.add('lit');
      }, 120 + n * gap));
      t.push(setTimeout(() => paint(s), 120 + seq.length * gap + 500));
      timers.set(s.id, t);
    }

    let armed = false;
    function clearAll(e) {
      const btn = e.currentTarget;
      if (!armed) { armed = true; btn.classList.add('armed'); toast('한 번 더 누르면 고른 단원의 입력을 지웁니다'); setTimeout(() => { armed = false; btn.classList.remove('armed'); }, 2500); return; }
      armed = false; btn.classList.remove('armed');
      clearItems(KIND, items, scope().map((s) => s.id).filter((id) => items.has(id)));
      draw(); toast('입력을 지웠습니다');
    }

    draw();
  })();

  return () => { alive = false; timers.forEach((t) => t.forEach(clearTimeout)); offs.forEach((f) => f()); };
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
