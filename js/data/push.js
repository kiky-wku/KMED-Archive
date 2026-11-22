import { sb } from '../sb.js';
import { deviceName } from '../ui.js';

// ─────────────────────────────────────────────
// 푸시 알림 : 서비스 워커 등록 · 켜기 · 끄기
//  아이폰 · 아이패드는 홈 화면에 추가한 앱(iOS 16.4 이상)에서만 됨
// ─────────────────────────────────────────────
const ua = navigator.userAgent;
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// 아이폰인데 아직 홈 화면 앱이 아님
export const needsInstall = () => isIOS && !isStandalone();

let reg = null;
export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { reg = await navigator.serviceWorker.register('sw.js', { scope: './' }); } catch { reg = null; }
  return reg;
}
async function ready() { return reg || (await navigator.serviceWorker.ready); }

function b64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const enc = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function save(sub) {
  const { error } = await sb.rpc('push_subscribe', {
    p_endpoint: sub.endpoint, p_p256dh: enc(sub.getKey('p256dh')), p_auth: enc(sub.getKey('auth')), p_device: deviceName(),
  });
  if (error) throw new Error('알림 등록을 저장하지 못했습니다.');
}

// 'on' | 'off' | 'denied' | 'unsupported' | 'install'
export async function pushState() {
  if (needsInstall()) return 'install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const sub = await (await ready()).pushManager.getSubscription().catch(() => null);
  return sub ? 'on' : 'off';
}

// 버튼을 누른 그 순간에 불러야 함 (아이폰은 권한 창을 버튼 누름에서만 띄움)
export async function enablePush() {
  if (needsInstall()) throw new Error('홈 화면에 추가한 앱에서 켤 수 있습니다.');
  if (!pushSupported()) throw new Error('이 브라우저는 푸시 알림을 지원하지 않습니다.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? '알림이 꺼져 있습니다. 기기 설정에서 허용해 주세요.' : '알림을 허용하지 않았습니다.');
  const { data, error } = await sb.functions.invoke('push', { body: { action: 'key' } });
  if (error || !data?.key) throw new Error('서버 함수 push 에 연결할 수 없습니다.');
  const r = await ready();
  let sub = await r.pushManager.getSubscription();
  if (sub) {
    // 서버 키가 바뀌었으면 다시 구독
    const cur = sub.options?.applicationServerKey ? enc(sub.options.applicationServerKey) : null;
    if (cur && cur !== data.key) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(data.key) });
  await save(sub);
}

export async function disablePush() {
  const sub = await (await ready()).pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe().catch(() => {});
}

// 로그인 상태에서 앱을 열 때 : 이미 켜져 있으면 이 계정으로 다시 등록 (계정 바뀜 대비)
export async function syncPush() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const sub = await (await ready()).pushManager.getSubscription();
    if (sub) await save(sub);
  } catch { /* 무시 */ }
}

export async function testPush() {
  const { data, error } = await sb.functions.invoke('push', { body: { action: 'test' } });
  if (error || data?.error) throw new Error(data?.error || '보내지 못했습니다.');
  return data;
}

export function clearBadge() { try { navigator.clearAppBadge?.(); } catch { /* 무시 */ } }
