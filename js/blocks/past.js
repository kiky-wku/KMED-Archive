import { sb } from '../sb.js';
import { h, icon, toast, seg, modal, busy, drawer } from '../ui.js';
import { fetchAll } from '../data/hanja.js';
import { loadItems, saveItem, clearItems } from '../data/study.js';
import { filesBlock } from './files.js';
import { openDataSheet } from '../views/data-sheet.js';

// ─────────────────────────────────────────────
// 기출문제 탭
//  · 문제 풀기 : 시험(25학번 기말 …)별로 한 문제씩, 바로 채점
//    객관식, OX 는 자동 채점 / 빈칸, 단답, 서술은 정답 보고 스스로 맞음, 틀림
//  · 원본 PDF : 기출 원본 파일 (자료 탭과 같은 화면, 기출만)
// ─────────────────────────────────────────────
const KIND = 'past';
const TYPE = { mc: '객관식', ox: 'OX', blank: '빈칸', short: '단답', essay: '서술' };
const AUTO = new Set(['mc', 'ox']);
const CIRC = '①②③④⑤⑥⑦⑧⑨⑩';
const num = (i) => CIRC[i] || `${i + 1}.`;
const ansSet = (q) => new Set(String(q.answer || '').split(/[,\s]+/).map(Number).filter(Boolean));
// 학번 높은 순, 같으면 기말 먼저
const rank = (e) => { const m = String(e).match(/(\d{2})학번\s*(중간|기말)?/); return m ? Number(m[1]) * 10 + (m[2] === '기말' ? 1 : 0) : -1; };

