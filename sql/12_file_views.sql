-- kmed-archive 12 : 자료 읽음 표시 · 조회 수
--  내가 연 파일 기록 → 안 본 새 파일 / 내가 본 뒤 바뀐 파일만 NEW
--  조회 수 = 연 사람 수 (같은 사람이 여러 번 열어도 1)
--  여러 번 실행해도 괜찮음

create table if not exists public.file_views (
  file_id uuid not null references public.files(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  key     text not null default '',
  seen_at timestamptz not null default now(),
  primary key (file_id, user_id)
);
create index if not exists file_views_user on public.file_views (user_id);

alter table public.file_views enable row level security;
drop policy if exists p_own on public.file_views;
create policy p_own on public.file_views for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 조회 수 (볼 수 있는 과목의 파일만)
create or replace function public.file_view_counts(ids uuid[])
returns table (file_id uuid, n int)
language sql stable security definer set search_path = public as $$
  select v.file_id, count(*)::int
  from file_views v join files f on f.id = v.file_id
  where v.file_id = any(ids) and public.can_view_subject(f.subject_id)
  group by v.file_id
$$;

grant select, insert, update, delete on public.file_views to authenticated;
grant execute on function public.file_view_counts(uuid[]) to authenticated;
