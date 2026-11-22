-- kmed-archive 10 : 제보(오타 · 오류) · 건의 · 앱 안 알림
-- Supabase SQL Editor 에 전체 붙여넣고 Run (여러 번 실행해도 괜찮음)

-- =========================================================
-- 제보 · 건의
--  kind : typo 오타 / error 오류 / suggest 건의
--  오타 · 오류는 그 과목을 볼 수 있는 사람 모두 열람 (쓴 사람 이름 공개)
--  건의는 쓴 사람 본인과 관리자만
-- =========================================================
create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('typo','error','suggest')),
  subject_id uuid references public.subjects(id) on delete cascade,
  range_id   uuid references public.ranges(id) on delete set null,
  block      text,
  context    jsonb not null default '{}',     -- { range, tab, item, hash }
  body       text not null check (length(body) between 1 and 2000),
  author     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  status     text not null default 'open' check (status in ('open','done')),
  reply      text,
  done_by    uuid references public.profiles(id) on delete set null,
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'suggest') = (subject_id is null))
);
create index if not exists reports_subject on public.reports (subject_id, created_at desc);
create index if not exists reports_kind    on public.reports (kind, created_at desc);

alter table public.reports enable row level security;
drop policy if exists p_sel on public.reports;
drop policy if exists p_ins on public.reports;
drop policy if exists p_upd on public.reports;
drop policy if exists p_del on public.reports;
create policy p_sel on public.reports for select using (
  case when kind = 'suggest' then author = auth.uid() or public.is_admin()
       else public.can_view_subject(subject_id) end);
create policy p_ins on public.reports for insert with check (
  author = auth.uid() and status = 'open'
  and (kind = 'suggest' or public.can_view_subject(subject_id)));
-- 처리 : 관리자 · 그 과목 담당 / 고치기 : 처리 전 본인 글
create policy p_upd on public.reports for update using (
  case when kind = 'suggest' then public.is_admin() else public.can_write_subject(subject_id) end
  or (author = auth.uid() and status = 'open'));
create policy p_del on public.reports for delete using (
  public.is_admin() or (author = auth.uid() and status = 'open'));

-- 본인은 내용만, 처리 상태는 담당 · 관리자만 바꿀 수 있게
create or replace function public.reports_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare can boolean;
begin
  can := case when old.kind = 'suggest' then public.is_admin() else public.can_write_subject(old.subject_id) end;
  if not can then
    if new.status <> old.status or new.reply is distinct from old.reply then
      raise exception '처리는 담당자만 할 수 있습니다';
    end if;
  end if;
  new.kind := old.kind; new.subject_id := old.subject_id; new.author := old.author; new.created_at := old.created_at;
  if new.status = 'done' and old.status <> 'done' then new.done_by := auth.uid(); new.done_at := now(); end if;
  if new.status = 'open' then new.done_by := null; new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists trg_reports_guard on public.reports;
create trigger trg_reports_guard before update on public.reports
  for each row execute function public.reports_guard();

-- =========================================================
-- 앱 안 알림 (본인 것만)
--  kind : report 새 제보 / suggest 새 건의 / done 내 제보 처리됨 / upload 새 자료
-- =========================================================
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text not null default '',
  link       text,
  ref        uuid,
  actor      text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notif_user on public.notifications (user_id, created_at desc);
create index if not exists notif_unread on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
drop policy if exists p_own on public.notifications;
create policy p_own on public.notifications for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 제보 · 건의가 들어오면 → 담당 + 관리자 / 처리되면 → 쓴 사람
create or replace function public.reports_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare sname text; who text; lbl text;
begin
  select name into who from profiles where id = coalesce(case when tg_op = 'INSERT' then new.author else new.done_by end, auth.uid());
  select name into sname from subjects where id = new.subject_id;
  lbl := case new.kind when 'typo' then '오타' when 'error' then '오류' else '건의' end;

  if tg_op = 'INSERT' then
    insert into notifications (user_id, kind, title, body, link, ref, actor)
    select distinct u, case when new.kind = 'suggest' then 'suggest' else 'report' end,
           case when new.kind = 'suggest' then '새 건의사항' else coalesce(sname, '') || ' ' || lbl || ' 제보' end,
           left(new.body, 140),
           case when new.kind = 'suggest' then '#/home?open=suggest&id=' || new.id
                else coalesce(new.context->>'hash', '#/s/' || new.subject_id) || case when coalesce(new.context->>'hash', '') like '%?%' then '&' else '?' end || 'open=report&id=' || new.id end,
           new.id, who
    from (
      select id u from profiles where role = 'admin'
      union
      select w.user_id from subject_writers w where new.kind <> 'suggest' and w.subject_id = new.subject_id
    ) t
    where u <> new.author;
  elsif new.status = 'done' and old.status <> 'done' and new.author <> coalesce(new.done_by, '00000000-0000-0000-0000-000000000000') then
    insert into notifications (user_id, kind, title, body, link, ref, actor)
    values (new.author, 'done',
            case when new.kind = 'suggest' then '건의사항에 답이 왔습니다' else coalesce(sname, '') || ' ' || lbl || ' 제보가 처리됐습니다' end,
            coalesce(nullif(new.reply, ''), left(new.body, 140)),
            case when new.kind = 'suggest' then '#/home?open=suggest&id=' || new.id
                 else coalesce(new.context->>'hash', '#/s/' || new.subject_id) || case when coalesce(new.context->>'hash', '') like '%?%' then '&' else '?' end || 'open=report&id=' || new.id end,
            new.id, who);
  end if;
  return new;
end $$;
drop trigger if exists trg_reports_notify on public.reports;
create trigger trg_reports_notify after insert or update of status on public.reports
  for each row execute function public.reports_notify();

-- 새 자료가 올라오면 → 그 과목을 보는 사람 모두 (올린 사람 빼고)
create or replace function public.files_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare s record; who text;
begin
  if tg_op = 'UPDATE' and new.key is not distinct from old.key then return new; end if;
  select * into s from subjects where id = new.subject_id;
  select name into who from profiles where id = auth.uid();
  -- 같은 파일 알림이 아직 안 읽힌 채 있으면 새로 만들지 않음
  insert into notifications (user_id, kind, title, body, link, ref, actor)
  select p.id, 'upload',
         s.name || case when tg_op = 'INSERT' then ' 새 자료' else ' 자료 업데이트' end,
         coalesce(nullif(new.series, ''), new.filename) || case when new.mode = 'weekly' and new.week is not null then ' ' || new.week || '주차' else '' end,
         '#/s/' || new.subject_id || '?r=' || coalesce(new.range_id::text, '') || '&b=summary',
         new.id, who
  from profiles p
  where p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000')
    and (p.role = 'admin' or p.scope = 'all' or s.grade = public.effective_grade(p.student_no, p.grade_override, p.grade_set_year))
    and not exists (select 1 from notifications n where n.user_id = p.id and n.ref = new.id and n.read_at is null);
  return new;
end $$;
drop trigger if exists trg_files_notify on public.files;
create trigger trg_files_notify after insert or update of key on public.files
  for each row execute function public.files_notify();

-- 오래된 읽은 알림 정리 (60일)
create or replace function public.notif_cleanup() returns void
language sql security definer set search_path = public as
$$ delete from notifications where user_id = auth.uid() and read_at < now() - interval '60 days' $$;

grant select, insert, update, delete on public.reports, public.notifications to authenticated;
grant execute on function public.notif_cleanup() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.reports, public.notifications to service_role;
  end if;
end $$;