export function pastBlock(ctx, el) {
  let alive = true;
  let sub = null;                      // 지금 열린 아래 화면의 정리 함수
  let tab = localStorage.getItem('kmed:pasttab') === 'pdf' ? 'pdf' : 'quiz';
  const area = h('div', { class: 'pq-area' });
  const addBtn = ctx.canWrite ? h('button', { class: 'tool-ic', title: '기출문제 넣기', 'aria-label': '기출문제 넣기', onclick: () => openDataSheet(ctx.subject, ctx.range, () => { qs = null; show(); }, { keys: ['past'] }) }, icon('import')) : null;
  const head = h('div', { class: 'pq-head' },
    seg([['quiz', '문제 풀기'], ['pdf', '원본 PDF']], tab, (v) => { tab = v; try { localStorage.setItem('kmed:pasttab', v); } catch { /* 무시 */ } show(); }),
    h('div', { class: 'sp' }), addBtn);
  el.append(head, area);

  let qs = null; let items = null;
  async function data() {
    if (!qs) {
      [qs, items] = await Promise.all([
        fetchAll(() => sb.from('past_questions').select('*').eq('range_id', ctx.range.id).order('sort')),
        loadItems(KIND),
      ]);
    }
    return qs;
  }

  function show() {
    sub?.(); sub = null;
    area.replaceChildren();
    head.style.display = '';
    if (tab === 'pdf') { addBtn && (addBtn.style.display = 'none'); sub = filesBlock({ ...ctx, filesScope: 'past' }, area); return; }
    addBtn && (addBtn.style.display = '');
    list();
  }

  // ── 시험 목록 ──
  async function list() {
    area.replaceChildren(...[0, 1].map(() => h('i', { class: 'skel pq-sk' })));
    let all;
    try { all = await data(); } catch { area.replaceChildren(h('div', { class: 'box-empty' }, '기출문제를 불러올 수 없습니다')); return; }
    if (!alive || tab !== 'quiz') return;
    if (!all.length) {
      area.replaceChildren(h('div', { class: 'fl-empty' }, h('div', { class: 'emo' }, '📝'), h('b', {}, '아직 넣은 기출문제가 없습니다'),
        ctx.canWrite ? h('p', {}, '오른쪽 위 문제 넣기에서 기출 원본과 써머리로 문제를 만들 수 있습니다') : null));
      return;
    }
    const exams = [...new Set(all.map((q) => q.exam))].sort((a, b) => rank(b) - rank(a));
    const st = (id) => items.get(id)?.status;
    area.replaceChildren(h('div', { class: 'pq-list' }, exams.map((ex, i) => {
      const list = all.filter((q) => q.exam === ex);
      const ok = list.filter((q) => st(q.id) === 'ok').length;
      const no = list.filter((q) => st(q.id) === 'no').length;
      const ai = list.filter((q) => q.ai).length;
      const pct = (n) => `${(n / list.length) * 100}%`;
      return h('div', { class: 'pq-exam', style: { animationDelay: `${i * 0.04}s` } },
        h('button', { class: 'pq-main', onclick: () => quiz(ex) },
          h('div', { class: 'pq-t' }, h('b', {}, ex), h('span', {}, `${list.length}문제`), ai ? h('em', {}, `AI 추정 ${ai}`) : null),
          h('div', { class: 'pq-bar' }, h('i', { class: 'ok', style: { width: pct(ok) } }), h('i', { class: 'no', style: { width: pct(no) } })),
          h('div', { class: 'pq-n' }, h('span', { class: 'ok' }, `맞음 ${ok}`), h('span', { class: 'no' }, `틀림 ${no}`), h('span', {}, `남음 ${list.length - ok - no}`)),
          icon('right', 'icon pq-go')),
        no ? h('button', { class: 'pq-wrong', title: '틀린 문제만', 'aria-label': `틀린 ${no}문제만 다시`, onclick: () => quiz(ex, true) }, icon('restore', 'icon s'), h('b', {}, no)) : null);
    })));
  }

  // ── 한 문제씩 풀기 ──
  async function quiz(exam, wrongOnly = false) {
    const all = (await data()).filter((q) => q.exam === exam);
    const byId = new Map(all.map((q) => [q.id, q]));
    const base = all.map((q) => q.id);
    // 순서와 위치 : 시험마다 기기에 기억 (섞기, 원래 순서)
    const key = `kmed:pastord:${ctx.range.id}:${exam}`;
    let saved = null; try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch { saved = null; }
    let order = Array.isArray(saved?.order) ? saved.order.filter((id) => byId.has(id)) : base.slice();
    base.forEach((id) => { if (!order.includes(id)) order.push(id); });
    let ids = wrongOnly ? order.filter((id) => items.get(id)?.status === 'no') : order;
    let pos = wrongOnly ? 0 : Math.min(Number(saved?.pos) || 0, Math.max(0, ids.length - 1));
    const save = () => { if (!wrongOnly) { try { localStorage.setItem(key, JSON.stringify({ order, pos })); } catch { /* 무시 */ } } };
    // 틀린 것만 다시 : 이번에 다시 푼 문제만 결과로 셈 (저장된 기록은 새로 채점할 때 바뀜)
    const touched = new Set();
    const stOf = (id) => (wrongOnly && !touched.has(id) ? null : items.get(id)?.status);
    head.style.display = 'none';
    const stage = h('div', { class: 'pq-stage' });
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const setOrder = (o, p, msg) => { order = o; ids = order; pos = p; save(); render(); toast(msg); };
    const tool = (ic, label, fn, cls = '') => h('button', { class: `tool-ic ${cls}`, title: label, 'aria-label': label, onclick: fn }, icon(ic));
    const recBtn = tool('list', '기록', () => openRecords(), 'rec-btn');
    const tools = wrongOnly ? h('div', { class: 'pq-tools' }, recBtn) : h('div', { class: 'pq-tools' },
      tool('shuffle', '전체 섞기', () => setOrder(shuffle(base.slice()), 0, '전체 문제를 섞었습니다')),
      tool('shuffleun', '안 푼 문제 섞기', () => {
        const done = order.filter((id) => items.get(id)?.status); const rest = shuffle(order.filter((id) => !items.get(id)?.status));
        if (!rest.length) { toast('안 푼 문제가 없습니다'); return; }
        setOrder([...done, ...rest], done.length, '안 푼 문제를 섞었습니다');
      }),
      tool('restore', '원래 순서', () => setOrder(base.slice(), 0, '원래 순서로 되돌렸습니다')),
      tool('xcircle', '틀린 문제만', () => {
        if (!order.some((id) => items.get(id)?.status === 'no')) { toast('틀린 문제가 없습니다'); return; }
        off(); quiz(exam, true);
      }),
      recBtn);
    const bar = h('div', { class: 'pq-top' },
      h('button', { class: 'tool-ic', 'aria-label': '목록', onclick: () => { off(); show(); } }, icon('back')),
      h('b', {}, exam), wrongOnly ? h('span', { class: 'pq-chip no' }, '틀린 문제') : null, h('div', { class: 'sp' }), tools);
    // 남음, 맞음, 틀림 + 진행 막대
    const counts = h('div', { class: 'q-counts' });
    const prog = h('div', { class: 'q-prog pq-prog' }, h('i', { class: 'ok' }), h('i', { class: 'no' }));
    area.replaceChildren(bar, h('div', { class: 'q-bar pq-cnt' }, counts), prog, stage);
    const paintRec = () => {
      const ok = ids.filter((id) => stOf(id) === 'ok').length;
      const no = ids.filter((id) => stOf(id) === 'no').length;
      counts.replaceChildren(
        h('span', {}, h('b', {}, ids.length - ok - no), ' 남음'),
        h('span', { class: 'ok' }, h('b', {}, ok), ' 맞음'),
        h('span', { class: 'no' }, h('b', {}, no), ' 틀림'));
      prog.children[0].style.width = `${ids.length ? (ok / ids.length) * 100 : 0}%`;
      prog.children[1].style.width = `${ids.length ? (no / ids.length) * 100 : 0}%`;
      recBtn.classList.toggle('dot', ok + no > 0);
    };

    // ── 기록 서랍 : 문제 번호 격자 (맞음 초록, 틀림 빨강), 누르면 그 문제로 ──
    let rec = null;
    function openRecords() {
      const body = h('div', { class: 'rec' });
      rec = { body, d: drawer({ title: '기록', body, onClose: () => { rec = null; } }) };
      drawRecords();
    }
    let armed = false;
    function drawRecords() {
      if (!rec) return;
      const wrong = ids.filter((id) => stOf(id) === 'no').length;
      rec.body.replaceChildren(
        h('div', { class: 'jt-rec' }, ids.map((id, i) => {
          const q = byId.get(id); const st = stOf(id);
          return h('button', { class: 'jr ' + (st || '') + (i === pos ? ' cur' : ''), onclick: () => { pos = i; save(); rec.d.close(); render(); } },
            h('b', {}, q.no || i + 1), h('span', {}, TYPE[q.type]));
        })),
        h('div', { class: 'rec-foot' },
          h('button', { class: 'btn', disabled: !wrong, onclick: () => { rec.d.close(); off(); quiz(exam, true); } }, wrong ? `틀린 ${wrong}개만` : '틀린 문제 없음'),
          wrongOnly ? null : h('button', { class: 'btn ghost', onclick: (e) => {
            const btn = e.currentTarget;
            if (!armed) { armed = true; const t = btn.textContent; btn.textContent = '한 번 더 누르면 초기화'; setTimeout(() => { armed = false; if (document.contains(btn)) btn.textContent = t; }, 2500); return; }
            armed = false;
            clearItems(KIND, items, base.filter((id) => items.has(id)));
            rec.d.close(); setOrder(base.slice(), 0, '기록을 지웠습니다');
          } }, '전체 초기화')));
    }
    let revealed = false;

    function render(dir = 0) {
      revealed = false;
      save(); paintRec(); drawRecords();
      const q = byId.get(ids[pos]);
      const it0 = items.get(q.id) || { status: null, data: {} };
      const it = wrongOnly && !touched.has(q.id) ? { status: null, data: {} } : it0;
      ctx.here = `${exam} ${q.no}번 ${q.question.slice(0, 60)}`;
      const card = h('article', { class: 'pq-card' + (dir > 0 ? ' nx' : dir < 0 ? ' go-prev' : '') });
      const meta = h('div', { class: 'pq-meta' },
        h('span', { class: 'idx' }, `${pos + 1}`, h('i', {}, ` / ${ids.length}`)),
        q.no ? h('span', { class: 'pq-chip' }, `${q.no}번`) : null,
        h('span', { class: 'pq-chip' }, TYPE[q.type]),
        it.status ? h('span', { class: `pq-chip ${it.status}` }, it.status === 'ok' ? '맞음' : '틀림') : null,
        h('div', { class: 'sp' }),
        h('button', { class: 'tool-ic sm', 'aria-label': '이전', disabled: pos === 0, onclick: () => move(-1) }, icon('back', 'icon s')),
        h('button', { class: 'tool-ic sm', 'aria-label': '다음', disabled: pos >= ids.length - 1, onclick: () => move(1) }, icon('right', 'icon s')));
      card.append(meta);
      if (q.tag) card.append(h('div', { class: 'pq-tag' }, icon('bookmark', 'icon s'), q.tag));
      if (q.passage) card.append(h('div', { class: 'pq-passage' }, q.passage));
      card.append(h('div', { class: 'pq-q' }, q.question));

      const ans = h('div', { class: 'pq-ans' });
      const act = h('div', { class: 'pq-act' });
      // 정답 · 해설 펼치기
      function reveal(result) {
        if (revealed) return; revealed = true;
        const right = q.type === 'mc' ? [...ansSet(q)].map((n) => `${num(n - 1)} ${q.choices[n - 1] || ''}`).join('\n') : q.answer;
        ans.replaceChildren(...[
          h('div', { class: 'pq-a-h' }, h('b', {}, '정답'), q.ai ? h('span', { class: 'pq-ai' }, 'AI 추정') : null,
            ctx.canWrite ? h('button', { class: 'pq-fix', title: '정답 고치기', 'aria-label': '정답 고치기', onclick: () => fix(q) }, icon('pen', 'icon s')) : null,
            ctx.canWrite && q.ai ? h('button', { class: 'pq-fix', title: '정답 확인함', 'aria-label': '정답 확인함', onclick: () => confirmAi(q) }, icon('check', 'icon s')) : null),
          h('div', { class: 'pq-a' }, right || '정답이 비어 있습니다'),
          q.accept?.length ? h('div', { class: 'pq-acc' }, `인정 : ${q.accept.join(', ')}`) : null,
          q.explain ? h('div', { class: 'pq-ex' }, q.explain) : null].filter(Boolean));
        ans.classList.add('on');
        if (AUTO.has(q.type)) {
          act.replaceChildren(pos < ids.length - 1
            ? h('button', { class: 'btn ink pq-next', onclick: () => move(1) }, '다음 문제', h('kbd', {}, 'Enter'))
            : h('button', { class: 'btn ink pq-next', onclick: done }, '결과 보기'));
        } else if (!result) {
          // 빈칸, 단답 : 쓴 답이 정답이나 인정 답안과 같으면 맞음을, 다르면 틀림을 미리 강조 (고르는 건 직접)
          const norm = (x) => String(x || '').toLowerCase().replace(/[\s()（）.,·]/g, '');
          const typed = norm(card.querySelector('.pq-in')?.value);
          const hint = ['blank', 'short'].includes(q.type) && typed
            ? ([q.answer, ...(q.accept || [])].some((a) => norm(a) === typed) ? 'ok' : 'no') : null;
          act.replaceChildren(
            h('button', { class: 'gbtn pq-g no' + (hint === 'no' ? ' hint' : ''), onclick: () => grade(false) }, icon('x', 'icon s'), '틀림', h('kbd', {}, '←')),
            h('button', { class: 'gbtn pq-g ok' + (hint === 'ok' ? ' hint' : ''), onclick: () => grade(true) }, icon('check', 'icon s'), '맞음', h('kbd', {}, '→')));
          card.querySelector('.pq-in')?.blur();
        }
      }
      function grade(ok, data) {
        touched.add(q.id);
        saveItem(KIND, items, q.id, { status: ok ? 'ok' : 'no', ...(data ? { data } : {}) }, 0);
        paintRec(); drawRecords();
        if (AUTO.has(q.type)) return;
        if (pos < ids.length - 1) move(1); else done();
      }

      if (q.type === 'mc' || q.type === 'ox') {
        const opts = q.type === 'mc' ? q.choices.map((c, i) => [String(i + 1), `${num(i)}`, c]) : [['O', 'O', ''], ['X', 'X', '']];
        const right = q.type === 'mc' ? ansSet(q) : new Set([q.answer]);
        const btns = opts.map(([v, n, txt]) => h('button', { class: 'pq-opt' + (q.type === 'ox' ? ' pq-ox' : ''), onclick: () => pick(v) },
          h('span', { class: 'n' }, n), txt ? h('span', { class: 't' }, txt) : null));
        const paint = (chosen) => btns.forEach((b, i) => {
          const v = opts[i][0]; const isRight = q.type === 'mc' ? right.has(Number(v)) : right.has(v);
          b.disabled = true; b.classList.toggle('right', isRight); b.classList.toggle('wrong', v === chosen && !isRight);
        });
        function pick(v) {
          if (revealed) return;
          const ok = q.type === 'mc' ? right.has(Number(v)) : right.has(v);
          paint(v); grade(ok, { a: v }); reveal(true);
          card.querySelector('.pq-meta .sp')?.before(h('span', { class: `pq-chip ${ok ? 'ok' : 'no'}` }, ok ? '맞음' : '틀림'));
        }
        card.append(h('div', { class: 'pq-opts' + (q.type === 'ox' ? ' pq-oxs' : '') }, btns));   // 'ox' 는 다른 탭 이름이라 따로
        card.pick = (i) => opts[i] && pick(opts[i][0]);
        if (it.status && it.data?.a) { paint(it.data.a); reveal(true); }
      } else {
        const ta = h('textarea', { class: 'pq-in', placeholder: q.type === 'essay' ? '답안을 적어보세요' : '답을 적어보세요', spellcheck: 'false', rows: q.type === 'essay' ? 5 : 2 });
        ta.value = it.data?.t || '';
        ta.addEventListener('input', () => saveItem(KIND, items, q.id, { data: { t: ta.value } }, 700));
        ta.addEventListener('keydown', (e) => {
        // ↓ : 커서가 글 맨 끝이면 정답 확인 (중간이면 원래대로 줄 이동), Esc : 입력칸에서 빠져나오기
        if (e.isComposing) return;
        if (e.key === 'ArrowDown' && ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length) { e.preventDefault(); ta.blur(); reveal(); }
        else if (e.key === 'Escape') { e.preventDefault(); ta.blur(); }
      });
        card.append(ta);
        act.replaceChildren(h('button', { class: 'btn ink pq-next', onclick: () => reveal() }, icon('eye', 'icon s'), '정답 확인', h('kbd', {}, '↓')));
      }
      card.append(ans);
      stage.replaceChildren(card, act);
      stage.reveal = reveal;
    }
    function move(d) {
      const n = pos + d;
      if (n < 0 || n >= ids.length) return;
      pos = n; render(d);
    }
    function done() {
      const ok = ids.filter((id) => stOf(id) === 'ok').length;
      const no = ids.filter((id) => stOf(id) === 'no').length;
      pos = 0; save();
      stage.replaceChildren(h('div', { class: 'pq-done' },
        h('div', { class: 'emo' }, no ? '📝' : '🎉'),
        h('b', {}, `${ids.length}문제 중 ${ok}문제 맞음`),
        h('div', { class: 'pq-n' }, h('span', { class: 'ok' }, `맞음 ${ok}`), h('span', { class: 'no' }, `틀림 ${no}`)),
        h('div', { class: 'pq-done-act' },
          no ? h('button', { class: 'btn ink', onclick: () => { off(); quiz(exam, true); } }, `틀린 ${no}개 다시`) : null,
          h('button', { class: 'btn ghost', onclick: () => { off(); show(); } }, '목록으로'))));
    }
    // 키보드 : 1~9 보기, O X, Enter 정답 확인 · 다음, ← → 이동 또는 채점
    const onKey = (e) => {
      if (document.querySelector('.modal-wrap, .drawer.on, .ds-wrap.on, .pop')) return;
      const tag = (e.target.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      const q = byId.get(ids[pos]); const card = stage.querySelector('.pq-card');
      if (!q || !card) return;
      const selfGrade = revealed && !AUTO.has(q.type) && stage.querySelector('.pq-g');
      if (/^[1-9]$/.test(e.key) && q.type === 'mc') { e.preventDefault(); card.pick?.(Number(e.key) - 1); }
      else if (q.type === 'ox' && /^[oOxX]$/.test(e.key)) { e.preventDefault(); card.pick?.(e.key.toUpperCase() === 'O' ? 0 : 1); }
      else if (e.key === 'ArrowDown' && !revealed && !AUTO.has(q.type)) { e.preventDefault(); stage.reveal?.(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (revealed) stage.querySelector('.pq-next')?.click(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (selfGrade) stage.querySelector('.pq-g.no').click(); else move(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (selfGrade) stage.querySelector('.pq-g.ok').click(); else move(1); }
    };
    document.addEventListener('keydown', onKey);
    function off() { document.removeEventListener('keydown', onKey); rec?.d.close(); }
    sub = off;

    // 정답 고치기 (담당자) : 고치면 AI 추정 표시가 빠짐
    function fix(q) {
      const a = h('textarea', { class: 'input pq-edit', rows: 3 }, q.answer);
      const ex = h('textarea', { class: 'input pq-edit', rows: 4 }, q.explain);
      const save = h('button', { class: 'btn ink', onclick: async () => {
        busy(save, true);
        const patch = { answer: a.value.trim(), explain: ex.value.trim(), ai: false, updated_at: new Date().toISOString() };
        const { error } = await sb.from('past_questions').update(patch).eq('id', q.id);
        if (error) { busy(save, false, '저장'); toast('저장하지 못했습니다'); return; }
        Object.assign(q, patch); m.close(); toast('정답을 고쳤습니다'); render();
      } }, '저장');
      const m = modal({ title: `${q.no ? `${q.no}번 ` : ''}정답 고치기`,
        body: h('div', { class: 'form1' },
          h('label', { class: 'fld' }, h('span', {}, q.type === 'mc' ? '정답 번호 (여러 개면 2, 4)' : q.type === 'ox' ? '정답 (O 또는 X)' : '정답'), a),
          h('label', { class: 'fld' }, h('span', {}, '해설'), ex)),
        actions: [h('button', { class: 'btn ghost', onclick: () => m.close() }, '취소'), save] });
    }
    async function confirmAi(q) {
      const { error } = await sb.from('past_questions').update({ ai: false, updated_at: new Date().toISOString() }).eq('id', q.id);
      if (error) { toast('저장하지 못했습니다'); return; }
      q.ai = false; toast('정답을 확인했습니다'); render();
    }

    if (!ids.length) { stage.replaceChildren(h('div', { class: 'box-empty' }, '풀 문제가 없습니다')); return; }
    render();
  }

  show();
  return () => { alive = false; sub?.(); };
}

// 시험 기록 지우기 (나중에 기록 서랍에서 쓸 수 있게)
export function resetPast(map, ids) { clearItems(KIND, map, ids); }
