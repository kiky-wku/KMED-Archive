import { sb } from '../sb.js';
import { S } from '../app.js';

// 실시간 연결 : 새 알림, 자료 변경을 바로 받아서 화면에 알려줌
// 앱이 켜져 있는 동안 연결 하나만 열어둠. 뒤로 가면 기기가 알아서 끊고, 돌아오면 다시 붙음.
const subs = { notif: new Set(), files: new Set() };
let ch = null;

export function onLive(kind, f) { subs[kind].add(f); return () => subs[kind].delete(f); }
const emit = (kind, p) => subs[kind].forEach((f) => { try { f(p); } catch { /* 무시 */ } });

export function startLive() {
  if (ch || !S.user || typeof sb.channel !== 'function') return;
  try {
    ch = sb.channel(`live-${S.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${S.user.id}` }, (p) => emit('notif', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'files' }, (p) => emit('files', p))
      .subscribe();
  } catch { ch = null; }
}

export function stopLive() {
  if (!ch) return;
  try { sb.removeChannel(ch); } catch { /* 무시 */ }
  ch = null;
}

// 다른 앱에 있다가 돌아오면, 그사이 놓친 것이 있을 수 있으니 한 번 새로 고침
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S.user) return;
  emit('notif', null); emit('files', null);
});
