-- ════════════════════════════════════════════════
--  20 : 한 계정이 서로 다른 기기 5대 이상으로 접속하면 관리자에게 알림
--  · 기기마다 앱이 만든 고유 번호(did)를 접속 기록에 같이 남김
--  · 최근 30일 안에 서로 다른 did 가 5개 이상이 되는 순간 + 그 뒤로 새 기기가 늘 때마다 알림
-- ════════════════════════════════════════════════
alter table public.login_logs add column if not exists did text;
create index if not exists login_logs_user_did on public.login_logs (user_id, did);

drop function if exists public.touch_session(text);
create or replace function public.touch_session(p_device text, p_did text default null) returns void
language plpgsql security definer set search_path = public as $$
declare last timestamptz; isnew boolean; n int; me record;
begin
  select last_seen_at into last from profiles where id = auth.uid();
  p_did := nullif(left(p_did, 64), '');
  isnew := p_did is not null and not exists (
    select 1 from login_logs where user_id = auth.uid() and did = p_did and at > now() - interval '30 days');
  if last is null or last < now() - interval '30 minutes' or isnew then
    insert into login_logs (user_id, device, did) values (auth.uid(), left(p_device, 200), p_did);
  end if;
  update profiles set last_seen_at = now() where id = auth.uid();

  if isnew then
    select count(distinct did) into n from login_logs
      where user_id = auth.uid() and did is not null and at > now() - interval '30 days';
    select id, name, username, role into me from profiles where id = auth.uid();
    if n >= 5 and me.role <> 'admin' then
      insert into notifications (user_id, kind, title, body, link, ref, actor)
      select a.id, 'device', '로그인 확인 필요',
             coalesce(me.name, me.username) || ' 계정이 최근 30일 동안 기기 ' || n || '대에서 접속했습니다',
             '#/admin?t=logs&u=' || me.id, me.id, coalesce(me.name, me.username)
      from profiles a where a.role = 'admin';
    end if;
  end if;
end $$;
revoke execute on function public.touch_session(text, text) from public, anon;
grant execute on function public.touch_session(text, text) to authenticated;

-- 관리자 화면용 : 최근 30일 기기 5대 이상 계정
create or replace function public.device_alerts() returns table (user_id uuid, devices int, last_at timestamptz)
language sql security definer set search_path = public stable as $$
  select l.user_id, count(distinct l.did)::int, max(l.at)
  from login_logs l join profiles p on p.id = l.user_id
  where public.is_admin() and l.did is not null and l.at > now() - interval '30 days' and p.role <> 'admin'
  group by l.user_id having count(distinct l.did) >= 5
  order by 2 desc;
$$;
revoke execute on function public.device_alerts() from public, anon;
grant execute on function public.device_alerts() to authenticated;
