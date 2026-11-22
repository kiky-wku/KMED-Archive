-- 19. 기출문제 : 원본 PDF 를 AI 로 데이터화한 문제은행
--  exam     : 시험 이름 ('25학번 기말' 처럼 원본 PDF 이름과 같게)
--  type     : mc 객관식, ox, blank 빈칸, short 단답, essay 서술
--  passage  : 여러 문제가 같이 보는 지문 (없으면 비움)
--  choices  : 객관식 보기 ["…", "…"]
--  answer   : 정답 (객관식은 번호, OX 는 O 또는 X)
--  ai       : AI 가 써머리를 보고 추정한 정답이면 true, 사람이 확인하거나 고치면 false

create table if not exists public.past_questions (
  id         uuid primary key default gen_random_uuid(),
  range_id   uuid not null references public.ranges(id) on delete cascade,
  exam       text not null default '',
  no         text not null default '',
  type       text not null default 'short' check (type in ('mc','ox','blank','short','essay')),
  passage    text not null default '',
  question   text not null default '',
  choices    jsonb not null default '[]',
  answer     text not null default '',
  explain    text not null default '',
  ai         boolean not null default true,
  sort       int not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists past_q_range on public.past_questions (range_id, exam, sort);

alter table public.past_questions enable row level security;
drop policy if exists p_sel on public.past_questions;
drop policy if exists p_wr  on public.past_questions;
create policy p_sel on public.past_questions for select using (public.can_view_subject(public.range_subject(range_id)));
create policy p_wr  on public.past_questions for all
  using (public.can_write_subject(public.range_subject(range_id)))
  with check (public.can_write_subject(public.range_subject(range_id)));

grant select, insert, update, delete on public.past_questions to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.past_questions to service_role;
  end if;
end $$;
