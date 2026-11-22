import { h, icon, toast, busy } from '../ui.js';
import { FORMATS, formatsFor, SAMPLE_DESC, buildPrompt } from '../data/formats.js';
import { check, counts, existingCodes, apply } from '../data/importer.js';
import { resetCaches } from '../data/hanja.js';
import { resetStudyCaches } from '../data/study.js';

// ─────────────────────────────────────────────
// 데이터 넣기 (과목 화면 오른쪽 위 아이콘 → 아래에서 올라오는 창)
//  ① 프롬프트 복사 → (AI 에게 자료와 함께 보내 엑셀 받기) → ② 붙여넣기 → ③ 넣기
// ─────────────────────────────────────────────
export function openDataSheet(sub, range, onDone) {
  const keys = formatsFor((sub.blocks || []).map((b) => b.kind));
  if (!keys.length) { toast('이 과목은 넣을 데이터 형식이 없습니다'); return; }
  let step = 0;
  let mode = 'add';
  const parsed = {};
  let cnt = {}; let units = [];

  const stepBtns = ['프롬프트 복사', '붙여넣기', '넣기'].map((t, i) =>
    h('button', { class: 'ds-step', onclick: () => go(i) }, h('b', {}, i + 1), h('span', {}, t)));
  const pages = [h('section', { class: 'ds-page' }), h('section', { class: 'ds-page' }), h('section', { class: 'ds-page' })];
  const next = h('button', { class: 'btn ink ds-next' });
  const prev = h('button', { class: 'btn ghost ds-prev', onclick: () => go(step - 1) }, icon('back', 'icon s'), '이전');
  const sheet = h('div', { class: 'ds', role: 'dialog', 'aria-modal': 'true' },
    h('header', { class: 'ds-head' },
      h('div', { class: 'ds-ttl' }, h('span', { class: 'emo' }, sub.icon || ''), h('div', {}, h('h2', {}, '데이터 넣기'), h('span', {}, `${sub.name} · ${range.name}`))),
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

  // ── ① 프롬프트 ──
  const dkey = `kmed:desc:${sub.id}`;
  const desc = h('textarea', { class: 'imp-desc', rows: 8, placeholder: '예) 왼쪽 단에 원문 · 해석, 오른쪽 표에 훈음. 문장은 가로 구분선으로 나뉨.' });
  desc.value = localStorage.getItem(dkey) ?? (keys.includes('um') ? SAMPLE_DESC.um : keys.includes('jung') ? SAMPLE_DESC.jung : '');
  desc.addEventListener('input', () => { try { localStorage.setItem(dkey, desc.value); } catch { /* 무시 */ } });
  let copied = false;
  const copyBtn = h('button', { class: 'ds-copy', onclick: async () => {
    const text = buildPrompt(keys, desc.value);
    try { await navigator.clipboard.writeText(text); } catch {
      const t = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text); document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
    }
    copied = true; copyBtn.classList.add('done'); copyBtn.lastChild.textContent = '복사했습니다'; toast('프롬프트를 복사했습니다'); paintFoot();
    setTimeout(() => { if (copyBtn.isConnected) { copyBtn.classList.remove('done'); copyBtn.lastChild.textContent = '프롬프트 복사'; } }, 2200);
  } }, icon('copy'), h('span', {}, '프롬프트 복사'));
  pages[0].append(
    flow(),
    h('label', { class: 'imp-lab' }, '이번 자료 설명'),
    desc,
    h('div', { class: 'ds-row' },
      h('div', { class: 'imp-tabs' }, keys.map((k) => h('span', {}, FORMATS[k].sheet))),
      h('div', { class: 'sp' }),
      h('button', { class: 'txt-btn', onclick: () => { pre.hidden = !pre.hidden; if (!pre.hidden) pre.textContent = buildPrompt(keys, desc.value); } }, '전체 보기'),
      copyBtn),
    h('pre', { class: 'imp-pre', hidden: true }));
  const pre = pages[0].querySelector('.imp-pre');

  // ── ② 붙여넣기 ──
  const cards = keys.map((k) => {
    const f = FORMATS[k];
    const ta = h('textarea', { class: 'imp-paste', rows: 4, placeholder: `엑셀의 "${f.sheet}" 탭 → 전체 선택(⌘A) → 복사 → 여기에 붙여넣기`, spellcheck: 'false' });
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
  pages[1].append(h('p', { class: 'ds-lead' }, 'AI 가 준 엑셀의 탭을 하나씩 복사해서 붙여넣습니다. 넣을 탭만 붙여넣어도 됩니다.'), ...cards);

  // ── ③ 넣기 ──
  const summary = h('div', { class: 'ds-sum' });
  const opt = (v, t, d) => h('button', { class: 'ds-opt', 'data-v': v, onclick: () => { mode = v; paintOpt(); } }, h('i', { class: 'rd' }), h('div', {}, h('b', {}, t), h('span', {}, d)));
  const opts = h('div', { class: 'ds-opts' },
    opt('add', '추가하기', keys.includes('um') ? '붙여넣은 단원만 새로 넣습니다. 같은 단원이 이미 있으면 그 단원만 새것으로 바뀝니다.' : '지금 데이터 뒤에 이어 붙입니다. 이미 있는 한자는 훈음만 고칩니다.'),
    opt('replace', '전부 바꾸기', `${range.name} 범위의 해당 데이터를 모두 지우고 붙여넣은 것으로 바꿉니다. 해석 · 문장 풀이 기록은 사라집니다.`));
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
    if (step === 0) { next.replaceChildren(copied ? '다음' : '건너뛰고 붙여넣기', icon('right', 'icon s')); next.onclick = () => go(1); }
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
      await apply(range.id, mode, ready);
      resetCaches(); resetStudyCaches();
      close(); toast('데이터를 넣었습니다'); onDone?.();
    } catch (err) { busy(next, false); paintFoot(); toast(err.message || '넣지 못했습니다'); }
  }

  go(0);
  (async () => {
    [cnt, units] = await Promise.all([counts(range.id), existingCodes(range.id)]);
    cards.forEach((c, i) => { const v = cnt[keys[i]]; c.now.textContent = v == null ? '' : `지금 ${v}개`; });
  })();
}

// 흐름 그림 : 프롬프트 → AI → 엑셀 → 앱
function flow() {
  const s = (ic, t) => h('div', { class: 'fl-s' }, h('div', { class: 'fl-ic' }, icon(ic)), h('span', {}, t));
  const a = () => h('div', { class: 'fl-a' }, icon('right', 'icon s'));
  return h('div', { class: 'ds-flow' },
    s('copy', '프롬프트 복사'), a(), s('spark', 'AI 에게 자료와 함께'), a(), s('sheet', '엑셀 받기'), a(), s('import', '앱에 붙여넣기'));
}

function previewTable(k, rows) {
  const cols = {
    units: [['code', 'id'], ['label', '이름']],
    hanja: [['ch', '한자'], ['reading', '훈음']],
    hanja_unit: [['unit', '단원'], ['ch', '한자'], ['reading', '훈음']],
    jung: [['page', '묶음'], ['hanja', '원문'], ['translation', '해석'], ['notes', '주석']],
    um: [['unit', '단원'], ['sentence', '원문'], ['cards', '카드'], ['orders', '순서'], ['translation', '해석']],
  }[k];
  const v = (x) => (Array.isArray(x) ? x.join(k === 'jung' ? ' · ' : ' / ') : x);
  return h('div', { class: 'imp-tbl' }, h('table', {},
    h('thead', {}, h('tr', {}, cols.map(([, l]) => h('th', {}, l)))),
    h('tbody', {}, rows.slice(0, 5).map((r) => h('tr', {}, cols.map(([c]) => h('td', {}, v(r[c]))))))),
  rows.length > 5 ? h('div', { class: 'more' }, `외 ${rows.length - 5}개`) : null);
}
