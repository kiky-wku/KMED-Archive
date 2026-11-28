-- kmed-archive 28 : 일정 알림
--  매일 아침 8시(한국 시간) : 오늘, 내일 일정 알림 (전공 시험, 학과 일정, 개인 일정)
--  과제는 마감 3시간 전에 한 번 더
--  알림은 notifications 에 넣으면 기존 푸시 통로로 폰까지 감
--  학과 일정, 전공 시험은 그 학년 학생 모두에게 / 개인 일정은 만든 사람에게만
--  같은 알림은 두 번 보내지 않음 (event_sent). 일정 시간을 고치면 새 시간 기준으로 다시 보냄
--  여러 번 실행해도 괜찮음

create table if not exists public.event_sent (
  ref     uuid not null,
  tag     text not null,
  sent_at timestamptz not null default now(),
  primary key (ref, tag)
);
alter table public.event_sent enable row level security;   -- 앱에서는 못 봄

-- '오전 10시', '오후 6시 30분' (자정이면 시간 없음)
create or replace function public.ko_time(t timestamptz) returns text
language sql immutable as $$
  select case
    when to_char(t at time zone 'Asia/Seoul', 'HH24:MI') = '00:00' then ''
    else (case when extract(hour from t at time zone 'Asia/Seoul') < 12 then '오전 ' else '오후 ' end)
      || (((extract(hour from t at time zone 'Asia/Seoul')::int + 11) % 12) + 1) || '시'
      || case when extract(minute from t at time zone 'Asia/Seoul') = 0 then ''
              else ' ' || extract(minute from t at time zone 'Asia/Seoul')::int || '분' end
  end
$$;

-- 알림 대상 일정 (전공 시험 + 일정) 과 받는 사람
create or replace function public.event_targets()
returns table (ref uuid, kind text, title text, at timestamptz, user_id uuid)
language sql stable security definer set search_path = public as $$
  -- 개인 일정
  select e.id, e.kind, e.title, e.at, e.user_id from events e where e.scope = 'me' and e.at > now()
  union all
  -- 학과 일정 : 그 학년 학생 모두
  select e.id, e.kind, e.title, e.at, p.id from events e
    join profiles p on public.effective_grade(p.student_no, p.grade_override, p.grade_set_year) = e.grade
   where e.scope = 'grade' and e.at > now()
  union all
  -- 전공 시험 : 그 과목 학년 학생 모두
  select r.id, 'major', s.name || ' ' || r.name || case when r.name in ('중간', '기말') then '고사' else '' end, r.exam_at, p.id
    from ranges r join subjects s on s.id = r.subject_id
    join profiles p on public.effective_grade(p.student_no, p.grade_override, p.grade_set_year) = s.grade
   where r.exam_at is not null and r.exam_at > now()
$$;

create or replace function public.events_notify(p_mode text) returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  n int := 0;
begin
  if p_mode = 'day' then
    -- 오늘, 내일 일정
    with t as (
      select x.*, (x.at at time zone 'Asia/Seoul')::date as d from public.event_targets() x
    ), pick as (
      select t.*, case when t.d = today then 'd0' else 'd1' end as tg from t where t.d in (today, today + 1)
    ), fresh as (
      insert into event_sent (ref, tag)
      select distinct ref, tg || ':' || at::text from pick
      on conflict do nothing
      returning ref, tag
    ), ins as (
      insert into notifications (user_id, kind, title, body, link, ref, actor)
      select pick.user_id, 'schedule',
             case when pick.tg = 'd0' then '오늘 ' else '내일 ' end || pick.title,
             trim(case pick.kind when 'major' then '전공 시험' when 'exam' then '시험' when 'task' then '과제' else '일정' end
               || case when public.ko_time(pick.at) = '' then '' else ', ' || public.ko_time(pick.at) end
               || case when pick.kind = 'task' then '까지' else '' end),
             '#/home', pick.ref, null
        from pick join fresh on fresh.ref = pick.ref and fresh.tag = pick.tg || ':' || pick.at::text
      returning 1
    ) select count(*) into n from ins;
  elsif p_mode = 'task' then
    -- 과제 마감 3시간 전 (10분마다 확인)
    with pick as (
      select * from public.event_targets() x
       where x.kind = 'task' and x.at > now() + interval '2 hours 40 minutes' and x.at <= now() + interval '3 hours'
    ), fresh as (
      insert into event_sent (ref, tag)
      select distinct ref, 'h3:' || at::text from pick
      on conflict do nothing
      returning ref, tag
    ), ins as (
      insert into notifications (user_id, kind, title, body, link, ref, actor)
      select pick.user_id, 'schedule', pick.title || ' 마감 3시간 전',
             '과제, ' || public.ko_time(pick.at) || '까지', '#/home', pick.ref, null
        from pick join fresh on fresh.ref = pick.ref and fresh.tag = 'h3:' || pick.at::text
      returning 1
    ) select count(*) into n from ins;
  end if;
  -- 오래된 보낸 기록 정리
  delete from event_sent where sent_at < now() - interval '60 days';
  return n;
end $$;
revoke all on function public.events_notify(text) from public, anon, authenticated;
revoke all on function public.event_targets() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('events_notify_day', 'events_notify_task');
    perform cron.schedule('events_notify_day', '0 23 * * *', $c$select public.events_notify('day')$c$);   -- 한국 아침 8시
    perform cron.schedule('events_notify_task', '*/10 * * * *', $c$select public.events_notify('task')$c$);
  end if;
end $$;
