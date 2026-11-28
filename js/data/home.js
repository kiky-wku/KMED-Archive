import { sb } from '../sb.js';
import { S } from '../app.js';

// ─────────────────────────────────────────────
// 홈 화면 데이터
// ─────────────────────────────────────────────

// 학기 과목 + 범위(시험 날짜 포함)
export async function loadSubjects(g, s) {
  let r = await sb.from('subjects').select('id,name,sort,icon,ranges(id,name,sort,exam_at),blocks(kind)').eq('grade', g).eq('semester', s).order('sort').order('name');
  if (r.error) r = await sb.from('subjects').select('id,name,sort,icon,ranges(id,name,sort),blocks(kind)').eq('grade', g).eq('semester', s).order('sort').order('name');
  if (r.error) throw r.error;
  return (r.data || []).map((x) => ({ ...x, ranges: (x.ranges || []).sort((a, b) => a.sort - b.sort) }));
}

// 과목별 진도 : Map(subject_id → { total, ok, q_ok, q_no })
export async function loadProgress(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await sb.rpc('home_progress', { p_subjects: ids });
  if (error) return new Map();
  return new Map((data || []).map((r) => [r.subject_id, r]));
}

// 일정 : 전공 시험(범위의 시험 날짜) + 학과 일정 + 개인 일정, 오늘 이후만
export async function loadEvents(g) {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const { data, error } = await sb.from('events').select('*').gte('at', from.toISOString()).order('at').limit(60);
  if (error) return [];
  return (data || []).filter((e) => e.scope === 'me' || e.grade === g);
}
export const addEvent = (row) => sb.from('events').insert(row).select().single();
export const updateEvent = (id, patch) => sb.from('events').update(patch).eq('id', id);
export const deleteEvent = (id) => sb.from('events').delete().eq('id', id);
export const setExam = (rangeId, at) => sb.rpc('set_exam', { p_range: rangeId, p_at: at });

// 최근 본 자료 : 이어서 하던 학습 + 열어 본 자료
export async function loadRecent(limit = 12) {
  const [last, views] = await Promise.all([
    sb.from('user_state').select('value,updated_at').eq('user_id', S.user.id).eq('key', 'last').maybeSingle(),
    sb.from('file_views').select('seen_at,key,files(*,subjects(name,icon))')
      .eq('user_id', S.user.id).order('seen_at', { ascending: false }).limit(limit),
  ]);
  const out = [];
  const v = last.data?.value;
  if (v?.hash && v?.label) out.push({ type: 'study', at: last.data.updated_at, hash: v.hash, label: v.label });
  for (const r of views.data || []) if (r.files) out.push({ type: 'file', at: r.seen_at, file: r.files });
  out.sort((a, b) => new Date(b.at) - new Date(a.at));
  return out;
}

// 이번 주(일요일부터) 와 지난주 푼 개수
export async function loadWeek() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const prev = new Date(start); prev.setDate(prev.getDate() - 7);
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60);
  const { data } = await sb.from('study_log').select('day,n').eq('user_id', S.user.id).gte('day', key(from < prev ? from : prev));
  const m = new Map((data || []).map((r) => [r.day, r.n]));
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return { d, n: m.get(key(d)) || 0 }; });
  let last = 0;
  for (let i = 0; i < 7; i++) { const d = new Date(prev); d.setDate(d.getDate() + i); last += m.get(key(d)) || 0; }
  // 연속 학습 : 오늘부터 거꾸로 (오늘 아직 안 했으면 어제부터)
  const on = (d) => (m.get(key(d)) || 0) > 0;
  const back = (i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
  const todayOn = on(now);
  let streak = 0;
  for (let i = todayOn ? 0 : 1; i <= 60 && on(back(i)); i++) streak++;
  const recent = Array.from({ length: 7 }, (_, k) => { const d = back(6 - k); return { d, n: m.get(key(d)) || 0 }; });
  return { days, total: days.reduce((a, x) => a + x.n, 0), last, today: now.getDay(), streak, todayOn, recent };
}
