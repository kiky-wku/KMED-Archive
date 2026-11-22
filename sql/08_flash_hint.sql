-- kmed-archive 08 : 플래시카드 + 암기법
--  - flash_cards : 묶음 · 앞 · 뒤 · 암기법 (범위별)
--  - hanja_hints : 한자 암기법 (기록 공유 그룹 pool 단위 → 정한문 · 엄한문 어디서 나와도 같은 암기법)
--  - jung_lines.hint (묶음 첫 줄에 저장) · um_sentences.hint
-- 여러 번 실행해도 됨

create table if not exists public.flash_cards (
  id       uuid primary key default gen_random_uuid(),
  range_id uuid not null references public.ranges(id) on delete cascade,
  deck     text not null default '',
  front    text not null default '',
  back     text not null default '',
  hint     text not null default '',
  sort     int  not null default 0
);
create index if not exists flash_cards_range_sort on public.flash_cards (range_id, sort);

create table if not exists public.hanja_hints (
  pool       text not null,
  ch         text not null,
  hint       text not null default '',
  updated_at timestamptz not null default now(),
  primary key (pool, ch)
);

alter table public.jung_lines   add column if not exists hint text not null default '';
alter table public.um_sentences add column if not exists hint text not null default '';

-- 이 pool 을 쓰는 과목 중 하나라도 담당이면 쓰기 가능
create or replace function public.can_write_pool(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from subjects s where coalesce(s.progress_pool, s.id::text) = p and public.can_write_subject(s.id))
$$;

alter table public.flash_cards enable row level security;
alter table public.hanja_hints enable row level security;

drop policy if exists p_sel on public.flash_cards;
drop policy if exists p_wr  on public.flash_cards;
create policy p_sel on public.flash_cards for select using (public.can_view_subject(public.range_subject(range_id)));
create policy p_wr  on public.flash_cards for all
  using (public.can_write_subject(public.range_subject(range_id)))
  with check (public.can_write_subject(public.range_subject(range_id)));

drop policy if exists p_sel on public.hanja_hints;
drop policy if exists p_wr  on public.hanja_hints;
create policy p_sel on public.hanja_hints for select using (auth.uid() is not null);
create policy p_wr  on public.hanja_hints for all using (public.can_write_pool(pool)) with check (public.can_write_pool(pool));

grant select, insert, update, delete on public.flash_cards, public.hanja_hints to authenticated;
grant select, insert, update, delete on public.flash_cards, public.hanja_hints to service_role;
grant execute on function public.can_write_pool(text) to authenticated;
