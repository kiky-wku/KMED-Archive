-- ════════════════════════════════════════════════
--  25 : Claude 연결 (전용 커넥터)
--  · claude_tokens : 과목 담당이 만든 연결 열쇠. 열쇠 원문은 저장하지 않고 sha256 값만
--  · import_drafts : Claude가 보낸 데이터. "검토 대기"로만 들어오고, 앱에서 확인하고 넣어야 실제 데이터가 됨
--  · Claude 쪽(Edge Function claude-mcp)은 검토 대기에 올리기만 가능. 지우기, 회원 정보 보기 없음
-- ════════════════════════════════════════════════

create table if not exists public.claude_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  hash       text not null unique,
  hint       text not null default '',          -- 열쇠 끝 4글자 (어떤 열쇠인지 알아보기용)
  created_at timestamptz not null default now(),
  last_used  timestamptz
);
alter table public.claude_tokens enable row level security;
drop policy if exists p_sel on public.claude_tokens;
drop policy if exists p_ins on public.claude_tokens;
drop policy if exists p_del on public.claude_tokens;
create policy p_sel on public.claude_tokens for select using (user_id = auth.uid());
-- 과목 담당이나 관리자만 만들 수 있음. 한 사람 3개까지
create policy p_ins on public.claude_tokens for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('writer', 'admin'))
  and (select count(*) from public.claude_tokens t where t.user_id = auth.uid()) < 3
);
create policy p_del on public.claude_tokens for delete using (user_id = auth.uid());
grant select, insert, delete on public.claude_tokens to authenticated;

create table if not exists public.import_drafts (
  id         uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  range_id   uuid not null references public.ranges(id) on delete cascade,
  keys       text[] not null,                  -- 들어 있는 탭 (flash, occ, past, pred …)
  payload    jsonb not null,                   -- { 탭: 붙여넣기 글 (TSV) }
  rows       jsonb not null default '{}',      -- { 탭: 행 수 } (목록에 보여 주기용)
  title      text not null default '',
  note       text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  status     text not null default 'pending' check (status in ('pending', 'done', 'discarded'))
);
create index if not exists import_drafts_subj on public.import_drafts (subject_id, status, created_at desc);
alter table public.import_drafts enable row level security;
drop policy if exists p_sel on public.import_drafts;
drop policy if exists p_upd on public.import_drafts;
drop policy if exists p_del on public.import_drafts;
-- 넣기(insert)는 앱에서 못 함. Edge Function(service role) 만
create policy p_sel on public.import_drafts for select using (public.can_write_subject(subject_id));
create policy p_upd on public.import_drafts for update using (public.can_write_subject(subject_id)) with check (public.can_write_subject(subject_id));
create policy p_del on public.import_drafts for delete using (public.can_write_subject(subject_id));
grant select, update, delete on public.import_drafts to authenticated;

-- 끝난 것과 버린 것은 30일 뒤 정리
create or replace function public.cleanup_import_drafts() returns void
language sql security definer set search_path = public as $$
  delete from import_drafts where status <> 'pending' and created_at < now() - interval '30 days';
  delete from import_drafts where status = 'pending' and created_at < now() - interval '90 days';
$$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'cleanup_import_drafts';
    perform cron.schedule('cleanup_import_drafts', '20 4 * * *', 'select public.cleanup_import_drafts()');
  end if;
end $$;
