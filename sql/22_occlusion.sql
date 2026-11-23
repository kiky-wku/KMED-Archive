-- ════════════════════════════════════════════════
--  22 : 그림 카드 (가리기)
--  · 그림 한 장 = occ_sets 한 행. 이름 자리에 붙인 테이프(boxes) 하나가 카드 한 장
--  · kind 'label' : 테이프 붙인 이름 맞히기 / 'whole' : 그림 전체 보고 이름 맞히기
--  · labels : AI 가 뽑아 준 이름 목록 (테이프에 붙일 이름 후보)
--  · boxes  : [{ id(uuid), x, y, w, h (0~1, 그림 크기 기준), name }]
--  · 그림(img)이 아직 없는 행은 담당자에게만 '그림 넣기 필요'로 보이고 학생에게는 안 보임
--  · 데이터 다시 넣기(붙여넣기)는 그림이나 테이프가 있는 행을 지우지 않음
-- ════════════════════════════════════════════════
create table if not exists public.occ_sets (
  id         uuid primary key default gen_random_uuid(),
  range_id   uuid not null references public.ranges(id) on delete cascade,
  deck       text not null default '',
  title      text not null default '',
  kind       text not null default 'label' check (kind in ('label', 'whole')),
  labels     jsonb not null default '[]',
  boxes      jsonb not null default '[]',
  img        text,
  img_w      int,
  img_h      int,
  src_file   text not null default '',
  src_page   int,
  hint       text not null default '',
  sort       int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists occ_sets_range_sort on public.occ_sets (range_id, sort);
create index if not exists occ_sets_img on public.occ_sets (img) where img is not null;

alter table public.occ_sets enable row level security;
drop policy if exists p_sel on public.occ_sets;
drop policy if exists p_wr  on public.occ_sets;
create policy p_sel on public.occ_sets for select using (public.can_view_subject(public.range_subject(range_id)));
create policy p_wr  on public.occ_sets for all
  using (public.can_write_subject(public.range_subject(range_id)))
  with check (public.can_write_subject(public.range_subject(range_id)));

grant select, insert, update, delete on public.occ_sets to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.occ_sets to service_role;
  end if;
end $$;
