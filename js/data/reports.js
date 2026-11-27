import { sb } from '../sb.js';
import { onLive } from './live.js';
import { S } from '../app.js';

// ─────────────────────────────────────────────
// 제보(오타 · 오류) · 건의 · 앱 안 알림
//  알림은 DB 트리거가 만들어 줌 (10_reports.sql)
// ─────────────────────────────────────────────
const names = new Map();
async function withNames(rows) {
  const ids = [...new Set(rows.flatMap((r) => [r.author, r.done_by]).filter((x) => x && !names.has(x)))];
  await Promise.all(ids.map(async (id) => { const { data } = await sb.rpc('uploader_name', { uid: id }); names.set(id, data || ''); }));
  return rows.map((r) => ({ ...r, author_name: names.get(r.author) || '', done_name: names.get(r.done_by) || '' }));
}

export async function listReports(subjectId) {
  const { data, error } = await sb.from('reports').select('*').eq('subject_id', subjectId).order('created_at', { ascending: false }).limit(300);
  if (error) throw error;
  return withNames(data || []);
}
export async function listSuggests() {
  const { data, error } = await sb.from('reports').select('*').eq('kind', 'suggest').order('created_at', { ascending: false }).limit(300);
  if (error) throw error;
  return withNames(data || []);
}
export async function sendReport(row) {
  const { data, error } = await sb.from('reports').insert({ ...row, author: S.user.id }).select().single();
  if (error) throw error;
  return (await withNames([data]))[0];
}
export async function resolveReport(id, done, reply) {
  const { error } = await sb.from('reports').update({ status: done ? 'done' : 'open', reply: done ? (reply || null) : null }).eq('id', id);
  if (error) throw error;
}
export async function deleteReport(id) {
  const { error } = await sb.from('reports').delete().eq('id', id);
  if (error) throw error;
}

// ── 알림 ──
export async function listNotifs(limit = 80) {
  const { data, error } = await sb.from('notifications').select('*').eq('user_id', S.user.id).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}
export async function unreadNotifs(limit = 5) {
  const { data, count } = await sb.from('notifications').select('*', { count: 'exact' }).eq('user_id', S.user.id).is('read_at', null)
    .order('created_at', { ascending: false }).limit(limit);
  return { rows: data || [], count: count ?? (data || []).length };
}
export async function markRead(ids) {
  const list = [].concat(ids).filter(Boolean);
  if (!list.length) return;
  await sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', list);
  listeners.forEach((f) => f());
}
export async function markAllRead() {
  await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', S.user.id).is('read_at', null);
  listeners.forEach((f) => f());
}
// 모두 지우기 : 내 알림 전부 삭제
export async function clearNotifs() {
  const { error } = await sb.from('notifications').delete().eq('user_id', S.user.id);
  if (error) throw error;
  listeners.forEach((f) => f());
}
export function cleanupNotifs() { sb.rpc('notif_cleanup').then(() => {}, () => {}); }

// 읽음 상태가 바뀌면 배지 · 홈 카드 새로 그림
const listeners = new Set();
export function onNotifChange(f) { listeners.add(f); return () => listeners.delete(f); }
// 새 알림이 실시간으로 들어오면 같은 곳들을 새로 그림
onLive('notif', () => listeners.forEach((f) => f()));
