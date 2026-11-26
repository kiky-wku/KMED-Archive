// Claude 연결 : 연결 열쇠 관리, Claude가 보낸 "검토 대기" 데이터
import { sb, SUPABASE_URL } from '../sb.js';

// ── 연결 열쇠 (원문은 만든 순간 한 번만 보여 주고, DB 에는 sha256 만) ──
const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export const connectorUrl = (key) => `${SUPABASE_URL}/functions/v1/claude-mcp?key=${key}`;

export async function listTokens() {
  const { data, error } = await sb.from('claude_tokens').select('id,hint,created_at,last_used').order('created_at');
  if (error) throw error;
  return data || [];
}
export async function createToken() {
  const key = 'kmed_' + b64url(crypto.getRandomValues(new Uint8Array(32)));
  const { error } = await sb.from('claude_tokens').insert({ hash: await sha256(key), hint: key.slice(-4) });
  if (error) throw error;
  return key;
}
export async function revokeToken(id) {
  const { error } = await sb.from('claude_tokens').delete().eq('id', id);
  if (error) throw error;
}

// ── 검토 대기 ──
export async function loadDrafts(subjectId) {
  const { data, error } = await sb.from('import_drafts')
    .select('id,range_id,keys,payload,rows,title,note,created_at,profiles:created_by(name)')
    .eq('subject_id', subjectId).eq('status', 'pending').order('created_at', { ascending: false });
  if (error) return []; // 25 SQL 전이면 조용히 없음
  return data || [];
}
export async function setDraft(id, status) {
  const { error } = await sb.from('import_drafts').update({ status }).eq('id', id);
  if (error) throw error;
}
