-- 16. 알림 자동 정리
-- 읽은 알림은 14일, 안 읽은 알림도 90일이 지나면 지운다.
-- 사용자가 알림창을 열 때(notif_cleanup)와 새 알림이 생길 때(트리거) 둘 다 정리하므로
-- 앱을 오래 안 켜는 사람의 알림도 쌓이지 않는다.

create index if not exists notif_read_at on public.notifications (read_at) where read_at is not null;
create index if not exists notif_created on public.notifications (created_at);

-- 내 알림 정리 (알림창 열 때 앱이 부름)
create or replace function public.notif_cleanup() returns void
language sql security definer set search_path = public as
$$
  delete from notifications
   where user_id = auth.uid()
     and (read_at < now() - interval '14 days' or created_at < now() - interval '90 days');
$$;
grant execute on function public.notif_cleanup() to authenticated;

-- 전체 정리 (새 알림이 들어올 때 한 번씩)
create or replace function public.notif_purge() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  delete from notifications
   where read_at < now() - interval '14 days'
      or created_at < now() - interval '90 days';
  return null;
end
$$;

drop trigger if exists notif_purge on public.notifications;
create trigger notif_purge
  after insert on public.notifications
  for each statement execute function public.notif_purge();
