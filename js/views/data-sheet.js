import { h, icon, toast, busy } from '../ui.js';
import { FORMATS, formatsFor, buildRequest, buildPastRequest, buildPredRequest } from '../data/formats.js';
import { sb } from '../sb.js';
import { check, counts, existingCodes, apply } from '../data/importer.js';
import { resetCaches, resetHints } from '../data/hanja.js';
import { resetStudyCaches } from '../data/study.js';

// ─────────────────────────────────────────────
// 데이터 넣기 (과목 화면 오른쪽 위 아이콘 → 아래에서 올라오는 창)
//  ① 프롬프트 복사 → (AI 에게 자료와 함께 보내 엑셀 받기) → ② 붙여넣기 → ③ 넣기
// ─────────────────────────────────────────────
// draft : Claude 연결로 들어온 검토 대기 { id, payload, note, title } → 붙여넣기 칸을 채우고 바로 확인 화면으로
export function openDataSheet(sub, range, onDone, { keys: only, draft } = {}) {
  // 기출 탭에서 열면 기출 표만
  const keys = only || formatsFor((sub.blocks || []).map((b) => b.kind));
  const isPast = keys.length === 1 && keys[0] === 'past';
  const isPred = keys.length === 1 && keys[0] === 'pred';
  if (!keys.length) { toast('이 과목은 넣을 데이터 형식이 없습니다'); return; }
  let step = 0;
  let mode = 'add';
  const parsed = {};
  let cnt = {}; let units = [];

  const stepBtns = ['준비하기', '붙여넣기', '넣기'].map((t, i) =>
    h('button', { class: 'ds-step', onclick: () => go(i) }, h('b', {}, i + 1), h('span', {}, t)));
  const pages = [h('section', { class: 'ds-page' }), h('section', { class: 'ds-page' }), h('section', { class: 'ds-page' })];
  const next = h('button', { class: 'btn ink ds-next' });
  const prev = h('button', { class: 'btn ghost ds-prev', onclick: () => go(step - 1) }, icon('back', 'icon s'), '이전');
  const sheet = h('div', { class: 'ds', role: 'dialog', 'aria-modal': 'true' },
    h('header', { class: 'ds-head' },
      h('div', { class: 'ds-ttl' }, h('span', { class: 'emo' }, sub.icon || ''), h('div', {}, h('h2', {}, draft ? (draft.title || 'Claude가 보낸 데이터') : isPast ? '기출문제 넣기' : isPred ? '예상문제 넣기' : '데이터 넣기'), h('span', {}, `${sub.name} ${range.name}`))),
      h('button', { class: 'ib', 'aria-label': '닫기', onclick: close }, icon('x'))),
    h('nav', { class: 'ds-steps' }, stepBtns),
    h('div', { class: 'ds-body' }, pages),
    h('footer', { class: 'ds-foot' }, prev, h('div', { class: 'sp' }), next));
  const wrap = h('div', { class: 'ds-wrap', onclick: (e) => { if (e.target === wrap) close(); } }, sheet);
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('on'));
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close() {
    wrap.classList.remove('on'); document.removeEventListener('keydown', onKey);
    setTimeout(() => wrap.remove(), 320);
  }

  // ── ① 준비하기 ──
  // 예상문제 : 기출 예시를 미리 받아 둠 (복사는 누른 순간 바로 해야 아이패드 사파리에서 막히지 않음)
  let pastEx = null;
  const pastP = isPred ? pastOf(sub.id).then((r) => { pastEx = r; return r; }) : null;
  const textOf = (past) => (isPast ? buildPastRequest({ subject: sub.name, range: range.name })
    : isPred ? buildPredRequest({ subject: sub.name, range: range.name, past: past || [] })
      : buildRequest(keys, { subject: sub.name, range: range.name }));
  const copyBtn = h('button', { class: 'ds-copy', onclick: async () => {
    let done = false;
    if (isPred && !pastEx && window.ClipboardItem && navigator.clipboard?.write) {
      // 아직 못 받았으면 받는 대로 넣기 (누른 순간에 복사를 예약)
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': pastP.then((r) => new Blob([textOf(r)], { type: 'text/plain' })) })]);
        done = true;
      } catch { /* 아래로 */ }
    }
    if (!done) {
      const text = textOf(pastEx);
      try { await navigator.clipboard.writeText(text); } catch {
        const t = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text); document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
      }
    }
    copyBtn.classList.add('ok'); copyBtn.lastChild.textContent = '복사됨'; paintFoot();
    setTimeout(() => { if (copyBtn.isConnected) { copyBtn.classList.remove('ok'); copyBtn.lastChild.textContent = '복사하기'; } }, 2200);
  } }, icon('copy'), h('span', {}, '복사하기'));
  const gStep = (n, title, ...body) => h('li', { class: 'gs', style: { animationDelay: `${n * 0.05}s` } },
    h('div', { class: 'gs-n' }, n), h('div', { class: 'gs-b' }, h('div', { class: 'gs-t' }, title), ...body));
  pages[0].append(
    h('ol', { class: 'gd-steps' },
      gStep(1, '형식을 복사합니다', h('div', { class: 'gs-act' }, copyBtn)),
      gStep(2, 'Claude에게 자료와 함께 보냅니다',
        h('p', {}, isPast ? '새 채팅에 붙여넣고 기출 원본 PDF와 써머리 PDF를 함께 첨부하면, 문제 형식과 정답, 해설을 판단해서 엑셀을 만들어 줍니다.' : isPred ? '새 채팅에 붙여넣고 수업 자료 PDF를 첨부하면, 출제 계획을 먼저 보여 주고 질문한 뒤 예상문제 엑셀을 만들어 줍니다. 이 과목 기출이 있으면 그 스타일 예시가 함께 들어갑니다.' : '새 채팅에 붙여넣고 PDF를 첨부하면 앱에 맞는 엑셀을 만들어 줍니다. 파일은 여러 개를 한 번에 올려도 됩니다.')),
      gStep(3, '받은 엑셀을 탭별로 붙여넣습니다',
        h('p', {}, '탭을 열어 전체 선택하고 복사한 뒤, 다음 화면의 같은 이름 칸에 붙여넣으면 됩니다.'),
        h('div', { class: 'gs-keys' }, h('span', {}, h('kbd', {}, '⌘'), h('kbd', {}, 'A'), '전체 선택'), h('span', {}, h('kbd', {}, '⌘'), h('kbd', {}, 'C'), '복사'), h('span', {}, h('kbd', {}, '⌘'), h('kbd', {}, 'V'), '붙여넣기')))));

  // ── ② 붙여넣기 ──
  const cards = keys.map((k) => {
    const f = FORMATS[k];
    const ta = h('textarea', { class: 'imp-paste', rows: 4, placeholder: `엑셀의 "${f.sheet}" 탭을 복사해서 여기에 붙여넣으세요`, spellcheck: 'false' });
    const res = h('div', { class: 'imp-res' });
    const now = h('span', { class: 'now' });
    const card = h('section', { class: 'imp-card' },
      h('header', {}, h('h3', {}, h('span', { class: 'tab-chip' }, f.sheet), f.label), now),
      h('div', { class: 'imp-cols' }, f.cols.slice(0, 6).map(([c, d]) => h('span', {}, h('b', {}, c), d)), f.cols.length > 6 ? h('span', {}, `… ${f.cols.length}칸`) : null),
      ta, res);
    card.now = now;
    card.run = () => {
      const codes = new Set([...units.map((u) => u.code), ...((parsed.units || {}).rows || []).map((u) => u.code)]);
      if (!ta.value.trim()) { delete parsed[k]; res.replaceChildren(); card.classList.remove('ok', 'bad'); paintFoot(); return; }
      const r = check(k, ta.value, { codes: k === 'hanja_unit' || k === 'um' ? codes : null });
      parsed[k] = r;
      card.classList.toggle('bad', r.errors.length > 0);
      card.classList.toggle('ok', !r.errors.length);
      res.replaceChildren(...[
        h('div', { class: 'sum' }, r.errors.length ? icon('x', 'icon s') : icon('check', 'icon s'), `${r.rows.length}개 읽음`,
          r.errors.length ? h('em', { class: 'e' }, `오류 ${r.errors.length}`) : null, r.warns.length ? h('em', { class: 'w' }, `확인 ${r.warns.length}`) : null),
        r.errors.length || r.warns.length ? h('ul', { class: 'msgs' }, [...r.errors.map((m) => h('li', { class: 'e' }, m)), ...r.warns.map((m) => h('li', { class: 'w' }, m))].slice(0, 30)) : null,
        r.rows.length ? previewTable(k, r.rows) : null].filter(Boolean));
      paintFoot();
    };
    ta.addEventListener('input', () => { clearTimeout(ta.t); ta.t = setTimeout(() => { card.run(); if (k === 'units') cards.forEach((c) => c !== card && c.run()); }, 250); });
    return card;
  });
  pages[1].append(
    draft ? h('p', { class: 'ds-lead' }, 'Claude가 보낸 내용입니다. 틀린 곳이 있으면 칸에서 바로 고칠 수 있습니다.')
      : h('p', { class: 'ds-lead' }, '넣을 탭만 붙여넣으면 됩니다. 틀린 곳이 있으면 바로 표시됩니다.'),
    ...(draft?.note ? [h('div', { class: 'ds-note' }, h('b', {}, 'Claude 검수 메모'), h('p', {}, draft.note))] : []),
    ...cards);

  // ── ③ 넣기 ──
  const summary = h('div', { class: 'ds-sum' });
  const opt = (v, t, d) => h('button', { class: 'ds-opt', 'data-v': v, onclick: () => { mode = v; paintOpt(); } }, h('i', { class: 'rd' }), h('div', {}, h('b', {}, t), h('span', {}, d)));
  const opts = h('div', { class: 'ds-opts' },
    opt('add', '추가하기', isPast ? '붙여넣은 시험만 새로 넣습니다. 같은 이름의 시험이 이미 있으면 그 시험만 새것으로 바뀝니다.' : isPred ? '붙여넣은 자료의 문제만 새로 넣습니다. 같은 자료 이름이 이미 있으면 그 자료 문제만 새것으로 바뀝니다.' : keys.includes('um') ? '붙여넣은 단원만 새로 넣습니다. 같은 단원이 이미 있으면 그 단원만 새것으로 바뀝니다.' : keys.includes('flash') ? '붙여넣은 묶음만 새로 넣습니다. 같은 묶음이 이미 있으면 그 묶음만 새것으로 바뀝니다. 그림을 넣은 그림 카드는 그대로 둡니다.' : '지금 있는 데이터 뒤에 이어 붙입니다. 이미 있는 한자는 훈음만 새로 고칩니다.'),
    opt('replace', '전부 바꾸기', isPast ? `${range.name}의 기출문제를 모두 지우고 붙여넣은 것으로 바꿉니다.` : isPred ? `${range.name}의 예상문제를 모두 지우고 붙여넣은 것으로 바꿉니다.` : keys.includes('flash') ? `${range.name}에 들어 있던 카드를 모두 지우고 붙여넣은 것으로 바꿉니다. 그림을 넣은 그림 카드, 앞면이 같은 카드의 사진은 그대로 둡니다.` : `${range.name}에 들어 있던 데이터를 모두 지우고 붙여넣은 것으로 바꿉니다. 해석 쓰기와 순서 맞추기 기록은 사라집니다.`));
  const paintOpt = () => opts.querySelectorAll('.ds-opt').forEach((b) => b.classList.toggle('on', b.dataset.v === mode));
  paintOpt();
  pages[2].append(summary, h('label', { class: 'imp-lab' }, '넣는 방식'), opts);
  function paintSummary() {
    const ready = keys.filter((k) => parsed[k] && !parsed[k].errors.length);
    summary.replaceChildren(...ready.map((k) => h('div', { class: 'ds-sum-i' },
      h('span', { class: 'tab-chip' }, FORMATS[k].sheet), h('b', {}, `${parsed[k].rows.length}개`),
      cnt[k] != null ? h('span', { class: 'was' }, `지금 ${cnt[k]}개`) : null)));
  }

  // ── 아래 버튼 ──
  function paintFoot() {
    prev.style.visibility = step ? '' : 'hidden';
    const ready = keys.filter((k) => parsed[k]);
    const bad = ready.some((k) => parsed[k].errors.length);
    next.disabled = false;
    if (step === 0) { next.replaceChildren('다음', icon('right', 'icon s')); next.onclick = () => go(1); }
    else if (step === 1) {
      next.disabled = !ready.length || bad;
      next.replaceChildren(bad ? '오류를 먼저 고쳐 주세요' : ready.length ? '다음' : '붙여넣은 표가 없습니다', ...(ready.length && !bad ? [icon('right', 'icon s')] : []));
      next.onclick = () => go(2);
    } else {
      next.replaceChildren(mode === 'add' ? '추가하기' : '전부 바꾸기');
      next.onclick = run;
    }
    stepBtns.forEach((b, i) => { b.classList.toggle('on', i === step); b.classList.toggle('past', i < step); });
  }
  function go(i) {
    if (i < 0 || i > 2) return;
    if (i === 2 && (!keys.some((k) => parsed[k]) || keys.some((k) => parsed[k]?.errors.length))) { toast('붙여넣은 표를 먼저 확인해 주세요'); return; }
    const dir = i > step ? 1 : -1;
    step = i;
    pages.forEach((p, j) => { p.classList.toggle('on', j === i); });
    const pg = pages[i]; pg.style.animation = 'none'; void pg.offsetWidth; pg.style.animation = `${dir > 0 ? 'dsIn' : 'dsBack'} .32s var(--ease) both`;
    sheet.querySelector('.ds-body').scrollTop = 0;
    if (i === 2) paintSummary();
    paintFoot();
  }
  async function run() {
    busy(next, true);
    try {
      const ready = Object.fromEntries(keys.filter((k) => parsed[k]).map((k) => [k, parsed[k].rows]));
      await apply(range.id, mode, ready, { pool: sub.progress_pool || sub.id });
      resetCaches(); resetHints(); resetStudyCaches();
      if (draft) await draft.done?.();
      close(); toast('데이터를 넣었습니다'); onDone?.();
    } catch (err) { busy(next, false); paintFoot(); toast(err.message || '넣지 못했습니다'); }
  }

  go(draft ? 1 : 0);
  (async () => {
    [cnt, units] = await Promise.all([counts(range.id), existingCodes(range.id)]);
    cards.forEach((c, i) => { const v = cnt[keys[i]]; c.now.textContent = v == null ? '' : `지금 ${v}개`; });
    if (draft) {
      // 단원 표가 먼저 읽혀야 다른 표의 단원 확인이 맞음
      const order = [...keys].sort((a, b) => (a === 'units' ? -1 : b === 'units' ? 1 : 0));
      order.forEach((k) => { const c = cards[keys.indexOf(k)]; const t = draft.payload?.[k]; if (c && t) { c.querySelector('textarea').value = t; c.run(); } });
    }
  })();
}

