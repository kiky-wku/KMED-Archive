-- kmed-archive 14 : 공부한 날 기록 (내 학습 통계용)
--  문제를 풀어 기록이 저장될 때마다 그날(한국 시간) 푼 개수 +1
--  여러 번 실행해도 괜찮음

create table if not exists public.study_log (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null,
  n       int  not null default 0,
  primary key (user_id, day)
);
alter table public.study_log enable row level security;
drop policy if exists p_own on public.study_log;
create policy p_own on public.study_log for select using (user_id = auth.uid());

create or replace function public.study_log_bump() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is null then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.updated_at - old.updated_at < interval '1 minute' then return new; end if;
  insert into study_log (user_id, day, n) values (new.user_id, (now() at time zone 'Asia/Seoul')::date, 1)
  on conflict (user_id, day) do update set n = study_log.n + 1;
  return new;
end $$;
drop trigger if exists trg_study_log_h on public.hanja_progress;
create trigger trg_study_log_h after insert or update on public.hanja_progress for each row execute function public.study_log_bump();
drop trigger if exists trg_study_log_i on public.item_progress;
create trigger trg_study_log_i after insert or update on public.item_progress for each row execute function public.study_log_bump();

grant select on public.study_log to authenticated;
