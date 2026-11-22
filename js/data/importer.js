import { sb } from '../sb.js';
import { FORMATS } from './formats.js';
import { fetchAll } from './hanja.js';

// ─────────────────────────────────────────────
// 시트에서 복사한 표 → 확인 → 넣기
// ─────────────────────────────────────────────

// 구글 시트 · 엑셀 복사 = 탭으로 나뉜 글 (칸 안 줄바꿈은 "..." 로 감싸짐)
export function parseTSV(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const s = String(text || '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean));
}

const HEAD = new Set(['id', 'unit', 'hanja', 'page', '한자', '단원', 'hun-eum', 'label']);
const splitSlash = (v) => String(v || '').split('/').map((x) => x.replace(/\s+/g, '')).filter(Boolean);

// 형식별 확인 : { rows, errors[], warns[] }
export function check(key, text, ctx = {}) {
  let raw = parseTSV(text);
  if (raw.length && HEAD.has((raw[0][0] || '').toLowerCase())) raw = raw.slice(1);
  const errors = []; const warns = []; const rows = [];
  const at = (i) => `${i + 1}행`;
  if (key === 'units') {
    const seen = new Set();
    raw.forEach((r, i) => {
      const [code, label, order] = r;
      if (!code || !label) { errors.push(`${at(i)} : id와 단원 이름이 필요합니다`); return; }
      if (!/^[a-z0-9_]+$/.test(code)) warns.push(`${at(i)} : id "${code}" 에 소문자, 숫자 말고 다른 글자가 있습니다`);
      if (seen.has(code)) { warns.push(`${at(i)} : id "${code}" 가 중복되어 한 번만 넣습니다`); return; }
      seen.add(code); rows.push({ code, label, order: parseFloat(order) || rows.length + 1 });
    });
    rows.sort((a, b) => a.order - b.order);
  } else if (key === 'hanja') {
    const seen = new Map();
    raw.forEach((r, i) => {
      const [ch, rd] = r;
      if (!ch) return;
      if ([...ch].length !== 1) warns.push(`${at(i)} : "${ch}" 는 한 글자가 아닙니다`);
      if (!rd) warns.push(`${at(i)} : ${ch} 의 훈음이 비어 있습니다`);
      if (seen.has(ch)) { const o = seen.get(ch); if (rd && !o.reading.split(' / ').includes(rd)) o.reading = o.reading ? `${o.reading} / ${rd}` : rd; return; }
      const o = { ch, reading: rd || '' }; seen.set(ch, o); rows.push(o);
    });
  } else if (key === 'hanja_unit') {
    const seen = new Map();
    raw.forEach((r, i) => {
      const [unit, ch, rd] = r;
      if (!ch) return;
      if (!unit) { errors.push(`${at(i)} : ${ch} 의 단원 id 가 비어 있습니다`); return; }
      if (ctx.codes && !ctx.codes.has(unit)) { errors.push(`${at(i)} : 단원 id "${unit}" 가 단원 표에 없습니다`); return; }
      if ([...ch].length !== 1) warns.push(`${at(i)} : "${ch}" 는 한 글자가 아닙니다`);
      const k = `${unit}\u0000${ch}`;
      if (seen.has(k)) { const o = seen.get(k); if (rd && !o.reading.split(' / ').includes(rd)) o.reading = o.reading ? `${o.reading} / ${rd}` : rd; return; }
      const o = { unit, ch, reading: rd || '' }; seen.set(k, o); rows.push(o);
    });
  } else if (key === 'jung') {
    let last = '';
    raw.forEach((r, i) => {
      const [page, hanja, eum, tr, ...notes] = r;
      if (!hanja && !eum && !tr) return;
      const p = page || last;
      if (!p) { errors.push(`${at(i)} : 묶음 번호(page)가 비어 있습니다`); return; }
      last = p;
      rows.push({ page: p, hanja: hanja || '', eum: eum || '', translation: tr || '', notes: notes.filter(Boolean).slice(0, 10) });
    });
    const groups = new Set(rows.map((r) => r.page));
    groups.forEach((p) => { if (!rows.some((r) => r.page === p && r.translation)) warns.push(`묶음 ${p} : 해석이 비어 있습니다`); });
  } else if (key === 'um') {
    raw.forEach((r, i) => {
      const [unit, sentence, cards, order, tr, src] = r;
      if (!unit && !cards) return;
      const cs = splitSlash(cards); const os = splitSlash(order).map(Number);
      if (!unit) { errors.push(`${at(i)} : 단원 id 가 비어 있습니다`); return; }
      if (ctx.codes && !ctx.codes.has(unit)) { errors.push(`${at(i)} : 단원 id "${unit}" 가 단원 표에 없습니다`); return; }
      if (!cs.length) { errors.push(`${at(i)} : 카드가 비어 있습니다`); return; }
      if (cs.length !== os.length) { errors.push(`${at(i)} : 카드는 ${cs.length}개인데 순서는 ${os.length}개라 개수가 다릅니다`); return; }
      const sorted = os.slice().sort((a, b) => a - b);
      if (sorted.some((v, j) => v !== j + 1)) { errors.push(`${at(i)} : 순서가 1부터 ${os.length}까지 빠짐없이 있어야 합니다`); return; }
      if (!tr) warns.push(`${at(i)} : 해석이 비어 있습니다`);
      rows.push({ unit, sentence: sentence || cs.join(''), cards: cs, orders: os, translation: tr || '', source: src || '' });
    });
  }
  if (raw.length && !rows.length && !errors.length) errors.push('읽을 수 있는 행이 없습니다. 칸 순서를 확인하세요');
  return { rows, errors, warns };
}

// 지금 들어 있는 개수
export async function counts(rangeId) {
  const c = async (t) => { const { count } = await sb.from(t).select('id', { count: 'exact', head: true }).eq('range_id', rangeId); return count ?? null; };
  const [units, hanja, jung, um] = await Promise.all([c('hanja_units'), c('hanja_cards'), c('jung_lines'), c('um_sentences')]);
  return { units, hanja, hanja_unit: hanja, jung, um };
}

export async function existingCodes(rangeId) {
  const { data } = await sb.from('hanja_units').select('id,code,sort').eq('range_id', rangeId);
  return data || [];
}

// 넣기 : mode 'add' (이어서 추가) | 'replace' (범위 전체 바꾸기)
export async function apply(rangeId, mode, parsed, log = () => {}) {
  const ok = (r) => { if (r.error) throw new Error(r.error.message || '저장에 실패했습니다'); return r; };
  const chunks = (a, n = 400) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
  const maxSort = async (t) => { const { data } = await sb.from(t).select('sort').eq('range_id', rangeId).order('sort', { ascending: false }).limit(1); return data?.[0]?.sort ?? -1; };

  // 단원
  if (parsed.units) {
    log('단원');
    if (mode === 'replace') ok(await sb.from('hanja_units').delete().eq('range_id', rangeId));
    const have = mode === 'replace' ? [] : await existingCodes(rangeId);
    let s = have.reduce((m, u) => Math.max(m, u.sort), -1);
    const rows = parsed.units.map((u) => { const e = have.find((x) => x.code === u.code); return { range_id: rangeId, code: u.code, label: u.label, sort: e ? e.sort : ++s }; });
    ok(await sb.from('hanja_units').upsert(rows, { onConflict: 'range_id,code' }));
  }
  const unitMap = new Map((await existingCodes(rangeId)).map((u) => [u.code, u.id]));

  // 한자
  if (parsed.hanja) {
    log('한자');
    if (mode === 'replace') {
      ok(await sb.from('hanja_cards').delete().eq('range_id', rangeId));
      for (const part of chunks(parsed.hanja.map((r, i) => ({ range_id: rangeId, ch: r.ch, reading: r.reading, sort: i })))) ok(await sb.from('hanja_cards').insert(part));
    } else {
      const have = await fetchAll(() => sb.from('hanja_cards').select('id,ch,sort').eq('range_id', rangeId).order('sort'));
      const byCh = new Map(have.map((x) => [x.ch, x]));
      let s = have.reduce((m, x) => Math.max(m, x.sort), -1);
      const upd = []; const ins = [];
      parsed.hanja.forEach((r) => { const e = byCh.get(r.ch); if (e) upd.push({ id: e.id, range_id: rangeId, ch: r.ch, reading: r.reading, sort: e.sort }); else ins.push({ range_id: rangeId, ch: r.ch, reading: r.reading, sort: ++s }); });
      for (const part of chunks(upd)) ok(await sb.from('hanja_cards').upsert(part, { onConflict: 'id' }));
      for (const part of chunks(ins)) ok(await sb.from('hanja_cards').insert(part));
    }
  }
  if (parsed.hanja_unit) {
    log('한자');
    const units = [...new Set(parsed.hanja_unit.map((r) => r.unit))];
    if (mode === 'replace') ok(await sb.from('hanja_cards').delete().eq('range_id', rangeId));
    else ok(await sb.from('hanja_cards').delete().eq('range_id', rangeId).in('unit_id', units.map((c) => unitMap.get(c))));
    let s = mode === 'replace' ? -1 : await maxSort('hanja_cards');
    const rows = parsed.hanja_unit.map((r) => ({ range_id: rangeId, unit_id: unitMap.get(r.unit), ch: r.ch, reading: r.reading, sort: ++s }));
    for (const part of chunks(rows)) ok(await sb.from('hanja_cards').insert(part));
  }

  // 해석
  if (parsed.jung) {
    log('해석');
    let off = 0; let s = -1;
    if (mode === 'replace') ok(await sb.from('jung_lines').delete().eq('range_id', rangeId));
    else {
      const have = await fetchAll(() => sb.from('jung_lines').select('page,sort').eq('range_id', rangeId).order('sort'));
      off = have.reduce((m, x) => Math.max(m, parseInt(x.page, 10) || 0), 0);
      s = have.reduce((m, x) => Math.max(m, x.sort), -1);
    }
    const rows = parsed.jung.map((r) => ({ range_id: rangeId, page: /^\d+$/.test(r.page) ? String(+r.page + off) : r.page, sort: ++s, hanja: r.hanja, eum: r.eum, translation: r.translation, notes: r.notes }));
    for (const part of chunks(rows)) ok(await sb.from('jung_lines').insert(part));
  }

  // 문장
  if (parsed.um) {
    log('문장');
    const units = [...new Set(parsed.um.map((r) => r.unit))];
    if (mode === 'replace') ok(await sb.from('um_sentences').delete().eq('range_id', rangeId));
    else ok(await sb.from('um_sentences').delete().eq('range_id', rangeId).in('unit_id', units.map((c) => unitMap.get(c))));
    let s = mode === 'replace' ? -1 : await maxSort('um_sentences');
    const rows = parsed.um.map((r) => ({ range_id: rangeId, unit_id: unitMap.get(r.unit), sort: ++s, sentence: r.sentence, cards: r.cards, orders: r.orders, translation: r.translation, source: r.source }));
    for (const part of chunks(rows)) ok(await sb.from('um_sentences').insert(part));
  }
}
