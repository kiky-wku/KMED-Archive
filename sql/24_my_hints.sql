-- ════════════════════════════════════════════════
--  24 : 나만의 암기법
--  · 카드(글 카드, 그림 카드 테이프)마다 내가 쓰는 암기법 한 줄. 나만 봄
--  · item_id : flash_cards.id 또는 그림 카드 테이프 id
-- ════════════════════════════════════════════════
create table if not exists public.my_hints (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id    uuid not null,
  text       text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.my_hints enable row level security;
drop policy if exists p_own on public.my_hints;
create policy p_own on public.my_hints for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.my_hints to authenticated;
