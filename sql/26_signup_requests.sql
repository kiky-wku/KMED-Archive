-- ════════════════════════════════════════════════
--  26 : 가입 요청
--  · 로그인 화면에서 이름, 학번, 학년, 원하는 아이디와 비밀번호로 요청
--  · 관리자가 승인하면 그 아이디와 비밀번호로 계정이 만들어짐 (Edge Function signup)
--  · 비밀번호는 서버 열쇠로 암호화해 두었다가 승인이나 거절 때 바로 지움. 앱에서는 볼 수 없음
-- ════════════════════════════════════════════════

create table if not exists public.signup_requests (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  student_no  int,
  grade       int check (grade between 1 and 6),
  username    text not null,
  secret      text not null default '',          -- 암호화된 비밀번호 (승인, 거절 뒤 비움)
  ip          text not null default '',          -- 보낸 곳 (sha256, 요청 너무 많을 때 막기용)
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references public.profiles(id) on delete set null
);
create unique index if not exists signup_req_user on public.signup_requests (lower(username)) where status = 'pending';
create index if not exists signup_req_status on public.signup_requests (status, created_at desc);

alter table public.signup_requests enable row level security;
drop policy if exists p_admin on public.signup_requests;
-- 관리자만 목록을 봄. 넣기, 승인, 거절은 Edge Function(service role) 만
create policy p_admin on public.signup_requests for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
revoke all on public.signup_requests from anon, authenticated;
-- secret, ip 칸은 관리자도 못 읽게 칸 단위로만 허용
grant select (id, name, student_no, grade, username, status, created_at, decided_at) on public.signup_requests to authenticated;

-- 끝난 요청은 30일 뒤 정리
create or replace function public.cleanup_signup_requests() returns void
language sql security definer set search_path = public as $$
  delete from signup_requests where status <> 'pending' and decided_at < now() - interval '30 days';
$$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'cleanup_signup_requests';
    perform cron.schedule('cleanup_signup_requests', '25 4 * * *', 'select public.cleanup_signup_requests()');
  end if;
end $$;
