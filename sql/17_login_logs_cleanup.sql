-- 17. 로그인 기록 자동 정리 : 30일 지난 기록은 지운다
-- 새 기록이 들어올 때마다 오래된 것을 함께 지우므로 따로 예약 작업이 필요 없다.

create or replace function public.login_logs_purge() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  delete from login_logs where at < now() - interval '30 days';
  return null;
end
$$;

drop trigger if exists login_logs_purge on public.login_logs;
create trigger login_logs_purge
  after insert on public.login_logs
  for each statement execute function public.login_logs_purge();

-- 지금 쌓여 있는 30일 지난 기록도 바로 정리
delete from public.login_logs where at < now() - interval '30 days';
