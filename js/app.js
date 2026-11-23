import { sb } from './sb.js';
import { mount, h, deviceName } from './ui.js';
import { loginView, firstView } from './views/auth.js';
import { welcomeView } from './views/welcome.js';
import { homeView } from './views/home.js';
import { settingsView } from './views/settings.js';
import { myStatsView } from './views/my-stats.js';
import { adminView } from './views/admin.js';
import { subjectView } from './views/subject.js';
import { registerSW, syncPush, disablePush, clearBadge } from './data/push.js';
import { flushPending } from './data/files.js';
import { watchUpdates } from './update.js';
import { markRead } from './data/reports.js';
import { startLive, stopLive } from './data/live.js';
import { pruneSaved } from './data/offline.js';

// 앱 전체 상태
export const S = { user: null, profile: null, grade: null, sem: null, welcomed: false };

export async function loadMe() {
  // 인터넷이 없으면 저장된 로그인 · 내 정보로 (저장된 자료 보기용)
  let user = null;
  try { ({ data: { user } } = await sb.auth.getUser()); } catch { /* 오프라인 */ }
  if (!user && !navigator.onLine) user = (await sb.auth.getSession()).data.session?.user || null;
  S.user = user;
  if (!user) { S.profile = null; return; }
  const [p, g, s] = await Promise.all([
    sb.from('profiles').select('*').eq('id', user.id).single(),
    sb.rpc('my_grade'),
    sb.rpc('current_semester'),
  ]).catch(() => [{}, {}, {}]);
  if (p?.data) {
    S.profile = p.data; S.grade = g.data; S.sem = s.data;
    try { localStorage.setItem('kmed:me', JSON.stringify({ id: user.id, profile: S.profile, grade: S.grade, sem: S.sem })); } catch { /* 무시 */ }
  } else {
    let c = null; try { c = JSON.parse(localStorage.getItem('kmed:me') || 'null'); } catch { /* 무시 */ }
    if (c?.id === user.id) { S.profile = c.profile; S.grade = c.grade; S.sem = c.sem; } else S.profile = null;
  }
}

export const isAdmin = () => S.profile?.role === 'admin';
export const seesAll = () => S.profile?.role === 'admin' || S.profile?.scope === 'all';

// 인터넷 끊김 표시
function paintOnline() { document.documentElement.classList.toggle('offline', !navigator.onLine); }
window.addEventListener('online', paintOnline); window.addEventListener('offline', paintOnline); paintOnline();

export async function signOut() {
  stopLive();
  await disablePush().catch(() => {});
  await sb.auth.signOut();
  S.user = S.profile = null;
  S.welcomed = false;
  location.hash = '';
  route();
}

// 주소(#/…) → 화면
export async function route(opt = {}) {
  // 푸시 알림을 눌러 들어온 경우 : 읽음 처리
  const nid = location.hash.match(/[?&]nid=([\w-]+)/)?.[1];
  if (nid) { history.replaceState(null, '', location.hash.replace(/[?&]nid=[\w-]+/, '')); if (S.user) markRead(nid); }
  if (!S.user || !S.profile) return mount(loginView(), opt);
  if (S.profile.must_change_pw) return mount(firstView(), opt);
  if (!S.welcomed) return mount(welcomeView(), opt);

  const [path, qs] = (location.hash.slice(2) || 'home').split('?');
  const q = new URLSearchParams(qs || '');
  const [a, b] = path.split('/');
  if (a === 'welcome') return mount(welcomeView());
  if (a === 'home') return mount(homeView(q));
  if (a === 's' && b) return mount(subjectView(b, q));
  if (a === 'settings') return mount(settingsView());
  if (a === 'stats') return mount(myStatsView());
  if (a === 'admin' && isAdmin()) return mount(adminView(q));
  location.hash = '#/home';
}

export function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

window.addEventListener('hashchange', route);

// 접속 기록 : 앱을 열 때, 그리고 30분 넘게 다른 앱에 있다가 돌아올 때
// (supabase 요청은 then 을 붙여야 실제로 보내짐)
let lastTouch = 0;
// 이 기기 고유 번호 (처음 한 번 만들어 기기에 보관)
function deviceId() {
  try {
    let d = localStorage.getItem('kmed:did');
    if (!d) { d = crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now(); localStorage.setItem('kmed:did', d); }
    return d;
  } catch { return null; }
}
export function touch() {
  if (S.profile) startLive();   // 실시간 연결 (이미 있으면 그대로)
  if (!S.profile || !navigator.onLine) return;
  lastTouch = Date.now();
  sb.rpc('touch_session', { p_device: deviceName(), p_did: deviceId() }).then(() => {}, () => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastTouch > 30 * 60e3) touch();
});

// 앱 시작 : 저장된 로그인 확인 → 접속 기록 → 환영 화면
(async function boot() {
  document.getElementById('app').replaceChildren(h('div', { class: 'boot' }, h('i')));
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      await loadMe();
      if (S.profile) { if (navigator.onLine) { touch(); syncPush(); flushPending(); setTimeout(() => pruneSaved(), 4000); } S.welcomed = true; }
    }
  } catch (e) {
    console.error(e);
  }
  route();
})();

// 푸시 알림 받기
registerSW();
watchUpdates();
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type !== 'open') return;
  if (e.data.id && S.user) markRead(e.data.id);
  if (e.data.hash) go(e.data.hash);
});
clearBadge();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') clearBadge(); });

// 확대 막기 : 두 번 탭은 CSS(touch-action), 두 손가락은 여기서
['gesturestart', 'gesturechange'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