function previewTable(k, rows) {  // eslint-disable-line no-param-reassign
  const cols = {
    units: [['code', 'id'], ['label', '이름']],
    hanja: [['ch', '한자'], ['reading', '훈음']],
    hanja_unit: [['unit', '단원'], ['ch', '한자'], ['reading', '훈음']],
    jung: [['page', '묶음'], ['hanja', '원문'], ['translation', '해석'], ['notes', '주석']],
    um: [['unit', '단원'], ['sentence', '원문'], ['cards', '카드'], ['orders', '순서'], ['translation', '해석']],
    flash: [['deck', '묶음'], ['front', '앞면'], ['back', '뒷면'], ['hint', '암기법']],
    occ: [['deck', '묶음'], ['klabel', '형식'], ['title', '그림'], ['where', '위치'], ['names', '이름']],
    past: [['exam', '시험'], ['no', '번호'], ['tlabel', '형식'], ['tag', '단원'], ['question', '문제'], ['answer', '정답'], ['src', '근거']],
    pred: [['exam', '자료'], ['no', '번호'], ['tlabel', '형식'], ['tag', '단원'], ['question', '문제'], ['answer', '정답']],
  }[k];
  if (k === 'occ') rows = rows.map((r) => ({ ...r, klabel: r.kind === 'whole' ? '그림 전체' : '가리기', where: [r.file, r.page ? `${r.page}장` : ''].filter(Boolean).join(' '), names: r.names.join(', ') }));
  if (k === 'past' || k === 'pred') rows = rows.map((r) => ({ ...r, tlabel: { mc: '객관식', ox: 'OX', blank: '빈칸', short: '단답', essay: '서술' }[r.type], src: r.ai ? 'AI' : '기출' }));
  const v = (x) => (Array.isArray(x) ? x.join(k === 'jung' ? ', ' : ' / ') : x);
  return h('div', { class: 'imp-tbl' }, h('table', {},
    h('thead', {}, h('tr', {}, cols.map(([, l]) => h('th', {}, l)))),
    h('tbody', {}, rows.slice(0, 5).map((r) => h('tr', {}, cols.map(([c]) => h('td', {}, v(r[c]))))))),
  rows.length > 5 ? h('div', { class: 'more' }, `외 ${rows.length - 5}개`) : null);
}

// 이 과목 기출 (모든 범위) : 예상문제 부탁 글에 스타일 예시로
async function pastOf(subjectId) {
  try {
    const { data: rs } = await sb.from('ranges').select('id').eq('subject_id', subjectId);
    const ids = (rs || []).map((r) => r.id); if (!ids.length) return [];
    let r = await sb.from('past_questions').select('type,question,choices,answer').in('range_id', ids).eq('kind', 'past').order('sort').limit(500);
    if (r.error) r = await sb.from('past_questions').select('type,question,choices,answer').in('range_id', ids).order('sort').limit(500);
    return r.data || [];
  } catch { return []; }
}
