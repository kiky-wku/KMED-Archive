-- kmed-archive 11 : 푸시 알림
--  앱 안 알림(notifications)이 생기면 → Edge Function 'push' 가 그 사람의 기기들로 보냄
--  서명 키(VAPID)는 함수가 처음 실행될 때 스스로 만들어 push_config 에 보관 (밖으로 안 나감)
--  10 다음에 Run. 여러 번 실행해도 괜찮음.

create extension if not exists pg_net with schema extensions;

-- 기기 구독 (본인 것만)
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  device     text,
  created_at timestamptz not null default now()
);
create index if not exists push_sub_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists p_own on public.push_subscriptions;
create policy p_own on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 같은 기기를 다른 계정으로 다시 켜면 주인을 바꿔 줌
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_device text)
returns void language sql security definer set search_path = public as $$
  insert into push_subscriptions (endpoint, user_id, p256dh, auth, device)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, p_device)
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, created_at = now()
$$;

-- 서명 키 · 호출 암호 보관 (앱에서는 못 봄)
create table if not exists public.push_config (key text primary key, value jsonb not null);
alter table public.push_config enable row level security;
insert into public.push_config (key, value)
values ('hook', to_jsonb(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')))
on conflict (key) do nothing;

-- 알림이 생기면 한 번에 모아서 함수 호출
create or replace function public.notifications_push() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare ids uuid[]; tok text;
begin
  select array_agg(id) into ids from new_rows;
  if ids is null then return null; end if;
  select value #>> '{}' into tok from push_config where key = 'hook';
  perform net.http_post(
    url := 'https://sresenperoritnaiyxwe.supabase.co/functions/v1/push',
    body := jsonb_build_object('action', 'send', 'token', tok, 'ids', to_jsonb(ids)),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 10000);
  return null;
end $$;
drop trigger if exists trg_notifications_push on public.notifications;
create trigger trg_notifications_push after insert on public.notifications
  referencing new table as new_rows
  for each statement execute function public.notifications_push();

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.push_subscriptions, public.push_config to service_role;
    grant select on public.notifications to service_role;
  end if;
end $$;
