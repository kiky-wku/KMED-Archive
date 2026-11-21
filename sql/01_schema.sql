-- kmed-archive 01 : 기본 테이블 · 권한
-- Supabase SQL Editor 에 전체 붙여넣고 Run

-- =========================================================
-- 회원
-- =========================================================
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  name           text not null default '',
  student_no     int,                       -- 학번 (25 = 2025 입학)
  grade_override int,                       -- 학년 직접 지정 (휴학·유급·재수 등). 지정한 해 기준
  grade_set_year int,                        -- 지정한 학년도 → 매년 3월 자동 +1
  role           text not null default 'student' check (role in ('admin','writer','student')),
  scope          text not null default 'own'     check (scope in ('all','own')),
  must_change_pw boolean not null default true,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz
);

-- 로그인 계정이 생기면 회원 행 자동 생성
create function public.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''));
  return new;
end $$;
create trigger trg_auth_user_created after insert on auth.users
  for each row execute function public.on_auth_user_created();

create table public.login_logs (
  id      bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  at      timestamptz not null default now(),
  device  text
);
create index on public.login_logs (user_id, at desc);
create index on public.login_logs (at desc);

-- =========================================================
-- 학년 · 학기 계산 (3~8월 1학기, 9~2월 2학기)
-- =========================================================
create function public.kst_now() returns timestamp language sql stable as
$$ select now() at time zone 'Asia/Seoul' $$;

create function public.current_semester() returns int language sql stable as
$$ select case when extract(month from public.kst_now()) between 3 and 8 then 1 else 2 end $$;

create function public.academic_year() returns int language sql stable as $$
  select extract(year from public.kst_now())::int
       - case when extract(month from public.kst_now()) < 3 then 1 else 0 end
$$;

create function public.grade_of(sno int) returns int language sql stable as
$$ select case when sno is null then null else public.academic_year() - (2000 + sno) + 1 end $$;

-- 실제 학년 : 직접 지정이 있으면 지정 학년 + 지난 학년도 수, 없으면 학번 계산
create function public.effective_grade(sno int, g_over int, g_year int) returns int language sql stable as $$
  select case when g_over is not null then g_over + (public.academic_year() - coalesce(g_year, public.academic_year()))
              else public.grade_of(sno) end
$$;

create function public.profiles_grade_year() returns trigger language plpgsql as $$
begin
  if new.grade_override is distinct from old.grade_override then
    new.grade_set_year := case when new.grade_override is null then null else public.academic_year() end;
  end if;
  return new;
end $$;
create trigger trg_profiles_grade_year before update on public.profiles
  for each row execute function public.profiles_grade_year();

-- =========================================================
-- 과목 구조 : 과목 → 범위(중간·기말) / 블록(탭)
-- =========================================================
create table public.subjects (
  id            uuid primary key default gen_random_uuid(),
  grade         int  not null check (grade between 1 and 6),
  semester      int  not null check (semester in (1,2)),
  name          text not null,
  sort          int  not null default 0,
  progress_pool text,                        -- 같은 값끼리 한자 기록 공유 (정·엄 = 'hanmun')
  created_at    timestamptz not null default now()
);

create table public.ranges (
  id         uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  name       text not null,                  -- 중간 / 기말 / 2학기 …
  sort       int  not null default 0
);

create table public.blocks (
  id         uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  kind       text not null,                  -- jung_translate · hanja_r · hanja_h · hanja_grid · wordbook · um_order · um_answers · summary …
  title      text not null,
  sort       int  not null default 0,
  config     jsonb not null default '{}'
);

