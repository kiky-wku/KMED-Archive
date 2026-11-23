// PDF 자료 · 플래시카드 사진 : Cloudflare R2 올리기 · 열기 · 지우기
//  - R2 열쇠는 Supabase Secrets(R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)에만 있음
//  - 권한 확인은 요청한 사람의 로그인으로 (RLS 그대로 적용) → 볼 수 있는 자료만 열람 주소 발급
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MAX = 100 * 1024 * 1024; // 한 파일 100MB
const IMG_MAX = 8 * 1024 * 1024; // 사진 한 장 8MB (앱에서 줄여서 보내므로 보통 0.5MB 안팎)
const IMG_KEY = /^[0-9a-f-]{36}\/img\/[0-9a-f-]{36}\.jpg$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const env = (k: string) => Deno.env.get(k) || '';
    const ACC = env('R2_ACCOUNT_ID'), BUCKET = env('R2_BUCKET');
    if (!ACC || !BUCKET || !env('R2_ACCESS_KEY_ID') || !env('R2_SECRET_ACCESS_KEY')) return json({ error: '저장소 설정(R2 Secrets)이 없습니다.' }, 500);
    const r2 = new AwsClient({ accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY'), service: 's3', region: 'auto' });
    const base = `https://${ACC}.r2.cloudflarestorage.com/${BUCKET}`;
    const objUrl = (key: string) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const presign = async (key: string, method: string, expires: number, extra = '') =>
      (await r2.sign(`${objUrl(key)}?X-Amz-Expires=${expires}${extra}`, { method, aws: { signQuery: true } })).url;
    const remove = async (key: string) => { if (key) await r2.fetch(objUrl(key), { method: 'DELETE' }); };

    // 요청한 사람
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const url = env('SUPABASE_URL');
    const svc = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user } } = await svc.auth.getUser(token);
    if (!user) return json({ error: '로그인이 필요합니다.' }, 401);
    const anon = env('SUPABASE_ANON_KEY') || req.headers.get('apikey') || '';
    const me = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const canWrite = async (sid: string) => { const { data } = await me.rpc('can_write_subject', { sid }); return data === true; };

    const b = await req.json();

    // 올리기 주소
    if (b.action === 'sign_upload') {
      if (!(await canWrite(b.subject_id))) return json({ error: '이 과목에 자료를 올릴 권한이 없습니다.' }, 403);
      if (!/\.pdf$/i.test(String(b.filename || ''))) return json({ error: 'PDF 파일만 올릴 수 있습니다.' }, 400);
      if (Number(b.size) > MAX) return json({ error: '한 파일은 100MB까지 올릴 수 있습니다.' }, 400);
      const key = `${b.subject_id}/${crypto.randomUUID()}.pdf`;
      return json({ key, url: await presign(key, 'PUT', 900) });
    }

    // 열람 주소 (볼 수 있는 자료만)
    if (b.action === 'sign_view') {
      const { data: f } = await me.from('files').select('id,key,filename').eq('id', b.file_id).maybeSingle();
      if (!f) return json({ error: '자료를 열 수 없습니다.' }, 403);
      let key = f.key; let name = f.filename;
      if (b.key && b.key !== f.key) {
        const { data: v } = await me.from('file_versions').select('key,filename').eq('file_id', f.id).eq('key', b.key).maybeSingle();
        if (!v) return json({ error: '이전 파일을 찾을 수 없습니다.' }, 404);
        key = v.key; name = v.filename;
      }
      const disp = `&response-content-type=application%2Fpdf&response-content-disposition=${encodeURIComponent(`inline; filename*=UTF-8''${encodeURIComponent(name || 'file.pdf')}`)}`;
      return json({ url: await presign(key, 'GET', 3600, disp) });
    }

    // 새 파일로 바꾼 뒤 : 이전 파일에 누가 필기했으면 보관, 아니면 지움
    if (b.action === 'replaced') {
      const { data: f } = await svc.from('files').select('id,subject_id').eq('id', b.file_id).maybeSingle();
      if (!f || !(await canWrite(f.subject_id))) return json({ error: '권한이 없습니다.' }, 403);
      const { count } = await svc.from('file_notes').select('page', { count: 'exact', head: true }).eq('file_id', f.id).eq('key', b.old_key);
      if (count) await svc.from('file_versions').insert({ file_id: f.id, key: b.old_key, filename: b.old_filename || '' });
      else await remove(b.old_key);
      return json({ ok: true, kept: !!count });
    }

    // 자료 지우기 : 저장소의 파일(이전 버전 포함)까지 모두
    if (b.action === 'delete_file') {
      const { data: f } = await svc.from('files').select('id,subject_id,key').eq('id', b.file_id).maybeSingle();
      if (!f) return json({ ok: true });
      if (!(await canWrite(f.subject_id))) return json({ error: '권한이 없습니다.' }, 403);
      const { data: vs } = await svc.from('file_versions').select('key').eq('file_id', f.id);
      for (const k of [f.key, ...(vs || []).map((v) => v.key)]) await remove(k);
      await svc.from('files').delete().eq('id', f.id);
      return json({ ok: true });
    }

    // 올리다 실패한 파일 정리
    if (b.action === 'discard') {
      if (!(await canWrite(b.subject_id))) return json({ error: '권한이 없습니다.' }, 403);
      if (String(b.key || '').startsWith(`${b.subject_id}/`)) await remove(b.key);
      return json({ ok: true });
    }

    // ── 플래시카드 사진 ──
    // 올리기 주소
    if (b.action === 'sign_img_upload') {
      if (!(await canWrite(b.subject_id))) return json({ error: '이 과목에 사진을 올릴 권한이 없습니다.' }, 403);
      if (Number(b.size) > IMG_MAX) return json({ error: '사진이 너무 큽니다.' }, 400);
      const key = `${b.subject_id}/img/${crypto.randomUUID()}.jpg`;
      return json({ key, url: await presign(key, 'PUT', 900) });
    }

    // 보기 주소 (볼 수 있는 카드에 붙은 사진만, 한 번에 60장까지)
    if (b.action === 'sign_imgs') {
      const keys = [...new Set((Array.isArray(b.keys) ? b.keys : []).map(String))].filter((k) => IMG_KEY.test(k)).slice(0, 60);
      if (!keys.length) return json({ urls: {} });
      const [f, k2] = await Promise.all([
        me.from('flash_cards').select('front_img').in('front_img', keys),
        me.from('flash_cards').select('back_img').in('back_img', keys),
      ]);
      const ok = new Set([...(f.data || []).map((r) => r.front_img), ...(k2.data || []).map((r) => r.back_img)]);
      const urls: Record<string, string> = {};
      for (const k of keys) if (ok.has(k)) urls[k] = await presign(k, 'GET', 86400, '&response-content-type=image%2Fjpeg');
      return json({ urls });
    }

    // 지우기 : 어느 카드에도 안 쓰이는 사진만
    if (b.action === 'delete_imgs') {
      const keys = [...new Set((Array.isArray(b.keys) ? b.keys : []).map(String))].filter((k) => IMG_KEY.test(k)).slice(0, 200);
      const allowed = new Map<string, boolean>();
      let n = 0;
      for (const k of keys) {
        const sid = k.split('/')[0];
        if (!allowed.has(sid)) allowed.set(sid, await canWrite(sid));
        if (!allowed.get(sid)) continue;
        const [a, c] = await Promise.all([
          svc.from('flash_cards').select('id', { count: 'exact', head: true }).eq('front_img', k),
          svc.from('flash_cards').select('id', { count: 'exact', head: true }).eq('back_img', k),
        ]);
        if ((a.count || 0) + (c.count || 0) === 0) { await remove(k); n++; }
      }
      return json({ ok: true, removed: n });
    }

    // 사용량 (관리자)
    if (b.action === 'usage') {
      const { data: p } = await svc.from('profiles').select('role').eq('id', user.id).single();
      if (p?.role !== 'admin') return json({ error: '권한이 없습니다.' }, 403);
      let bytes = 0, count = 0, cont = '';
      for (let i = 0; i < 50; i++) {
        const r = await r2.fetch(`${base}?list-type=2${cont ? `&continuation-token=${encodeURIComponent(cont)}` : ''}`);
        const xml = await r.text();
        for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) { bytes += Number(m[1]); count++; }
        const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
        if (!next) break; cont = next[1];
      }
      return json({ bytes, count });
    }

    return json({ error: '알 수 없는 요청입니다.' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
