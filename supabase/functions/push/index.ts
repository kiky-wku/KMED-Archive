// 푸시 알림 보내기
//  - action 'key'  : 앱이 구독할 때 쓰는 공개 키 (처음 부르면 서명 키를 만들어 push_config 에 보관)
//  - action 'send' : DB 트리거가 부름 (push_config 'hook' 암호 확인) → 알림 받을 사람의 기기들로 보냄
//  - action 'test' : 로그인한 본인 기기로 시험 알림
//  서명 키는 DB 안에만 있고 밖으로 나가지 않음
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const env = (k: string) => Deno.env.get(k) || '';
const svc = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });

let keys: CryptoKeyPair | null = null;
let server: webpush.ApplicationServer | null = null;
async function vapid() {
  if (keys) return keys;
  const { data } = await svc.from('push_config').select('value').eq('key', 'vapid').maybeSingle();
  if (data?.value?.publicKey) {
    keys = await webpush.importVapidKeys(data.value, { extractable: false });
  } else {
    const gen = await webpush.generateVapidKeys({ extractable: true });
    const exported = await webpush.exportVapidKeys(gen);
    // 동시에 두 번 만들어지면 먼저 들어간 것을 씀
    await svc.from('push_config').upsert({ key: 'vapid', value: exported }, { onConflict: 'key', ignoreDuplicates: true });
    const { data: again } = await svc.from('push_config').select('value').eq('key', 'vapid').single();
    keys = await webpush.importVapidKeys(again.value, { extractable: false });
  }
  return keys;
}
async function app() {
  if (server) return server;
  server = await webpush.ApplicationServer.new({ contactInformation: 'mailto:push@yrr-study.app', vapidKeys: await vapid() });
  return server;
}

type Note = { id: string; user_id: string; kind: string; title: string; body: string; link: string | null; ref: string | null };
async function deliver(notes: Note[]) {
  if (!notes.length) return { sent: 0, gone: 0 };
  const users = [...new Set(notes.map((n) => n.user_id))];
  const subs: { endpoint: string; user_id: string; p256dh: string; auth: string }[] = [];
  for (let i = 0; i < users.length; i += 200) {
    const { data } = await svc.from('push_subscriptions').select('endpoint,user_id,p256dh,auth').in('user_id', users.slice(i, i + 200));
    subs.push(...(data || []));
  }
  if (!subs.length) return { sent: 0, gone: 0 };
  const as = await app();
  const gone: string[] = [];
  let sent = 0;
  const jobs = notes.flatMap((n) => subs.filter((s) => s.user_id === n.user_id).map((s) => async () => {
    const payload = JSON.stringify({ title: n.title, body: n.body, url: n.link || '#/home', tag: n.ref || n.id, id: n.id });
    try {
      await as.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })
        .pushTextMessage(payload, { ttl: 60 * 60 * 24, urgency: webpush.Urgency.Normal, topic: (n.ref || n.id).replace(/-/g, '').slice(0, 32) });
      sent++;
    } catch (e) {
      const st = (e as webpush.PushMessageError)?.response?.status;
      if (st === 404 || st === 410) gone.push(s.endpoint);
    }
  }));
  // 여러 개를 나눠서 동시에
  for (let i = 0; i < jobs.length; i += 25) await Promise.all(jobs.slice(i, i + 25).map((f) => f()));
  if (gone.length) await svc.from('push_subscriptions').delete().in('endpoint', gone);
  return { sent, gone: gone.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));

    if (b.action === 'key') {
      return json({ key: await webpush.exportApplicationServerKey(await vapid()) });
    }

    if (b.action === 'send') {
      const { data: hook } = await svc.from('push_config').select('value').eq('key', 'hook').single();
      if (!hook || !b.token || b.token !== hook.value) return json({ error: 'forbidden' }, 403);
      const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 2000);
      const notes: Note[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await svc.from('notifications').select('id,user_id,kind,title,body,link,ref').in('id', ids.slice(i, i + 200)).is('read_at', null);
        notes.push(...(data || []));
      }
      return json(await deliver(notes));
    }

    if (b.action === 'test') {
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: { user } } = await svc.auth.getUser(token);
      if (!user) return json({ error: '로그인이 필요합니다.' }, 401);
      const r = await deliver([{ id: crypto.randomUUID(), user_id: user.id, kind: 'test', title: '공부하니', body: '알림이 잘 옵니다', link: '#/home', ref: null }]);
      return json(r);
    }

    return json({ error: '알 수 없는 요청입니다.' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
