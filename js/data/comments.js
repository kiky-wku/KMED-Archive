import { sb } from '../sb.js';
import { S } from '../app.js';

// 자료 댓글
const names = new Map();
async function withNames(rows) {
  const ids = [...new Set(rows.map((r) => r.author).filter((x) => x && !names.has(x)))];
  await Promise.all(ids.map(async (id) => { const { data } = await sb.rpc('uploader_name', { uid: id }); names.set(id, data || ''); }));
  return rows.map((r) => ({ ...r, author_name: names.get(r.author) || '' }));
}
export async function listComments(fileId) {
  const { data, error } = await sb.from('file_comments').select('*').eq('file_id', fileId).order('created_at');
  if (error) throw error;
  return withNames(data || []);
}
export async function commentCounts(ids) {
  const m = new Map();
  if (!ids.length) return m;
  const { data } = await sb.from('file_comments').select('file_id').in('file_id', ids);
  (data || []).forEach((r) => m.set(r.file_id, (m.get(r.file_id) || 0) + 1));
  return m;
}
export async function addComment(fileId, body) {
  const { data, error } = await sb.from('file_comments').insert({ file_id: fileId, body, author: S.user.id }).select().single();
  if (error) throw error;
  return (await withNames([data]))[0];
}
export async function editComment(id, body) {
  const { error } = await sb.from('file_comments').update({ body, edited_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
export async function deleteComment(id) {
  const { error } = await sb.from('file_comments').delete().eq('id', id);
  if (error) throw error;
}
