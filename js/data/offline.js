import { viewUrl } from './files.js';
import { sb } from '../sb.js';
import { onLive } from './live.js';

// ─────────────────────────────────────────────
// 오프라인 : 한 번 연 PDF 는 기기에 저장 (Cache Storage)
//  같은 파일(key)이면 다음부터 인터넷 없이 바로 열림
//  모두 합쳐 600MB 넘으면 오래 안 연 것부터 지움
//  앱에서 지운 파일은 기기에서도 지움 (앱 켤 때 확인 + 실시간으로 지워지면 바로)
// ─────────────────────────────────────────────
const CACHE = 'kmed-pdf-v1';
const META = 'kmed:pdf-meta';
const LIMIT = 600 * 1024 * 1024;
const has = () => 'caches' in window;
const reqOf = (key) => new Request(new URL(`__pdf/${encodeURIComponent(key)}`, location.href).href);

function meta() { try { return JSON.parse(localStorage.getItem(META) || '{}'); } catch { return {}; } }
function setMeta(m) { try { localStorage.setItem(META, JSON.stringify(m)); } catch { /* 가득 참 */ } }

// 파일 받기 : 저장돼 있으면 바로, 아니면 받아서 저장. onProgress(0~1)
export async function getPdf(file, key, onProgress) {
  const k = key || file.key;
  if (has()) {
    try {
      const c = await caches.open(CACHE);
      const hit = await c.match(reqOf(k));
      if (hit) {
        const m = meta(); if (m[k]) { m[k].at = Date.now(); setMeta(m); }
        return new Uint8Array(await hit.arrayBuffer());
      }
    } catch { /* 저장소를 못 쓰면 그냥 받기 */ }
  }
  const url = await viewUrl(file, key || undefined);
  const res = await fetch(url);
  if (!res.ok) throw new Error('파일을 받을 수 없습니다');
  const total = Number(res.headers.get('Content-Length')) || file.size || 0;
  let bytes;
  if (res.body && total && onProgress) {
    const reader = res.body.getReader(); const parts = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length; onProgress(Math.min(1, got / total));
    }
    bytes = new Uint8Array(got); let o = 0; parts.forEach((p) => { bytes.set(p, o); o += p.length; });
  } else bytes = new Uint8Array(await res.arrayBuffer());
  save(file, k, bytes);
  return bytes;
}

async function save(file, k, bytes) {
  if (!has()) return;
  try {
    const c = await caches.open(CACHE);
    await c.put(reqOf(k), new Response(bytes.slice(0), { headers: { 'Content-Type': 'application/pdf' } }));
    const m = meta();
    // 같은 파일의 예전 버전은 지움 (지금 파일만 남김)
    for (const [kk, v] of Object.entries(m)) if (v.id === file.id && kk !== k && kk !== file.key) { delete m[kk]; c.delete(reqOf(kk)); }
    m[k] = { id: file.id, size: bytes.length, at: Date.now(), file: snap(file) };
    // 너무 많으면 오래된 것부터
    let sum = Object.values(m).reduce((a, v) => a + (v.size || 0), 0);
    for (const [kk] of Object.entries(m).sort((a, b) => a[1].at - b[1].at)) {
      if (sum <= LIMIT) break;
      if (kk === k) continue;
      sum -= m[kk].size || 0; delete m[kk]; c.delete(reqOf(kk));
    }
    setMeta(m);
  } catch { /* 저장 못 해도 보기는 됨 */ }
}
const snap = (f) => ({ id: f.id, key: f.key, subject_id: f.subject_id, range_id: f.range_id, series: f.series, filename: f.filename, week: f.week, mode: f.mode, size: f.size, updated_at: f.updated_at });

// 저장된 파일 정보 (인터넷 없을 때 즐겨찾기에서 열기용)
export function savedFile(id) {
  const v = Object.values(meta()).filter((x) => x.id === id).sort((a, b) => b.at - a.at)[0];
  return v?.file || null;
}
export const isSaved = (key) => !!meta()[key];
export function savedSize() {
  const m = meta();
  return { count: Object.keys(m).length, bytes: Object.values(m).reduce((a, v) => a + (v.size || 0), 0) };
}
export async function clearSaved() {
  setMeta({});
  if (has()) await caches.delete(CACHE);
}

// 저장된 것 중 특정 파일(id) 지우기
async function dropIds(ids) {
  if (!ids.length) return;
  const set = new Set(ids); const m = meta(); let c = null;
  try { c = has() ? await caches.open(CACHE) : null; } catch { c = null; }
  for (const [k, v] of Object.entries(m)) if (set.has(v.id)) { delete m[k]; c?.delete(reqOf(k)); }
  setMeta(m);
}

// 서버에 더 이상 없는 파일 정리 : 저장된 파일 id 를 물어서 안 돌아온 것은 지움
// (볼 권한이 없어진 파일도 같이 지워짐)
let pruning = false;
export async function pruneSaved() {
  if (pruning || !navigator.onLine) return;
  const ids = [...new Set(Object.values(meta()).map((v) => v.id).filter(Boolean))];
  if (!ids.length) return;
  pruning = true;
  try {
    const alive = new Set();
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await sb.from('files').select('id').in('id', ids.slice(i, i + 100));
      if (error) return;           // 확인 못 하면 아무것도 안 지움
      (data || []).forEach((r) => alive.add(r.id));
    }
    await dropIds(ids.filter((id) => !alive.has(id)));
  } catch { /* 다음에 다시 */ } finally { pruning = false; }
}

// 다른 사람이 지금 지운 파일은 바로 정리
onLive('files', (p) => { if (p?.eventType === 'DELETE' && p.old?.id) dropIds([p.old.id]); });
