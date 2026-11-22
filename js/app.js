import { sb } from './sb.js';
import { mount, h, deviceName } from './ui.js';
import { loginView, firstView } from './views/auth.js';
import { welcomeView } from './views/welcome.js';
import { homeView } from './views/home.js';
import { settingsView } from './views/settings.js';
import { adminView } from './views/admin.js';
import { subjectView } from './views/subject.js';
import { registerSW, syncPush, disablePush, clearBadge } from './data/push.js';
import { markRead } from './data/reports.js';

// 앱 전체 상태
export const S = { user: null, profile: null, grade: null, sem: null, welcomed: false };

export async function loadMe() {
  const { data: { user } } = await sb.auth.getUser();
  S.user = user;
  if (!user) { S.profile = null; return; }
  const [p, g, s] = await Promise.all([
    sb.from('profiles').select('*').eq('id', user.id).single(),
    sb.rpc('my_grade'),
    sb.rpc('current_semester'),
  ]);
  S.profile = p.data;
  S.grade = g.data;
  S.sem = s.data;
}

export const isAdmin = () => S.profile?.role === 'admin';
export const seesAll = () => S.profile?.role === 'admin' || S.profile?.scope === 'all';

export async function signOut() {
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
  if (a === 'admin' && isAdmin()) return mount(adminView(q));
  location.hash = '#/home';
}

export function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

window.addEventListener('hashchange', route);

// 앱 시작 : 저장된 로그인 확인 → 접속 기록 → 환영 화면
(async function boot() {
  document.getElementById('app').replaceChildren(h('div', { class: 'boot' }, h('i')));
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      await loadMe();
      if (S.profile) { sb.rpc('touch_session', { p_device: deviceName() }); S.welcomed = true; syncPush(); }
    }
  } catch (e) {
    console.error(e);
  }
  route();
})();

// 푸시 알림 받기
registerSW();
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type !== 'open') return;
  if (e.data.id && S.user) markRead(e.data.id);
  if (e.data.hash) go(e.data.hash);
});
clearBadge();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') clearBadge(); });

// 확대 막기 : 두 번 탭은 CSS(touch-action), 두 손가락은 여기서
['gesturestart', 'gesturechange'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
