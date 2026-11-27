import { sb } from '../sb.js';
import { deviceName } from '../ui.js';

// ─────────────────────────────────────────────
// 패스키 (Face ID, Touch ID, 지문으로 로그인)
//  - Supabase Auth 패스키 (RP ID studyhani.com)
//  - 서버 질문(challenge)은 미리 받아 두고, 버튼을 누르는 순간 바로 기기 확인창을 띄움
//    (사파리는 누른 직후가 아니면 확인창을 막음)
//  - 이 기기에서 켰는지는 기기에 기억 (kmed:pk = 사용자 id)
// ─────────────────────────────────────────────
const RP = 'studyhani.com';
const KEY = 'kmed:pk';
const NO = 'kmed:pk-no';

export async function pkSupported() {
  if (!(location.hostname === RP || window.__pkTest)) return false;
  try {
    return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch { return false; }
}

// 이 기기에서 쓰는 인증 이름과 모양
export function bio() {
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const long = Math.max(screen.width, screen.height);
  if (/iPhone/.test(ua)) return long <= 667 ? T : F;                       // SE 는 Touch ID
  if (/iPad/.test(ua) || touchMac) return [1194, 1210, 1366, 1376].includes(long) ? F : T;   // 프로만 Face ID
  if (/Macintosh/.test(ua)) return T;
  if (/Android/.test(ua)) return { name: '지문', icon: 'finger' };
  if (/Windows/.test(ua)) return { name: 'Windows Hello', icon: 'faceid' };
  return { name: '패스키', icon: 'finger' };
}
const F = { name: 'Face ID', icon: 'faceid' };
const T = { name: 'Touch ID', icon: 'finger' };

// 이 기기 기억
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
export const pkOnDevice = (uid) => (uid ? get(KEY) === uid : !!get(KEY));
export const pkForget = () => set(KEY, null);
export const pkAsked = (uid) => get(NO) === uid;
export const pkLater = (uid) => set(NO, uid);

// 사용자가 취소했는지
export const pkCancelled = (e) => e && (e.name === 'NotAllowedError' || e.name === 'AbortError'
  || /NotAllowed|ABORT|cancel/i.test(`${e.code || ''} ${e.message || ''}`));

// ── base64url ↔ 바이트 ──
const fromB64 = (s) => {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer;
};
const toB64 = (buf) => {
  let s = ''; new Uint8Array(buf).forEach((x) => { s += String.fromCharCode(x); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const creationOpts = (o) => (PublicKeyCredential.parseCreationOptionsFromJSON
  ? PublicKeyCredential.parseCreationOptionsFromJSON(o)
  : { ...o, challenge: fromB64(o.challenge), user: { ...o.user, id: fromB64(o.user.id) },
    excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, type: c.type || 'public-key', id: fromB64(c.id) })) });
const requestOpts = (o) => (PublicKeyCredential.parseRequestOptionsFromJSON
  ? PublicKeyCredential.parseRequestOptionsFromJSON(o)
  : { ...o, challenge: fromB64(o.challenge),
    allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, type: c.type || 'public-key', id: fromB64(c.id) })) });
const regJSON = (c) => (typeof c.toJSON === 'function' ? c.toJSON() : {
  id: c.id, rawId: c.id, type: 'public-key', clientExtensionResults: c.getClientExtensionResults(),
  authenticatorAttachment: c.authenticatorAttachment ?? undefined,
  response: { attestationObject: toB64(c.response.attestationObject), clientDataJSON: toB64(c.response.clientDataJSON),
    transports: c.response.getTransports?.() },
});
const authJSON = (c) => (typeof c.toJSON === 'function' ? c.toJSON() : {
  id: c.id, rawId: c.id, type: 'public-key', clientExtensionResults: c.getClientExtensionResults(),
  authenticatorAttachment: c.authenticatorAttachment ?? undefined,
  response: { authenticatorData: toB64(c.response.authenticatorData), clientDataJSON: toB64(c.response.clientDataJSON),
    signature: toB64(c.response.signature), userHandle: c.response.userHandle ? toB64(c.response.userHandle) : undefined },
});

// 질문을 미리 받아 두는 상자 (4분 지나면 새로)
function ready(start) {
  let p = null, at = 0;
  const load = () => { at = Date.now(); p = start().then(({ data, error }) => { if (error) throw error; return data; }); p.catch(() => { p = null; }); return p; };
  return {
    warm() { if (!p || Date.now() - at > 4 * 60e3) load(); },
    take() { const r = p && Date.now() - at < 4 * 60e3 ? p : load(); p = null; return r; },
  };
}

// ── 로그인 ──
const authBox = ready(() => sb.auth.passkey.startAuthentication());
export const pkWarmLogin = () => authBox.warm();
export async function pkSignIn() {
  const o = await authBox.take();
  const cred = await navigator.credentials.get({ publicKey: requestOpts(o.options) });
  const { data, error } = await sb.auth.passkey.verifyAuthentication({ challengeId: o.challenge_id, credential: authJSON(cred) });
  if (error) throw error;
  if (data?.user) set(KEY, data.user.id);
  return data;
}

// ── 켜기 (로그인한 상태) ──
const regBox = ready(() => sb.auth.passkey.startRegistration());
export const pkWarmRegister = () => regBox.warm();
export async function pkRegister(uid) {
  const o = await regBox.take();
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: creationOpts(o.options) });
  } catch (e) {
    // 이미 이 기기(또는 같은 iCloud)에 있음 → 켜진 것으로
    if (e?.name === 'InvalidStateError') { set(KEY, uid); return { already: true }; }
    throw e;
  }
  const { data, error } = await sb.auth.passkey.verifyRegistration({ challengeId: o.challenge_id, credential: regJSON(cred) });
  if (error) throw error;
  set(KEY, uid);
  if (data?.id) sb.auth.passkey.update({ passkeyId: data.id, friendlyName: deviceName().replace(/ · 앱$/, '') }).catch(() => {});
  return data;
}

// ── 목록, 지우기 ──
export async function pkList() {
  const { data, error } = await sb.auth.passkey.list();
  if (error) throw error;
  return data || [];
}
export async function pkRemove(id) {
  const { error } = await sb.auth.passkey.delete({ passkeyId: id });
  if (error) throw error;
}
