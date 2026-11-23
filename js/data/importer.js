import { sb } from '../sb.js';
import { dropImgs } from './images.js';
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

const HEAD = new Set(['id', 'unit', 'hanja', 'page', '한자', '단원', 'hun-eum', 'label', 'deck', '묶음', 'front', '앞면', 'exam', '시험 이름', '시험', '묶음 (단원)']);
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
      const [ch, rd, hint] = r;
      if (!ch) return;
      if ([...ch].length !== 1) warns.push(`${at(i)} : "${ch}"는 한 글자가 아닙니다`);
      if (!rd) warns.push(`${at(i)} : ${ch}의 훈음이 비어 있습니다`);
      if (seen.has(ch)) { const o = seen.get(ch); if (rd && !o.reading.split(' / ').includes(rd)) o.reading = o.reading ? `${o.reading} / ${rd}` : rd; if (hint && !o.hint) o.hint = hint; return; }
      const o = { ch, reading: rd || '', hint: hint || '' }; seen.set(ch, o); rows.push(o);
    });
  } else if (key === 'hanja_unit') {
    const seen = new Map();
    raw.forEach((r, i) => {
      const [unit, ch, rd, hint] = r;
      if (!ch) return;
      if (!unit) { errors.push(`${at(i)} : ${ch} 의 단원 id 가 비어 있습니다`); return; }
      if (ctx.codes && !ctx.codes.has(unit)) { errors.push(`${at(i)} : 단원 id "${unit}" 가 단원 표에 없습니다`); return; }
      if ([...ch].length !== 1) warns.push(`${at(i)} : "${ch}" 는 한 글자가 아닙니다`);
      const k = `${unit}\u0000${ch}`;
      if (seen.has(k)) { const o = seen.get(k); if (rd && !o.reading.split(' / ').includes(rd)) o.reading = o.reading ? `${o.reading} / ${rd}` : rd; if (hint && !o.hint) o.hint = hint; return; }
      const o = { unit, ch, reading: rd || '', hint: hint || '' }; seen.set(k, o); rows.push(o);
    });
  } else if (key === 'jung') {
    let last = '';
    raw.forEach((r, i) => {
      const [page, hanja, eum, tr, ...rest] = r;
      const notes = rest.slice(0, 10); const hint = rest[10] || '';
      if (!hanja && !eum && !tr) return;
      const p = page || last;
      if (!p) { errors.push(`${at(i)} : 묶음 번호(page)가 비어 있습니다`); return; }
      last = p;
      rows.push({ page: p, hanja: hanja || '', eum: eum || '', translation: tr || '', notes: notes.filter(Boolean), hint });
    });
    const groups = new Set(rows.map((r) => r.page));
    groups.forEach((p) => { if (!rows.some((r) => r.page === p && r.translation)) warns.push(`묶음 ${p} : 해석이 비어 있습니다`); });
  } else if (key === 'um') {
    raw.forEach((r, i) => {
      const [unit, sentence, cards, order, tr, src, hint] = r;
      if (!unit && !cards) return;
      const cs = splitSlash(cards); const os = splitSlash(order).map(Number);
      if (!unit) { errors.push(`${at(i)} : 단원 id 가 비어 있습니다`); return; }
      if (ctx.codes && !ctx.codes.has(unit)) { errors.push(`${at(i)} : 단원 id "${unit}" 가 단원 표에 없습니다`); return; }
      if (!cs.length) { errors.push(`${at(i)} : 카드가 비어 있습니다`); return; }
      if (cs.length !== os.length) { errors.push(`${at(i)} : 카드는 ${cs.length}개인데 순서는 ${os.length}개라 개수가 다릅니다`); return; }
      const sorted = os.slice().sort((a, b) => a - b);
      if (sorted.some((v, j) => v !== j + 1)) { errors.push(`${at(i)} : 순서가 1부터 ${os.length}까지 빠짐없이 있어야 합니다`); return; }
      if (!tr) warns.push(`${at(i)} : 해석이 비어 있습니다`);
      rows.push({ unit, sentence: sentence || cs.join(''), cards: cs, orders: os, translation: tr || '', source: src || '', hint: hint || '' });
    });
  } else if (key === 'flash') {
    raw.forEach((r, i) => {
      const [deck, front, back, hint] = r;
      if (!front && !back) return;
      if (!front || !back) { errors.push(`${at(i)} : 앞면과 뒷면이 모두 있어야 합니다`); return; }
      rows.push({ deck: deck || '', front, back, hint: hint || '' });
    });
    if (rows.length && !rows.some((r) => r.deck)) warns.push('묶음이 비어 있어 모두 한 묶음으로 들어갑니다');
  } else if (key === 'occ') {
    const T = { 가리기: 'label', 이름가리기: 'label', label: 'label', 그림전체: 'whole', 전체: 'whole', 맞히기: 'whole', whole: 'whole' };
    raw.forEach((r, i) => {
      const [deck, type, title, file, page, names, hint] = r;
      if (!title && !names) return;
      const t = T[String(type || '').replace(/\s/g, '')] || null;
      if (!t) warns.push(`${at(i)} : 형식 "${type || ''}" 을 몰라 가리기로 넣습니다`);
      const ns = [...new Set(String(names || '').split('|').map((x) => x.trim()).filter(Boolean))];
      const unsure = ns.filter((n) => /\?$/.test(n));
      if (unsure.length) warns.push(`${at(i)} : 확실하지 않은 이름 ${unsure.join(', ')} (그림 카드 만들 때 확인하세요)`);
      if (!ns.length) { errors.push(`${at(i)} : ${title || '그림'} 의 이름이 비어 있습니다`); return; }
      const kind = t || 'label';
      if (kind === 'whole' && ns.length > 1) warns.push(`${at(i)} : 그림 전체 형식은 이름 하나만 씁니다 (${ns[0]})`);
      const pg = parseInt(String(page || '').replace(/[^0-9]/g, ''), 10);
      rows.push({ deck: deck || '', kind, title: title || '', file: file || '', page: Number.isFinite(pg) && pg > 0 ? pg : null, names: kind === 'whole' ? ns.slice(0, 1) : ns.map((n) => n.replace(/\?$/, '').trim()).filter(Boolean), hint: hint || '' });
    });
  } else if (key === 'past') {
    const TYPE = { 객관식: 'mc', ox: 'ox', OX: 'ox', 빈칸: 'blank', 단답: 'short', 단답형: 'short', 서술: 'essay', 서술형: 'essay', 논술: 'essay', mc: 'mc', blank: 'blank', short: 'short', essay: 'essay' };
    const CIRC = '①②③④⑤⑥⑦⑧⑨⑩';
    let lastExam = ctx.exam || '';
    raw.forEach((r, i) => {
      const [exam, no, type, passage, question, choices, answer, explain, source, tag, accept] = r;
      if (!question && !answer) return;
      const ex = exam || lastExam;
      if (!ex) { errors.push(`${at(i)} : 시험 이름이 비어 있습니다`); return; }
      lastExam = ex;
      if (!question) { errors.push(`${at(i)} : 문제가 비어 있습니다`); return; }
      let t = TYPE[(type || '').replace(/\s|형$/g, '')] || TYPE[type] || null;
      const cs = String(choices || '').split('|').map((x) => x.trim().replace(/^[①-⑩]\s*|^\(?\d+[).]\s*/, '')).filter(Boolean);
      if (!t) { t = cs.length ? 'mc' : 'short'; warns.push(`${at(i)} : 형식 "${type || ''}" 을 몰라 ${t === 'mc' ? '객관식' : '단답'}으로 넣습니다`); }
      let a = String(answer || '').trim();
      if (t === 'mc') {
        a = a.replace(/[①-⑩]/g, (c) => String(CIRC.indexOf(c) + 1)).replace(/번/g, '');
        if (!cs.length) errors.push(`${at(i)} : 객관식인데 보기가 없습니다`);
        if (!/^\d+(\s*,\s*\d+)*$/.test(a)) warns.push(`${at(i)} : 객관식 정답 "${answer}" 이 번호가 아닙니다`);
      } else if (t === 'ox') {
        a = /^(o|O|○|맞)/.test(a) ? 'O' : /^(x|X|×|틀)/.test(a) ? 'X' : a;
        if (!['O', 'X'].includes(a)) warns.push(`${at(i)} : OX 정답이 O 나 X 가 아닙니다`);
      }
      if (!a) warns.push(`${at(i)} : 정답이 비어 있습니다`);
      rows.push({ exam: ex, no: no || '', type: t, passage: passage || '', question, choices: t === 'mc' ? cs : [], answer: a, explain: explain || '', ai: !/^기출/.test(source || ''),
        tag: tag || '', accept: ['blank', 'short'].includes(t) ? String(accept || '').split('|').map((x) => x.trim()).filter(Boolean) : [] });
    });
  }
  if (raw.length && !rows.length && !errors.length) errors.push('읽을 수 있는 행이 없습니다. 칸 순서를 확인하세요');
  return { rows, errors, warns };
}

