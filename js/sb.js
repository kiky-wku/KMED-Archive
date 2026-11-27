// 데모 모드 : studyhani.com/?demo 로 열면 진짜 서버 대신 가짜 데이터로만 돌아감 (로그인 없이, 이 탭 안에서만)
export const DEMO = new URLSearchParams(location.search).has('demo');
if (DEMO) sessionStorage.setItem('mock-s', '1');
const mod = DEMO ? await import('./demo/mock.js') : await import('https://esm.sh/@supabase/supabase-js@2.119.2');

export const SUPABASE_URL = 'https://sresenperoritnaiyxwe.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_goELYB3-nOB3wunjoyflhg_rr0v7WkL';

export const sb = mod.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kmed-auth' },
});

if (DEMO) {
  const tag = document.createElement('div');
  tag.className = 'demo-tag';
  tag.textContent = '데모 화면입니다. 실제 데이터와 연결되어 있지 않습니다.';
  const put = () => document.body.append(tag);
  document.body ? put() : addEventListener('DOMContentLoaded', put);
}