create table public.subject_writers (
  subject_id uuid references public.subjects(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  primary key (subject_id, user_id)
);

-- =========================================================
-- 권한 함수
-- =========================================================
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;

create function public.my_grade() returns int
language sql stable security definer set search_path = public as
$$ select public.effective_grade(student_no, grade_override, grade_set_year) from profiles where id = auth.uid() $$;

create function public.can_view_subject(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p, subjects s
    where p.id = auth.uid() and s.id = sid
      and (p.role = 'admin' or p.scope = 'all' or s.grade = public.effective_grade(p.student_no, p.grade_override, p.grade_set_year))
  )
$$;

create function public.can_write_subject(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from subject_writers w join profiles p on p.id = w.user_id
                 where w.subject_id = sid and w.user_id = auth.uid() and p.role = 'writer')
$$;

create function public.range_subject(rid uuid) returns uuid
language sql stable security definer set search_path = public as
$$ select subject_id from ranges where id = rid $$;

-- =========================================================
-- 한문 콘텐츠
-- =========================================================
create table public.hanja_units (             -- 엄한문 단원
  id       uuid primary key default gen_random_uuid(),
  range_id uuid not null references public.ranges(id) on delete cascade,
  code     text not null,
  label    text not null,
  sort     int  not null default 0,
  unique (range_id, code)
);

create table public.hanja_cards (
  id       uuid primary key default gen_random_uuid(),
  range_id uuid not null references public.ranges(id) on delete cascade,
  unit_id  uuid references public.hanja_units(id) on delete cascade,
  ch       text not null,
  reading  text not null default '',
  sort     int  not null default 0
);
create index on public.hanja_cards (range_id, sort);

create table public.jung_lines (              -- 정한문 해석 표
  id          uuid primary key default gen_random_uuid(),
  range_id    uuid not null references public.ranges(id) on delete cascade,
  page        text not null default '',
  sort        int  not null default 0,
  hanja       text not null default '',
  eum         text not null default '',
  translation text not null default '',
  notes       text[] not null default '{}'
);
create index on public.jung_lines (range_id, sort);

create table public.um_sentences (            -- 엄한문 문장
  id          uuid primary key default gen_random_uuid(),
  range_id    uuid not null references public.ranges(id) on delete cascade,
  unit_id     uuid references public.hanja_units(id) on delete cascade,
  sort        int  not null default 0,
  sentence    text not null default '',
  cards       text[] not null default '{}',
  orders      int[]  not null default '{}',
  translation text not null default '',
  source      text not null default ''
);
create index on public.um_sentences (range_id, sort);

-- =========================================================
-- 써머리 (PDF / 직접 쓰기) + 수정 기록
-- =========================================================
create table public.docs (
  id            uuid primary key default gen_random_uuid(),
  subject_id    uuid not null references public.subjects(id) on delete cascade,
  range_id      uuid references public.ranges(id) on delete set null,
  kind          text not null check (kind in ('pdf','rich')),
  title         text not null default '',
  sort          int  not null default 0,
  author_id     uuid references public.profiles(id) on delete set null,
  author_name   text not null default '',
  pdf_key       text,
  pdf_size      bigint,
  goodnotes_url text,
  content       jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null
);

create table public.doc_revisions (
  id         bigint generated always as identity primary key,
  doc_id     uuid not null,                  -- 삭제된 문서도 되돌릴 수 있게 FK 없음
  subject_id uuid not null,
  action     text not null,                  -- insert / update / delete
  snapshot   jsonb not null,
  by_user    uuid,
  by_name    text,
  at         timestamptz not null default now()
);
create index on public.doc_revisions (doc_id, at desc);
create index on public.doc_revisions (at desc);

create function public.docs_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := coalesce(new.author_id, auth.uid());
    new.author_name := coalesce(nullif(new.author_name,''), (select name from profiles where id = auth.uid()), '');
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger trg_docs_touch before insert or update on public.docs
  for each row execute function public.docs_touch();

create function public.docs_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  insert into doc_revisions (doc_id, subject_id, action, snapshot, by_user, by_name)
  values (r.id, r.subject_id, lower(tg_op), to_jsonb(r), auth.uid(),
          (select name from profiles where id = auth.uid()));
  return null;
end $$;
create trigger trg_docs_log after insert or update or delete on public.docs
  for each row execute function public.docs_log();

-- =========================================================
-- 학습 기록 (본인만)
-- =========================================================
create table public.hanja_progress (          -- 글자 기준. pool이 같으면 과목 달라도 공유
  user_id    uuid not null references public.profiles(id) on delete cascade,
  pool       text not null,
  ch         text not null,
  mode       text not null check (mode in ('r','h')),   -- r 한자→훈음 / h 훈음→한자
  status     text not null check (status in ('ok','no')),
  updated_at timestamptz not null default now(),
  primary key (user_id, pool, ch, mode)
);

create table public.item_progress (           -- 해석 쓰기 · 순서 맞추기 등 문항별
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  item_id    uuid not null,
  status     text check (status in ('ok','no')),
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, item_id)
);

create table public.wordbook (                -- 과목별 단어장
  user_id    uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  ch         text not null,
  result     text check (result in ('ok','no')),
  added_at   timestamptz not null default now(),
  primary key (user_id, subject_id, ch)
);

