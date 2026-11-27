-- kmed-archive 27 : 새 홈 화면
--  1) 전공 시험 날짜 (ranges.exam_at) : 그 과목을 볼 수 있는 학생 누구나 넣고 고침, 같은 학년 모두에게 보임
--  2) 일정 (events) : 학과 일정은 같은 학년 모두가 보고 고침, 개인 일정은 나만. 종류는 시험, 과제, 기타
--  3) 과목별 진도 한 번에 계산 (home_progress) : 맞힌 항목 / 전체 항목, 기출과 예상문제 정답 수
--  여러 번 실행해도 괜찮음

alter table public.ranges add column if not exists exam_at timestamptz;

create or replace function public.set_exam(p_range uuid, p_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_view_subject(public.range_subject(p_range)) then
    raise exception 'not allowed';
  end if;
  update ranges set exam_at = p_at where id = p_range;
end $$;
revoke all on function public.set_exam(uuid, timestamptz) from public, anon;
grant execute on function public.set_exam(uuid, timestamptz) to authenticated;

-- 일정 : 학과 일정(같은 학년 모두가 보고 고침) / 개인 일정(나만)
create or replace function public.my_grade() returns int
language sql stable security definer set search_path = public as $$
  select public.effective_grade(student_no, grade_override, grade_set_year) from profiles where id = auth.uid()
$$;
grant execute on function public.my_grade() to authenticated;

create or replace function public.sees_grade(g int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid()
    and (p.role = 'admin' or p.scope = 'all' or g = public.effective_grade(p.student_no, p.grade_override, p.grade_set_year)))
$$;
grant execute on function public.sees_grade(int) to authenticated;

create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  scope      text not null default 'me' check (scope in ('me','grade')),
  grade      int check (grade between 1 and 6),
  kind       text not null default 'exam' check (kind in ('exam','task','etc')),
  title      text not null check (length(title) between 1 and 60),
  at         timestamptz not null,
  created_at timestamptz not null default now(),
  check (scope = 'me' or grade is not null)
);
create index if not exists events_at on public.events (at);
alter table public.events enable row level security;
drop policy if exists p_sel on public.events;
drop policy if exists p_ins on public.events;
drop policy if exists p_upd on public.events;
drop policy if exists p_del on public.events;
create policy p_sel on public.events for select using (
  (scope = 'me' and user_id = auth.uid()) or (scope = 'grade' and public.sees_grade(grade)));
create policy p_ins on public.events for insert with check (
  user_id = auth.uid() and (scope = 'me' or public.sees_grade(grade)));
create policy p_upd on public.events for update using (
  (scope = 'me' and user_id = auth.uid()) or (scope = 'grade' and public.sees_grade(grade)))
  with check ((scope = 'me' and user_id = auth.uid()) or (scope = 'grade' and public.sees_grade(grade)));
create policy p_del on public.events for delete using (
  (scope = 'me' and user_id = auth.uid()) or (scope = 'grade' and public.sees_grade(grade)));
grant select, insert, update, delete on public.events to authenticated;

-- 지난 일정은 30일 뒤 정리
create or replace function public.events_cleanup() returns void
language sql security definer set search_path = public as $$ delete from events where at < now() - interval '30 days' $$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'events_cleanup';
    perform cron.schedule('events_cleanup', '30 4 * * *', 'select public.events_cleanup()');
  end if;
end $$;

create or replace function public.home_progress(p_subjects uuid[])
returns table (subject_id uuid, total int, ok int, q_ok int, q_no int)
language sql stable security definer set search_path = public as $$
  with s as (
    select id, coalesce(progress_pool, id::text) as pool
    from subjects where id = any(p_subjects) and public.can_view_subject(id)
  ),
  r as (select g.id as rid, s.id as sid, s.pool from ranges g join s on s.id = g.subject_id),
  fl as (
    select r.sid, count(*) t, count(*) filter (where ip.status = 'ok') o
    from flash_cards f join r on r.rid = f.range_id
    left join item_progress ip on ip.user_id = auth.uid() and ip.kind = 'flash_f' and ip.item_id = f.id
    group by r.sid
  ),
  pq as (
    select r.sid, count(*) t, count(*) filter (where ip.status = 'ok') o, count(*) filter (where ip.status = 'no') n
    from past_questions q join r on r.rid = q.range_id
    left join item_progress ip on ip.user_id = auth.uid() and ip.kind = q.kind and ip.item_id = q.id
    group by r.sid
  ),
  hj as (
    select x.sid, count(*) t, count(*) filter (where hp.status = 'ok') o
    from (select distinct r.sid, r.pool, c.ch from hanja_cards c join r on r.rid = c.range_id) x
    left join hanja_progress hp on hp.user_id = auth.uid() and hp.pool = x.pool and hp.ch = x.ch and hp.mode = 'r'
    group by x.sid
  ),
  jg as (
    select r.sid, count(*) t, count(*) filter (where ip.status = 'ok') o
    from (select distinct on (range_id, page) id, range_id from jung_lines order by range_id, page, sort) j
    join r on r.rid = j.range_id
    left join item_progress ip on ip.user_id = auth.uid() and ip.kind = 'jung' and ip.item_id = j.id
    group by r.sid
  ),
  um as (
    select r.sid, count(*) t, count(*) filter (where ip.status = 'ok') o
    from um_sentences u join r on r.rid = u.range_id
    left join item_progress ip on ip.user_id = auth.uid() and ip.kind = 'um_order' and ip.item_id = u.id
    group by r.sid
  )
  select s.id,
    (coalesce(fl.t,0) + coalesce(pq.t,0) + coalesce(hj.t,0) + coalesce(jg.t,0) + coalesce(um.t,0))::int,
    (coalesce(fl.o,0) + coalesce(pq.o,0) + coalesce(hj.o,0) + coalesce(jg.o,0) + coalesce(um.o,0))::int,
    coalesce(pq.o,0)::int, coalesce(pq.n,0)::int
  from s
  left join fl on fl.sid = s.id left join pq on pq.sid = s.id left join hj on hj.sid = s.id
  left join jg on jg.sid = s.id left join um on um.sid = s.id
$$;
revoke all on function public.home_progress(uuid[]) from public, anon;
grant execute on function public.home_progress(uuid[]) to authenticated;
