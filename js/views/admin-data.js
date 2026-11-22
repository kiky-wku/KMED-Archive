import { sb } from '../sb.js';
import { h, icon, toast, seg, modal, busy, gradeLabel, skelRows } from '../ui.js';
import { FORMATS, formatsFor, SAMPLE_DESC, buildPrompt } from '../data/formats.js';
import { check, counts, existingCodes, apply } from '../data/importer.js';
import { resetCaches } from '../data/hanja.js';
import { resetStudyCaches } from '../data/study.js';

// ═════════════ 데이터 넣기 ═════════════
//  1) 프롬프트 만들기 : 이번 자료 설명 + 앱 형식(자동)
//  2) 시트에서 복사 → 붙여넣기 → 확인 → 넣기
export async function dataTab(area) {
  const wrap = h('div', { class: 'imp' }, skelRows(4));
  area.append(wrap);
  const { data: subs } = await sb.from('subjects').select('id,name,icon,grade,semester,sort,ranges(id,name,sort),blocks(kind,sort)').order('grade').order('semester').order('sort');
  const list = (subs || []).filter((s) => formatsFor((s.blocks || []).map((b) => b.kind)).length && (s.ranges || []).length);
  if (!list.length) { wrap.replaceChildren(h('div', { class: 'empty sm' }, '데이터를 넣을 수 있는 과목이 없습니다')); return; }

  const last = (() => { try { return JSON.parse(localStorage.getItem('kmed:imp') || '{}'); } catch { return {}; } })();
  let sub = list.find((s) => s.id === last.s) || list[0];
  let rangeId = null;
  let mode = 'add';

  const subSel = h('select', { class: 'input sel' }, list.map((s) => h('option', { value: s.id, selected: s === sub }, `${gradeLabel(s.grade)} ${s.semester}학기 · ${s.icon || ''} ${s.name}`)));
  const rangeBox = h('div');
  const body = h('div', { class: 'imp-body' });
  subSel.addEventListener('change', () => { sub = list.find((s) => s.id === subSel.value); rangeId = null; draw(); });
  wrap.replaceChildren(h('div', { class: 'toolbar' }, subSel, rangeBox), body);

  async function draw() {
    const ranges = (sub.ranges || []).sort((a, b) => a.sort - b.sort);
    rangeId = rangeId || (ranges.find((r) => r.id === last.r) || ranges[0]).id;
    try { localStorage.setItem('kmed:imp', JSON.stringify({ s: sub.id, r: rangeId })); } catch { /* 무시 */ }
    rangeBox.replaceChildren(seg(ranges.map((r) => [r.id, r.name]), rangeId, (v) => { rangeId = v; draw(); }));
    const keys = formatsFor((sub.blocks || []).map((b) => b.kind));
    body.replaceChildren(skelRows(3));
    const [cnt, units] = await Promise.all([counts(rangeId), existingCodes(rangeId)]);

    // ── 1. 프롬프트 ──
    const dkey = `kmed:desc:${sub.id}`;
    const desc = h('textarea', { class: 'imp-desc', rows: 7, placeholder: '이번 자료가 어떻게 생겼는지 적으세요 (페이지 구성, 문장 구분 기준, 훈음이 적힌 곳 …)' });
    desc.value = localStorage.getItem(dkey) ?? (keys.includes('um') ? SAMPLE_DESC.um : keys.includes('jung') ? SAMPLE_DESC.jung : '');
    desc.addEventListener('input', () => { try { localStorage.setItem(dkey, desc.value); } catch { /* 무시 */ } });
    const copy = h('button', { class: 'btn sm ink', onclick: async () => {
      const text = buildPrompt(keys, desc.value);
      try { await navigator.clipboard.writeText(text); toast('프롬프트를 복사했습니다'); }
      catch { modal({ title: '프롬프트', body: h('textarea', { class: 'imp-desc', rows: 18, readonly: true }, text) }); }
    } }, icon('book', 'icon s'), '프롬프트 복사');
    const preview = h('button', { class: 'btn sm ghost', onclick: () => modal({ title: '프롬프트 미리보기', wide: true, body: h('pre', { class: 'imp-pre' }, buildPrompt(keys, desc.value)) }) }, '미리보기');

    // ── 2. 붙여넣기 ──
    const parsed = {};
    const cards = keys.map((k) => {
      const f = FORMATS[k];
      const ta = h('textarea', { class: 'imp-paste', rows: 5, placeholder: `시트의 "${f.sheet}" 탭을 전체 선택해서 복사한 뒤 붙여넣으세요`, spellcheck: 'false' });
      const res = h('div', { class: 'imp-res' });
      const card = h('section', { class: 'imp-card' },
        h('header', {}, h('h3', {}, f.label), h('span', { class: 'now' }, cnt[k] == null ? '' : `지금 ${cnt[k]}개`)),
        h('div', { class: 'imp-cols' }, f.cols.slice(0, 6).map(([c, d]) => h('span', {}, h('b', {}, c), d)), f.cols.length > 6 ? h('span', {}, `… ${f.cols.length}칸`) : null),
        ta, res);
      card.run = () => {
        const codes = new Set([...units.map((u) => u.code), ...((parsed.units || {}).rows || []).map((u) => u.code)]);
        if (!ta.value.trim()) { delete parsed[k]; res.replaceChildren(); card.classList.remove('ok', 'bad'); return; }
        const r = check(k, ta.value, { codes: k === 'hanja_unit' || k === 'um' ? codes : null });
        parsed[k] = r;
        card.classList.toggle('bad', r.errors.length > 0);
        card.classList.toggle('ok', !r.errors.length);
        res.replaceChildren(...[
          h('div', { class: 'sum' }, r.errors.length ? icon('x', 'icon s') : icon('check', 'icon s'), `${r.rows.length}개 읽음`,
            r.errors.length ? h('em', { class: 'e' }, `오류 ${r.errors.length}`) : null, r.warns.length ? h('em', { class: 'w' }, `확인 ${r.warns.length}`) : null),
          r.errors.length || r.warns.length ? h('ul', { class: 'msgs' }, [...r.errors.map((m) => h('li', { class: 'e' }, m)), ...r.warns.map((m) => h('li', { class: 'w' }, m))].slice(0, 30)) : null,
          r.rows.length ? previewTable(k, r.rows) : null].filter(Boolean));
        foot();
      };
      ta.addEventListener('input', () => { clearTimeout(ta.t); ta.t = setTimeout(() => { card.run(); if (k === 'units') cards.forEach((c) => c !== card && c.run()); }, 250); });
      return card;
    });

    const modeSeg = seg([['add', '이어서 추가'], ['replace', '범위 전체 바꾸기']], mode, (v) => { mode = v; foot(); });
    const go = h('button', { class: 'btn ink', onclick: run });
    const note = h('div', { class: 'imp-note' });
    function foot() {
      const ready = keys.filter((k) => parsed[k]);
      const bad = ready.some((k) => parsed[k].errors.length);
      go.disabled = !ready.length || bad;
      go.textContent = bad ? '오류를 고친 뒤 넣을 수 있습니다' : ready.length ? `${ready.map((k) => FORMATS[k].label).join(' · ')} 넣기` : '붙여넣은 표가 없습니다';
      note.textContent = mode === 'add'
        ? (keys.includes('um') ? '붙여넣은 단원만 새로 넣고, 같은 단원이 이미 있으면 그 단원만 바꿉니다.' : '기존 내용 뒤에 이어 붙입니다. 이미 있는 한자는 훈음만 고칩니다.')
        : '이 범위의 해당 내용을 모두 지우고 새로 넣습니다. 해석 · 문장 기록은 초기화됩니다.';
    }
    async function run() {
      const ready = Object.fromEntries(keys.filter((k) => parsed[k]).map((k) => [k, parsed[k].rows]));
      const rangeName = (sub.ranges || []).find((r) => r.id === rangeId)?.name || '';
      const m = modal({
        title: mode === 'add' ? '이어서 추가' : '범위 전체 바꾸기',
        body: h('div', { class: 'imp-confirm' },
          h('p', {}, `${sub.name} · ${rangeName}`),
          h('ul', {}, Object.entries(ready).map(([k, rows]) => h('li', {}, h('b', {}, FORMATS[k].label), `${rows.length}개`))),
          mode === 'replace' ? h('p', { class: 'warn' }, '기존 내용은 지워지고 되돌릴 수 없습니다.') : null),
        actions: [h('button', { class: 'btn ghost', onclick: () => m.close() }, '취소'), h('button', { class: 'btn ink', onclick: async (e) => {
          const b = e.currentTarget; busy(b, true, '넣는 중');
          try {
            await apply(rangeId, mode, ready);
            resetCaches(); resetStudyCaches();
            m.close(); toast('데이터를 넣었습니다'); draw();
          } catch (err) { busy(b, false); toast(err.message || '넣지 못했습니다'); }
        } }, '넣기')],
      });
    }
    foot();

    body.replaceChildren(
      h('section', { class: 'imp-card imp-prompt' },
        h('header', {}, h('h3', {}, h('span', { class: 'step' }, '1'), '프롬프트 만들기')),
        h('label', { class: 'imp-lab' }, '이번 자료 설명'), desc,
        h('div', { class: 'imp-row' }, h('div', { class: 'imp-tabs' }, keys.map((k) => h('span', {}, FORMATS[k].sheet))), h('div', { class: 'sp' }), preview, copy)),
      h('h3', { class: 'imp-h' }, h('span', { class: 'step' }, '2'), '시트에서 붙여넣기'),
      ...cards,
      h('section', { class: 'imp-foot' }, modeSeg, note, go));
  }
  draw();
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
    h('tbody', {}, rows.slice(0, 6).map((r) => h('tr', {}, cols.map(([c]) => h('td', {}, v(r[c]))))))),
  rows.length > 6 ? h('div', { class: 'more' }, `외 ${rows.length - 6}개`) : null);
}
