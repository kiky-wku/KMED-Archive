import { sb } from '../sb.js';
import { S } from '../app.js';

// ─────────────────────────────────────────────
// PDF 자료 : 목록 · 올리기 · 바꾸기 · 지우기 · 열람 주소 · 내 필기
//  파일 자체는 Cloudflare R2, 주소 발급은 Edge Function 'files'
// ─────────────────────────────────────────────
async function call(action, body) {
  const { data, error } = await sb.functions.invoke('files', { body: { action, ...body } });
  if (error) {
    let msg = '';
    try { msg = (await error.context?.json())?.error || ''; } catch { /* 무시 */ }
    if (!msg && error.name === 'FunctionsFetchError') msg = '서버 함수 files 에 연결할 수 없습니다.';
    throw new Error(msg || '요청을 처리할 수 없습니다.');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function listFiles(subjectId, rangeId) {
  let q = sb.from('files').select('*').eq('subject_id', subjectId).order('sort').order('created_at');
  q = rangeId ? q.eq('range_id', rangeId) : q;
  const { data, error } = await q;
  if (error) throw error;
  const ids = [...new Set((data || []).map((f) => f.uploader).filter(Boolean))];
  const names = new Map();
  await Promise.all(ids.map(async (id) => { const { data: n } = await sb.rpc('uploader_name', { uid: id }); names.set(id, n || ''); }));
  return (data || []).map((f) => ({ ...f, uploader_name: names.get(f.uploader) || '' }));
}

// R2 로 바로 올리기 (진행률 표시)
function put(url, file, onProgress) {
  return new Promise((ok, no) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Type', 'application/pdf');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? ok() : no(new Error(`업로드 실패 (${x.status})`)));
    x.onerror = () => no(new Error('업로드 중 연결이 끊겼습니다.'));
    x.send(file);
  });
}

async function uploadBlob(subjectId, file, onProgress) {
  const { key, url } = await call('sign_upload', { subject_id: subjectId, filename: file.name, size: file.size });
  try { await put(url, file, onProgress); } catch (e) { call('discard', { subject_id: subjectId, key }).catch(() => {}); throw e; }
  return key;
}

// 새 자료 (또는 주차 하나)
export async function addFile({ subject, range, category, mode, series, week, file, onProgress }) {
  const key = await uploadBlob(subject.id, file, onProgress);
  const row = { subject_id: subject.id, range_id: range?.id || null, category, mode, series, week: week || '', key, filename: file.name, size: file.size, uploader: S.user.id, sort: Date.now() % 1e9 };
  const { data, error } = await sb.from('files').insert(row).select().single();
  if (error) { call('discard', { subject_id: subject.id, key }).catch(() => {}); throw error; }
  return data;
}

// 같은 자리에 새 파일로 바꾸기 (이전 파일은 필기가 있으면 보관, 없으면 지움)
export async function replaceFile(f, file, onProgress) {
  const key = await uploadBlob(f.subject_id, file, onProgress);
  const { error } = await sb.from('files').update({ key, filename: file.name, size: file.size, uploader: S.user.id, updated_at: new Date().toISOString() }).eq('id', f.id);
  if (error) { call('discard', { subject_id: f.subject_id, key }).catch(() => {}); throw error; }
  await call('replaced', { file_id: f.id, old_key: f.key, old_filename: f.filename }).catch(() => {});
}

export const deleteFile = (f) => call('delete_file', { file_id: f.id });
export const viewUrl = (f, key) => call('sign_view', { file_id: f.id, key }).then((r) => r.url);
export const usage = () => call('usage', {});

// 이전 파일 중 내가 필기한 것
export async function myOldVersions(f) {
  const { data: notes } = await sb.from('file_notes').select('key').eq('user_id', S.user.id).eq('file_id', f.id);
  const keys = [...new Set((notes || []).map((n) => n.key))].filter((k) => k !== f.key);
  if (!keys.length) return [];
  const { data } = await sb.from('file_versions').select('key,filename,created_at').eq('file_id', f.id).in('key', keys).order('created_at', { ascending: false });
  return data || [];
}

// ── 내 필기 ──
export async function loadNotes(fileId, key) {
  const { data } = await sb.from('file_notes').select('page,strokes').eq('user_id', S.user.id).eq('file_id', fileId).eq('key', key);
  return new Map((data || []).map((r) => [r.page, Array.isArray(r.strokes) ? r.strokes : []]));
}
const tm = new Map();
export function saveNotes(fileId, key, page, strokes) {
  const k = `${fileId}:${key}:${page}`;
  clearTimeout(tm.get(k));
  tm.set(k, setTimeout(async () => {
    tm.delete(k);
    const row = { user_id: S.user.id, file_id: fileId, key, page, strokes, updated_at: new Date().toISOString() };
    let r = strokes.length
      ? await sb.from('file_notes').upsert(row, { onConflict: 'user_id,file_id,key,page' })
      : await sb.from('file_notes').delete().eq('user_id', S.user.id).eq('file_id', fileId).eq('key', key).eq('page', page);
    if (r?.error) { await new Promise((ok) => setTimeout(ok, 1000)); r = strokes.length ? await sb.from('file_notes').upsert(row, { onConflict: 'user_id,file_id,key,page' }) : r; }
    if (r?.error) console.error('필기 저장 실패', r.error);
  }, 800));
}
export function flushNotes() { /* 저장 예약은 타이머로 곧 실행됨 */ }

export const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);

// ── 읽음 · 조회 수 ──
export async function loadViews(ids) {
  const mine = new Map(); const counts = new Map();
  if (!ids.length) return { mine, counts };
  const [a, b] = await Promise.all([
    sb.from('file_views').select('file_id,key').eq('user_id', S.user.id).in('file_id', ids),
    sb.rpc('file_view_counts', { ids }),
  ]);
  (a.data || []).forEach((r) => mine.set(r.file_id, r.key));
  (b.data || []).forEach((r) => counts.set(r.file_id, r.n));
  return { mine, counts };
}
export function markViewed(f) {
  return sb.from('file_views').upsert({ file_id: f.id, user_id: S.user.id, key: f.key, seen_at: new Date().toISOString() }, { onConflict: 'file_id,user_id' }).then(() => {}, () => {});
}
