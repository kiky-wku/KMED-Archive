import { sb } from '../sb.js';
import { S } from '../app.js';

// 실시간 연결 : 새 알림, 자료 변경을 바로 받아서 화면에 알려줌
// 앱이 켜져 있는 동안 연결 하나만 열어둠. 뒤로 가면 기기가 알아서 끊고, 돌아오면 다시 붙음.
const subs = { notif: new Set(), files: new Set() };
let ch = null;

export function onLive(kind, f) { subs[kind].add(f); return () => subs[kind].delete(f); }
const emit = (kind, p) => subs[kind].forEach((f) => { try { f(p); } catch { /* 무시 */ } });

// 실시간 연결에도 로그인 표(토큰)를 꼭 붙여야 함.
// 안 붙이면 서버가 '로그인 안 한 사람'으로 보고, 볼 권한이 없다며 변경을 안 보내줌.
let authHooked = false;
async function useMyToken() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.access_token) await sb.realtime.setAuth(session.access_token);
  } catch { /* 무시 */ }
  if (!authHooked) {
    authHooked = true;
    try { sb.auth.onAuthStateChange((_e, s) => { if (s?.access_token) sb.realtime.setAuth(s.access_token); }); } catch { /* 무시 */ }
  }
}

export async function startLive() {
  if (ch || !S.user || typeof sb.channel !== 'function') return;
  ch = true;   // 준비하는 동안 두 번 열리지 않게
  await useMyToken();
  try {
    ch = sb.channel(`live-${S.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${S.user.id}` }, (p) => emit('notif', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'files' }, (p) => emit('files', p))
      .subscribe((status) => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('실시간 연결 상태:', status); });
  } catch { ch = null; }
}

export function stopLive() {
  if (!ch) return;
  try { if (ch !== true) sb.removeChannel(ch); } catch { /* 무시 */ }
  ch = null;
}

// 다른 앱에 있다가 돌아오면, 그사이 놓친 것이 있을 수 있으니 한 번 새로 고침
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S.user) return;
  emit('notif', null); emit('files', null);
});
