import { sb } from '../sb.js';
import { S } from '../app.js';

// ─────────────────────────────────────────────
// 한자 데이터 · 기록
//  - 카드 : 범위(range)별 hanja_cards (+ 엄한문 단원)
//  - 기록 : 글자 기준 hanja_progress (pool 이 같으면 과목이 달라도 공유)
// ─────────────────────────────────────────────
const cardCache = new Map();

// Supabase 는 한 번에 최대 1000행 → 나눠서 전부 받기
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
const progCache = new Map();

export async function loadCards(rangeId) {
  if (cardCache.has(rangeId)) return cardCache.get(rangeId);
  const [cards, u] = await Promise.all([
    fetchAll(() => sb.from('hanja_cards').select('id,ch,reading,unit_id,sort').eq('range_id', rangeId).order('sort')),
    sb.from('hanja_units').select('id,code,label,sort').eq('range_id', rangeId).order('sort'),
  ]);
  const v = { cards, units: u.data || [] };
  cardCache.set(rangeId, v);
  return v;
}

// 고른 단원의 카드 → 글자 하나에 한 장, 훈음은 모두 합침 (등장 순서 유지)
export function uniqueCards(cards, unitIds) {
  const pick = unitIds && unitIds.length ? cards.filter((c) => unitIds.includes(c.unit_id)) : cards;
  const out = []; const idx = new Map();
  for (const c of pick) {
    const rs = splitReadings(c.reading);
    if (!idx.has(c.ch)) { idx.set(c.ch, out.length); out.push({ ch: c.ch, readings: rs.slice() }); }
    else { const u = out[idx.get(c.ch)]; rs.forEach((r) => { if (!u.readings.includes(r)) u.readings.push(r); }); }
  }
  return out;
}

export const splitReadings = (s) => String(s || '').split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
export const readingText = (c) => c.readings.join('  /  ');

const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/[()]/g, '').toLowerCase();
// 입력이 훈음 중 하나와 같으면 정답 (쉼표로 나뉜 훈음도 각각 인정, 공백·괄호 무시)
export function matchReading(input, card) {
  const ni = norm(input);
  if (!ni) return false;
  return card.readings.some((rd) => norm(rd) === ni || rd.split(/[,，]/).some((seg) => norm(seg) === ni));
}

// 기록 : { r: Map(ch → 'ok'|'no'), h: Map }
export async function loadProgress(pool) {
  if (progCache.has(pool)) return progCache.get(pool);
  const data = await fetchAll(() => sb.from('hanja_progress').select('ch,mode,status').eq('user_id', S.user.id).eq('pool', pool).order('ch'));
  const p = { r: new Map(), h: new Map() };
  (data || []).forEach((x) => p[x.mode]?.set(x.ch, x.status));
  progCache.set(pool, p);
  return p;
}

// 저장은 화면을 막지 않게 뒤에서 (실패하면 한 번 재시도)
const queue = [];
let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  while (queue.length) {
    const job = queue.shift();
    let r = await job();
    if (r?.error) { await new Promise((ok) => setTimeout(ok, 800)); r = await job(); }
    if (r?.error) console.error('기록 저장 실패', r.error);
  }
  flushing = false;
}

export function setStatus(pool, mode, chs, status) {
  const p = progCache.get(pool);
  const list = Array.isArray(chs) ? chs : [chs];
  list.forEach((ch) => (status ? p[mode].set(ch, status) : p[mode].delete(ch)));
  if (status) {
    const rows = list.map((ch) => ({ user_id: S.user.id, pool, ch, mode, status, updated_at: new Date().toISOString() }));
    queue.push(() => sb.from('hanja_progress').upsert(rows, { onConflict: 'user_id,pool,ch,mode' }));
  } else {
    queue.push(() => sb.from('hanja_progress').delete().eq('user_id', S.user.id).eq('pool', pool).eq('mode', mode).in('ch', list));
  }
  flush();
}

// 기기별 문제 순서 · 위치 · 되돌리기 (가볍게 이 기기에만)
export function deckState(key, chars) {
  const k = `kmed:deck:${S.user.id}:${key}`;
  let d = null;
  try { d = JSON.parse(localStorage.getItem(k) || 'null'); } catch { /* 손상 무시 */ }
  const set = new Set(chars);
  if (!d || !Array.isArray(d.order)) d = { order: chars.slice(), pos: 0, hist: [] };
  d.order = d.order.filter((c) => set.has(c));
  chars.forEach((c) => { if (!d.order.includes(c)) d.order.push(c); });
  d.hist = (d.hist || []).filter((c) => set.has(c));
  if (typeof d.pos !== 'number') d.pos = 0;
  d.save = () => { try { localStorage.setItem(k, JSON.stringify({ order: d.order, pos: d.pos, hist: d.hist })); } catch { /* 저장 공간 없음 */ } };
  return d;
}
