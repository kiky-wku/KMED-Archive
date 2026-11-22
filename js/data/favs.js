import { sb } from '../sb.js';
import { S } from '../app.js';

// 즐겨찾기 (자료 파일) : user_state 'favs' 에 [{ id, sid, rid, title, sub, icon }]
let cache = null;
export async function loadFavs() {
  if (cache) return cache;
  const { data } = await sb.from('user_state').select('value').eq('user_id', S.user.id).eq('key', 'favs').maybeSingle();
  cache = Array.isArray(data?.value?.list) ? data.value.list : [];
  return cache;
}
export const isFav = (id) => !!cache?.some((x) => x.id === id);
async function save() {
  await sb.from('user_state').upsert({ user_id: S.user.id, key: 'favs', value: { list: cache }, updated_at: new Date().toISOString() });
}
export async function toggleFav(f, subject) {
  await loadFavs();
  if (isFav(f.id)) cache = cache.filter((x) => x.id !== f.id);
  else {
    const title = [f.series || (f.filename || '').replace(/\.pdf$/i, ''), f.mode === 'weekly' ? f.week : ''].filter(Boolean).join(' ');
    cache = [{ id: f.id, sid: subject.id, rid: f.range_id, title, sub: subject.name, icon: subject.icon || '' }, ...cache].slice(0, 30);
  }
  await save();
  return isFav(f.id);
}
export async function removeFav(id) { await loadFavs(); cache = cache.filter((x) => x.id !== id); await save(); }
export function resetFavs() { cache = null; }
