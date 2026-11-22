-- kmed-archive 09 : PDF 자료 (Cloudflare R2) + 필기
--  - files         : 자료 한 개 (써머리 / 기타). mode single = 한 파일 갱신형, weekly = 주차별 (series 로 묶음)
--  - file_versions : 교체된 이전 파일 중 누군가 필기를 남긴 것만 보관
--  - file_notes    : 내 필기 (나만 보기). 파일 버전(key) · 쪽마다 선 좌표
-- 여러 번 실행해도 됨

create table if not exists public.files (
  id         uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  range_id   uuid references public.ranges(id) on delete set null,
  category   text not null default 'summary' check (category in ('summary','etc')),
  mode       text not null default 'single'  check (mode in ('single','weekly')),
  series     text not null default '',            -- 자료 이름 (주차별이면 같은 이름끼리 묶음)
  week       text not null default '',            -- 주차별일 때 '1주차' 등
  key        text not null,                       -- R2 안 경로
  filename   text not null default '',
  size       bigint not null default 0,
  uploader   uuid references public.profiles(id) on delete set null,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists files_subject on public.files (subject_id, range_id, category);

create table if not exists public.file_versions (
  id         uuid primary key default gen_random_uuid(),
  file_id    uuid not null references public.files(id) on delete cascade,
  key        text not null,
  filename   text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.file_notes (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  file_id    uuid not null references public.files(id) on delete cascade,
  key        text not null,
  page       int  not null,
  strokes    jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (user_id, file_id, key, page)
);

alter table public.files         enable row level security;
alter table public.file_versions enable row level security;
alter table public.file_notes    enable row level security;

drop policy if exists p_sel on public.files;
drop policy if exists p_wr  on public.files;
create policy p_sel on public.files for select using (public.can_view_subject(subject_id));
create policy p_wr  on public.files for all using (public.can_write_subject(subject_id)) with check (public.can_write_subject(subject_id));

drop policy if exists p_sel on public.file_versions;
create policy p_sel on public.file_versions for select
  using (exists (select 1 from public.files f where f.id = file_id and public.can_view_subject(f.subject_id)));

drop policy if exists p_own on public.file_notes;
create policy p_own on public.file_notes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 올린 사람 이름 (작성자 표시용)
create or replace function public.uploader_name(uid uuid) returns text
language sql stable security definer set search_path = public as $$ select name from profiles where id = uid $$;

grant select, insert, update, delete on public.files, public.file_notes to authenticated;
grant select on public.file_versions to authenticated;
grant execute on function public.uploader_name(uuid) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.files, public.file_versions, public.file_notes to service_role;
  end if;
end $$;
