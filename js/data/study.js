import { sb } from '../sb.js';
import { S } from '../app.js';
import { fetchAll } from './hanja.js';

// ─────────────────────────────────────────────
// 해석 · 문장 · 문항별 기록 · 단어장
// ─────────────────────────────────────────────
const cache = new Map();
const once = (key, fn) => { if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; })); return cache.get(key); };

// 정한문 해석 : 같은 쪽이 이어지는 줄을 한 묶음으로
export function loadJung(rangeId) {
  return once(`jung:${rangeId}`, async () => {
    const rows = await fetchAll(() => sb.from('jung_lines').select('*').eq('range_id', rangeId).order('sort'));
    const groups = []; let cur = null;
    for (const r of rows) {
      if (!cur || r.page !== cur.page) { cur = { id: r.id, page: r.page, lines: [], hint: '' }; groups.push(cur); }
      cur.lines.push(r);
      if (!cur.hint && r.hint) cur.hint = r.hint;
    }
    return groups;
  });
}

// 플래시카드
export function loadFlash(rangeId) {
  return once(`flash:${rangeId}`, () => fetchAll(() => sb.from('flash_cards').select('*').eq('range_id', rangeId).order('sort')));
}

// 엄한문 문장
export function loadSentences(rangeId) {
  return once(`um:${rangeId}`, () => fetchAll(() => sb.from('um_sentences').select('*').eq('range_id', rangeId).order('sort')));
}

// ── 문항별 기록 (item_progress) : Map(item_id → { status, data }) ──
export function loadItems(kind) {
  return once(`items:${kind}`, async () => {
    const rows = await fetchAll(() => sb.from('item_progress').select('item_id,status,data').eq('user_id', S.user.id).eq('kind', kind).order('item_id'));
    return new Map(rows.map((r) => [r.item_id, { status: r.status || null, data: r.data || {} }]));
  });
}
const timers = new Map();
// 고친 내용은 바로 화면에 반영, 저장은 잠깐 모았다가 뒤에서
export function saveItem(kind, map, id, patch, delay = 500) {
  const cur = map.get(id) || { status: null, data: {} };
  const next = { status: 'status' in patch ? patch.status : cur.status, data: { ...cur.data, ...(patch.data || {}) } };
  map.set(id, next);
  const key = `${kind}:${id}`;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    const v = map.get(id);
    run(() => sb.from('item_progress').upsert({ user_id: S.user.id, kind, item_id: id, status: v.status, data: v.data, updated_at: new Date().toISOString() }, { onConflict: 'user_id,kind,item_id' }));
  }, delay));
}
export function clearItems(kind, map, ids) {
  if (!ids.length) return;
  ids.forEach((id) => { map.delete(id); clearTimeout(timers.get(`${kind}:${id}`)); });
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    run(() => sb.from('item_progress').delete().eq('user_id', S.user.id).eq('kind', kind).in('item_id', part));
  }
}

// ── 단어장 : Map(ch → 'ok' | 'no' | null) ──
export function loadWordbook(subjectId) {
  return once(`wb:${subjectId}`, async () => {
    const rows = await fetchAll(() => sb.from('wordbook').select('ch,result,added_at').eq('user_id', S.user.id).eq('subject_id', subjectId).order('added_at'));
    return new Map(rows.map((r) => [r.ch, r.result || null]));
  });
}
export function wbAdd(subjectId, map, chs) {
  const list = chs.filter((c) => !map.has(c)); if (!list.length) return;
  list.forEach((c) => map.set(c, null));
  run(() => sb.from('wordbook').upsert(list.map((ch) => ({ user_id: S.user.id, subject_id: subjectId, ch })), { onConflict: 'user_id,subject_id,ch' }));
}
export function wbRemove(subjectId, map, chs) {
  const list = chs.filter((c) => map.has(c)); if (!list.length) return;
  list.forEach((c) => map.delete(c));
  run(() => sb.from('wordbook').delete().eq('user_id', S.user.id).eq('subject_id', subjectId).in('ch', list));
}
export function wbResult(subjectId, map, ch, result) {
  if (!map.has(ch)) return;
  map.set(ch, result);
  run(() => sb.from('wordbook').upsert({ user_id: S.user.id, subject_id: subjectId, ch, result }, { onConflict: 'user_id,subject_id,ch' }));
}

// 저장 줄 (실패하면 한 번 더)
const q = []; let busy = false;
function run(job) { q.push(job); pump(); }
async function pump() {
  if (busy) return; busy = true;
  while (q.length) {
    const job = q.shift();
    let r = await job();
    if (r?.error) { await new Promise((ok) => setTimeout(ok, 800)); r = await job(); }
    if (r?.error) console.error('저장 실패', r.error);
  }
  busy = false;
}

export function resetStudyCaches() { [...cache.keys()].filter((k) => k.startsWith('jung:') || k.startsWith('um:') || k.startsWith('flash:')).forEach((k) => cache.delete(k)); }
