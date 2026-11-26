// @ts-nocheck
// 가입 요청 (로그인 전에도 부름 → 배포할 때 "Verify JWT" 끄기)
//  request : 이름, 학번, 학년, 아이디, 비밀번호로 요청. 비밀번호는 서버 열쇠로 암호화해 보관
//  status  : 로그인 화면에서 "승인 대기 중" 알려 주기용
//  approve / reject : 관리자만. 승인하면 그 아이디와 비밀번호로 계정을 만듦
import { createClient } from 'jsr:@supabase/supabase-js@2';

const DOMAIN = 'yrr-study.app';
const LIMIT = { perIpHour: 3, pending: 40 };
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const idOk = (u) => /^[a-z0-9_]{3,20}$/.test(u);
const gradeName = (g) => (g <= 2 ? `예과 ${g}학년` : `본과 ${g - 2}학년`);

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// 서버 열쇠(service role) 에서 뽑은 AES-GCM 열쇠. 앱이나 DB 만으로는 풀 수 없음
async function aesKey() {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('signup:' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function seal(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(), new TextEncoder().encode(text)));
  return b64(iv) + '.' + b64(ct);
}
async function open(s) {
  const [iv, ct] = s.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(), unb64(ct)));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST 만 받습니다.' }, 405);
  const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  let b;
  try { b = await req.json(); } catch { return json({ error: '잘못된 요청입니다.' }, 400); }

  // ── 요청 ──
  if (b.action === 'request') {
    if (b.hp) return json({ ok: true }); // 자동 입력 막기 (사람에게는 안 보이는 칸)
    const name = String(b.name || '').trim();
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    const sno = Number(b.student_no);
    const grade = Number(b.grade);
    if (!name || name.length > 20) return json({ error: '이름을 입력하세요.' }, 400);
    if (!Number.isInteger(sno) || sno < 10 || sno > 99) return json({ error: '학번은 두 자리 숫자로 입력하세요. (예: 26)' }, 400);
    if (!Number.isInteger(grade) || grade < 1 || grade > 6) return json({ error: '학년을 고르세요.' }, 400);
    if (!idOk(username)) return json({ error: '아이디는 영문 소문자, 숫자, _ 로 3~20자입니다.' }, 400);
    if (password.length < 6 || password.length > 72) return json({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400);
    if (!b.agree) return json({ error: '안내를 확인해 주세요.' }, 400);

    const ip = await sha256((req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'none');
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const [{ count: byIp }, { count: pend }, { data: taken }, { data: dup }] = await Promise.all([
      admin.from('signup_requests').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', hourAgo),
      admin.from('signup_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      admin.from('profiles').select('id').eq('username', username).maybeSingle(),
      admin.from('signup_requests').select('id').eq('status', 'pending').ilike('username', username).maybeSingle(),
    ]);
    if ((byIp || 0) >= LIMIT.perIpHour) return json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, 429);
    if ((pend || 0) >= LIMIT.pending) return json({ error: '지금은 요청을 받을 수 없습니다. 관리자에게 문의하세요.' }, 429);
    if (taken || dup) return json({ error: '이미 사용 중인 아이디입니다.' }, 409);

    const { data: row, error } = await admin.from('signup_requests')
      .insert({ name, student_no: sno, grade, username, secret: await seal(password), ip }).select('id').single();
    if (error) return json({ error: /duplicate|unique/i.test(error.message) ? '이미 사용 중인 아이디입니다.' : '요청을 보내지 못했습니다.' }, 400);

    // 관리자에게 알림 (앱 알림 → 푸시)
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin');
    if (admins?.length) {
      await admin.from('notifications').insert(admins.map((a) => ({
        user_id: a.id, kind: 'signup', title: '가입 요청',
        body: `${name} (${sno}학번, ${gradeName(grade)}) 님이 가입을 요청했습니다`,
        link: '#/admin?t=members', ref: row.id, actor: name,
      })));
    }
    return json({ ok: true });
  }

  // ── 로그인 화면 안내용 ──
  if (b.action === 'status') {
    const username = String(b.username || '').trim().toLowerCase();
    if (!idOk(username)) return json({ status: 'none' });
    const { data } = await admin.from('signup_requests').select('status').ilike('username', username).order('created_at', { ascending: false }).limit(1).maybeSingle();
    return json({ status: data?.status === 'pending' || data?.status === 'rejected' ? data.status : 'none' });
  }

  // ── 관리자 : 승인, 거절 ──
  if (b.action === 'approve' || b.action === 'reject') {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: '로그인이 필요합니다.' }, 401);
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single();
    if (me?.role !== 'admin') return json({ error: '권한이 없습니다.' }, 403);

    const { data: r } = await admin.from('signup_requests').select('*').eq('id', String(b.id || '')).maybeSingle();
    if (!r || r.status !== 'pending') return json({ error: '이미 처리된 요청입니다.' }, 409);
    const done = (status) => admin.from('signup_requests').update({ status, secret: '', decided_at: new Date().toISOString(), decided_by: user.id }).eq('id', r.id);

    if (b.action === 'reject') { await done('rejected'); return json({ ok: true }); }

    let password;
    try { password = await open(r.secret); } catch { return json({ error: '비밀번호를 풀 수 없습니다. 거절하고 다시 요청하게 해 주세요.' }, 500); }
    const { data, error } = await admin.auth.admin.createUser({
      email: `${r.username}@${DOMAIN}`, password, email_confirm: true, user_metadata: { name: r.name },
    });
    if (error) return json({ error: /already|exists|registered/i.test(error.message) ? '이미 사용 중인 아이디입니다. 거절하고 다른 아이디로 요청하게 해 주세요.' : error.message }, 400);
    const { error: e2 } = await admin.from('profiles').update({
      name: r.name, username: r.username, student_no: r.student_no, grade_override: r.grade,
      role: 'student', scope: 'own', must_change_pw: false,
    }).eq('id', data.user.id);
    if (e2) return json({ error: e2.message }, 400);
    await done('approved');
    return json({ ok: true, id: data.user.id });
  }

  return json({ error: '알 수 없는 요청입니다.' }, 400);
});
