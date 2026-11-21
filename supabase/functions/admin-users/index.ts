// 관리자 전용 계정 작업 : 생성 · 비밀번호 초기화 · 아이디 변경 · 삭제
// 관리자 키(service role)는 Supabase 서버 안에서만 쓰이고 앱 코드에는 들어가지 않음
import { createClient } from 'jsr:@supabase/supabase-js@2';

const DOMAIN = 'yrr-study.app';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const idOk = (u: string) => /^[a-z0-9_]{3,20}$/.test(u);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // 요청한 사람이 관리자인지 확인
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: '로그인이 필요합니다.' }, 401);
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single();
    if (me?.role !== 'admin') return json({ error: '권한이 없습니다.' }, 403);

    const b = await req.json();

    if (b.action === 'create') {
      const username = String(b.username || '').trim().toLowerCase();
      if (!idOk(username)) return json({ error: '아이디는 영문 소문자·숫자·_ 3~20자입니다.' }, 400);
      if (String(b.password || '').length < 6) return json({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email: `${username}@${DOMAIN}`, password: b.password, email_confirm: true,
        user_metadata: { name: b.name || '' },
      });
      if (error) return json({ error: /already|exists|registered/i.test(error.message) ? '이미 사용 중인 아이디입니다.' : error.message }, 400);
      const patch: Record<string, unknown> = {
        name: b.name || '', username, student_no: b.student_no ?? null,
        role: b.role || 'student', scope: b.scope || 'own', must_change_pw: true,
      };
      if (b.grade_override != null) patch.grade_override = b.grade_override;
      const { error: e2 } = await admin.from('profiles').update(patch).eq('id', data.user.id);
      if (e2) return json({ error: e2.message }, 400);
      return json({ ok: true, id: data.user.id });
    }

    if (b.action === 'reset_password') {
      if (String(b.password || '').length < 6) return json({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400);
      const { error } = await admin.auth.admin.updateUserById(b.user_id, { password: b.password });
      if (error) return json({ error: error.message }, 400);
      await admin.from('profiles').update({ must_change_pw: b.user_id !== user.id }).eq('id', b.user_id);
      return json({ ok: true });
    }

    if (b.action === 'set_username') {
      const username = String(b.username || '').trim().toLowerCase();
      if (!idOk(username)) return json({ error: '아이디는 영문 소문자·숫자·_ 3~20자입니다.' }, 400);
      const email = `${username}@${DOMAIN}`;
      const { error } = await admin.auth.admin.updateUserById(b.user_id, { email, email_confirm: true });
      if (error) return json({ error: /already|exists|registered/i.test(error.message) ? '이미 사용 중인 아이디입니다.' : error.message }, 400);
      await admin.from('profiles').update({ email, username }).eq('id', b.user_id);
      return json({ ok: true });
    }

    if (b.action === 'delete') {
      if (b.user_id === user.id) return json({ error: '본인 계정은 삭제할 수 없습니다.' }, 400);
      const { error } = await admin.auth.admin.deleteUser(b.user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: '알 수 없는 요청입니다.' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
