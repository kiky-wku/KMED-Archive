-- ════════════════════════════════════════════════
--  23 : 예상문제 탭
--  · 기출문제와 같은 표(past_questions)를 쓰고 kind 로 구분 : 'past' 기출 / 'pred' 예상문제
--  · 풀이 기록은 item_progress 의 kind 'pred'
-- ════════════════════════════════════════════════
alter table public.past_questions add column if not exists kind text not null default 'past';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'past_questions_kind_chk') then
    alter table public.past_questions add constraint past_questions_kind_chk check (kind in ('past', 'pred'));
  end if;
end $$;
create index if not exists past_questions_range_kind on public.past_questions (range_id, kind, sort);