// 지금 들어 있는 개수
export async function counts(rangeId) {
  const c = async (t) => { const { count } = await sb.from(t).select('id', { count: 'exact', head: true }).eq('range_id', rangeId); return count ?? null; };
  const [units, hanja, jung, um, flash, past, occ] = await Promise.all([c('hanja_units'), c('hanja_cards'), c('jung_lines'), c('um_sentences'), c('flash_cards').catch(() => null), c('past_questions').catch(() => null), c('occ_sets').catch(() => null)]);
  return { units, hanja, hanja_unit: hanja, jung, um, flash, past, occ };
}

export async function existingCodes(rangeId) {
  const { data } = await sb.from('hanja_units').select('id,code,sort').eq('range_id', rangeId);
  return data || [];
}

// 넣기 : mode 'add' (이어서 추가) | 'replace' (범위 전체 바꾸기)
export async function apply(rangeId, mode, parsed, { pool } = {}) {
  const ok = (r) => { if (r.error) throw new Error(r.error.message || '저장에 실패했습니다'); return r; };
  const chunks = (a, n = 400) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
  const maxSort = async (t) => { const { data } = await sb.from(t).select('sort').eq('range_id', rangeId).order('sort', { ascending: false }).limit(1); return data?.[0]?.sort ?? -1; };

  // 단원
  if (parsed.units) {
    if (mode === 'replace') ok(await sb.from('hanja_units').delete().eq('range_id', rangeId));
    const have = mode === 'replace' ? [] : await existingCodes(rangeId);
    let s = have.reduce((m, u) => Math.max(m, u.sort), -1);
    const rows = parsed.units.map((u) => { const e = have.find((x) => x.code === u.code); return { range_id: rangeId, code: u.code, label: u.label, sort: e ? e.sort : ++s }; });
    ok(await sb.from('hanja_units').upsert(rows, { onConflict: 'range_id,code' }));
  }
  const unitMap = new Map((await existingCodes(rangeId)).map((u) => [u.code, u.id]));

  // 한자
  if (parsed.hanja) {
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
    const units = [...new Set(parsed.hanja_unit.map((r) => r.unit))];
    if (mode === 'replace') ok(await sb.from('hanja_cards').delete().eq('range_id', rangeId));
    else ok(await sb.from('hanja_cards').delete().eq('range_id', rangeId).in('unit_id', units.map((c) => unitMap.get(c))));
    let s = mode === 'replace' ? -1 : await maxSort('hanja_cards');
    const rows = parsed.hanja_unit.map((r) => ({ range_id: rangeId, unit_id: unitMap.get(r.unit), ch: r.ch, reading: r.reading, sort: ++s }));
    for (const part of chunks(rows)) ok(await sb.from('hanja_cards').insert(part));
  }

  // 한자 암기법 (08 SQL 필요)
  const hints = [...(parsed.hanja || []), ...(parsed.hanja_unit || [])].filter((r) => r.hint);
  if (hints.length && pool) {
    const m = new Map(); hints.forEach((r) => m.set(r.ch, r.hint));
    const rows = [...m].map(([ch, hint]) => ({ pool, ch, hint, updated_at: new Date().toISOString() }));
    for (const part of chunks(rows)) ok(await sb.from('hanja_hints').upsert(part, { onConflict: 'pool,ch' }));
  }

  // 해석
  if (parsed.jung) {
    let off = 0; let s = -1;
    if (mode === 'replace') ok(await sb.from('jung_lines').delete().eq('range_id', rangeId));
    else {
      const have = await fetchAll(() => sb.from('jung_lines').select('page,sort').eq('range_id', rangeId).order('sort'));
      off = have.reduce((m, x) => Math.max(m, parseInt(x.page, 10) || 0), 0);
      s = have.reduce((m, x) => Math.max(m, x.sort), -1);
    }
    // 암기법은 묶음 첫 행에
    const gh = new Map(); parsed.jung.forEach((r) => { if (r.hint && !gh.has(r.page)) gh.set(r.page, r.hint); });
    const seenP = new Set();
    const rows = parsed.jung.map((r) => {
      const o = { range_id: rangeId, page: /^\d+$/.test(r.page) ? String(+r.page + off) : r.page, sort: ++s, hanja: r.hanja, eum: r.eum, translation: r.translation, notes: r.notes };
      if (gh.size) { o.hint = seenP.has(r.page) ? '' : (gh.get(r.page) || ''); seenP.add(r.page); }
      return o;
    });
    for (const part of chunks(rows)) ok(await sb.from('jung_lines').insert(part));
  }

  // 문장
  if (parsed.um) {
    const units = [...new Set(parsed.um.map((r) => r.unit))];
    if (mode === 'replace') ok(await sb.from('um_sentences').delete().eq('range_id', rangeId));
    else ok(await sb.from('um_sentences').delete().eq('range_id', rangeId).in('unit_id', units.map((c) => unitMap.get(c))));
    let s = mode === 'replace' ? -1 : await maxSort('um_sentences');
    const withHint = parsed.um.some((r) => r.hint);
    const rows = parsed.um.map((r) => ({ range_id: rangeId, unit_id: unitMap.get(r.unit), sort: ++s, sentence: r.sentence, cards: r.cards, orders: r.orders, translation: r.translation, source: r.source, ...(withHint ? { hint: r.hint } : {}) }));
    for (const part of chunks(rows)) ok(await sb.from('um_sentences').insert(part));
  }

  // 플래시카드 (추가하기 : 붙여넣은 묶음만 새것으로)
  if (parsed.flash) {
    const decks = [...new Set(parsed.flash.map((r) => r.deck))];
    // 지우기 전에 사진 기억 : 같은 묶음 + 같은 앞면(없으면 같은 앞면)인 새 카드에 그대로 붙임
    let old = [];
    try {
      let q = sb.from('flash_cards').select('deck,front,front_img,back_img').eq('range_id', rangeId).or('front_img.not.is.null,back_img.not.is.null');
      if (mode !== 'replace') q = q.in('deck', decks);
      const r = await q; if (!r.error) old = r.data || [];
    } catch { old = []; }
    const nk = (t) => String(t || '').replace(/\s+/g, '');
    const byDF = new Map(old.map((o) => [`${o.deck}\u0001${nk(o.front)}`, o]));
    const byF = new Map(old.map((o) => [nk(o.front), o]));
    if (mode === 'replace') ok(await sb.from('flash_cards').delete().eq('range_id', rangeId));
    else ok(await sb.from('flash_cards').delete().eq('range_id', rangeId).in('deck', decks));
    let s = mode === 'replace' ? -1 : await maxSort('flash_cards');
    const used = new Set();
    const rows = parsed.flash.map((r) => {
      const row = { range_id: rangeId, deck: r.deck, front: r.front, back: r.back, hint: r.hint, sort: ++s };
      const o = byDF.get(`${r.deck}\u0001${nk(r.front)}`) || byF.get(nk(r.front));
      if (o && !used.has(o)) { used.add(o); row.front_img = o.front_img; row.back_img = o.back_img; }
      return row;
    });
    if (old.length) rows.forEach((r) => { if (!('front_img' in r)) { r.front_img = null; r.back_img = null; } });
    for (const part of chunks(rows)) ok(await sb.from('flash_cards').insert(part));
    // 새 카드에 안 붙은 사진은 저장소에서도 지움
    const lost = old.filter((o) => !used.has(o)).flatMap((o) => [o.front_img, o.back_img]).filter(Boolean);
    if (lost.length) dropImgs(lost);
  }
  // 그림 카드 : 그림이나 테이프가 있는 것은 절대 지우지 않음 (이름만 더함)
  if (parsed.occ) {
    const nk = (t) => String(t || '').toLowerCase().replace(/\s+/g, '');
    const have = await fetchAll(() => sb.from('occ_sets').select('id,deck,title,kind,labels,boxes,img,hint,sort').eq('range_id', rangeId).order('sort'));
    const key = (o) => `${nk(o.deck)}\u0001${nk(o.title)}`;
    const byKey = new Map(have.map((o) => [key(o), o]));
    const decks = new Set(parsed.occ.map((r) => r.deck));
    let s = have.reduce((m, o) => Math.max(m, o.sort || 0), -1);
    const used = new Set(); const ins = [];
    for (const r of parsed.occ) {
      const o = byKey.get(key(r));
      if (o && !used.has(o)) {
        used.add(o);
        const busy = !!o.img || (o.boxes || []).length;
        const patch = busy
          ? { labels: [...new Set([...(o.labels || []), ...r.names])], hint: o.hint || r.hint, src_file: r.file, src_page: r.page }
          : { kind: r.kind, labels: r.names, hint: r.hint, src_file: r.file, src_page: r.page };
        ok(await sb.from('occ_sets').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', o.id));
      } else ins.push({ range_id: rangeId, deck: r.deck, title: r.title, kind: r.kind, labels: r.names, src_file: r.file, src_page: r.page, hint: r.hint, sort: ++s });
    }
    // 이번에 안 온 빈 그림 카드(그림, 테이프 없음)만 정리 : 전부 바꾸기는 범위 전체, 추가하기는 같은 묶음만
    const gone = have.filter((o) => !used.has(o) && !o.img && !(o.boxes || []).length && (mode === 'replace' || decks.has(o.deck))).map((o) => o.id);
    for (const part of chunks(gone, 200)) ok(await sb.from('occ_sets').delete().in('id', part));
    for (const part of chunks(ins)) ok(await sb.from('occ_sets').insert(part));
  }
  if (parsed.past) {
    const exams = [...new Set(parsed.past.map((r) => r.exam))];
    if (mode === 'replace') ok(await sb.from('past_questions').delete().eq('range_id', rangeId));
    else ok(await sb.from('past_questions').delete().eq('range_id', rangeId).in('exam', exams));
    let s = mode === 'replace' ? -1 : await maxSort('past_questions');
    const rows = parsed.past.map((r) => ({ range_id: rangeId, exam: r.exam, no: r.no, type: r.type, passage: r.passage, question: r.question, choices: r.choices, answer: r.answer, explain: r.explain, ai: r.ai, tag: r.tag, accept: r.accept, sort: ++s }));
    for (const part of chunks(rows)) ok(await sb.from('past_questions').insert(part));
  }
}