create table public.user_state (              -- 이어서 하기 · 문제 순서 · 화면 설정
  user_id    uuid not null references public.profiles(id) on delete cascade,
  key        text not null,
  value      jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- =========================================================
-- 본인용 RPC
-- =========================================================
-- 앱 열 때마다 호출 : 마지막 접속 갱신 + 30분 넘게 비었으면 로그인 기록 1줄
create function public.touch_session(p_device text) returns void
language plpgsql security definer set search_path = public as $$
declare last timestamptz;
begin
  select last_seen_at into last from profiles where id = auth.uid();
  if last is null or last < now() - interval '30 minutes' then
    insert into login_logs (user_id, device) values (auth.uid(), left(p_device, 200));
  end if;
  update profiles set last_seen_at = now() where id = auth.uid();
end $$;

-- 첫 로그인 마무리 (비밀번호 변경은 앱에서 auth.updateUser 로 먼저)
create function public.finish_first_login(p_student_no int) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set
    must_change_pw = false,
    student_no = case when scope = 'all' or student_no is null then p_student_no else student_no end
  where id = auth.uid();
end $$;

-- 학번 수정 (전체 열람 계정만)
create function public.set_my_student_no(p_student_no int) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set student_no = p_student_no, grade_override = null, grade_set_year = null
  where id = auth.uid() and (scope = 'all' or role = 'admin');
end $$;

-- =========================================================
-- RLS
-- =========================================================
alter table public.profiles        enable row level security;
alter table public.login_logs      enable row level security;
alter table public.subjects        enable row level security;
alter table public.ranges          enable row level security;
alter table public.blocks          enable row level security;
alter table public.subject_writers enable row level security;
alter table public.hanja_units     enable row level security;
alter table public.hanja_cards     enable row level security;
alter table public.jung_lines      enable row level security;
alter table public.um_sentences    enable row level security;
alter table public.docs            enable row level security;
alter table public.doc_revisions   enable row level security;
alter table public.hanja_progress  enable row level security;
alter table public.item_progress   enable row level security;
alter table public.wordbook        enable row level security;
alter table public.user_state      enable row level security;

-- 회원 : 본인 보기, 관리자 전부
create policy p_sel on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy p_adm on public.profiles for all    using (public.is_admin()) with check (public.is_admin());

create policy p_sel on public.login_logs for select using (public.is_admin());

-- 과목 구조 : 볼 수 있는 과목만, 수정은 관리자
create policy p_sel on public.subjects for select using (public.can_view_subject(id));
create policy p_adm on public.subjects for all    using (public.is_admin()) with check (public.is_admin());
create policy p_sel on public.ranges   for select using (public.can_view_subject(subject_id));
create policy p_adm on public.ranges   for all    using (public.is_admin()) with check (public.is_admin());
create policy p_sel on public.blocks   for select using (public.can_view_subject(subject_id));
create policy p_adm on public.blocks   for all    using (public.is_admin()) with check (public.is_admin());
create policy p_sel on public.subject_writers for select using (user_id = auth.uid() or public.is_admin());
create policy p_adm on public.subject_writers for all    using (public.is_admin()) with check (public.is_admin());

-- 한문 콘텐츠 : 보기는 과목 열람 권한, 수정은 관리자
create policy p_sel on public.hanja_units  for select using (public.can_view_subject(public.range_subject(range_id)));
create policy p_adm on public.hanja_units  for all    using (public.is_admin()) with check (public.is_admin());
create policy p_sel on public.hanja_cards  for select using (public.can_view_subject(public.range_subject(range_id)));
create policy p_adm on public.hanja_cards  for all    using (public.is_admin()) with check (public.is_admin());
create policy p_sel on public.jung_lines   for select using (public.can_view_subject(public.range_subject(range_id)));
create policy p_adm on public.jung_lines   for all    using (public.is_admin()) with check (public.is_admin());
create policy p_sel on public.um_sentences for select using (public.can_view_subject(public.range_subject(range_id)));
create policy p_adm on public.um_sentences for all    using (public.is_admin()) with check (public.is_admin());

-- 써머리 : 보기는 열람 권한, 쓰기는 관리자 + 담당 작성자
create policy p_sel on public.docs for select using (public.can_view_subject(subject_id));
create policy p_ins on public.docs for insert with check (public.can_write_subject(subject_id));
create policy p_upd on public.docs for update using (public.can_write_subject(subject_id)) with check (public.can_write_subject(subject_id));
create policy p_del on public.docs for delete using (public.can_write_subject(subject_id));
create policy p_sel on public.doc_revisions for select using (public.is_admin() or public.can_write_subject(subject_id));

-- 학습 기록 : 본인만
create policy p_own on public.hanja_progress for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy p_own on public.item_progress  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy p_own on public.wordbook       for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy p_own on public.user_state     for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================
-- 노출 (새 테이블 자동 노출 꺼둠 → 직접 허용)
-- =========================================================
grant select, insert, update, delete on
  public.profiles, public.subjects, public.ranges, public.blocks, public.subject_writers,
  public.hanja_units, public.hanja_cards, public.jung_lines, public.um_sentences,
  public.docs, public.hanja_progress, public.item_progress, public.wordbook, public.user_state
  to authenticated;
grant select on public.login_logs, public.doc_revisions to authenticated;

revoke execute on function public.touch_session(text), public.finish_first_login(int),
  public.set_my_student_no(int) from public, anon;
grant execute on function public.touch_session(text), public.finish_first_login(int),
  public.set_my_student_no(int), public.my_grade(), public.current_semester(), public.is_admin()
  to authenticated;
