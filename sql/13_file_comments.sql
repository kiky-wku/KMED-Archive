-- kmed-archive 13 : 자료 댓글
--  그 과목을 볼 수 있는 사람은 모두 읽고 씀 (이름 공개)
--  고치기 : 쓴 사람 / 지우기 : 쓴 사람 · 과목 담당 · 관리자
--  새 댓글 → 올린 사람 · 과목 담당 · 같은 파일에 댓글 단 사람에게 알림 (쓴 사람 빼고)
--  10 다음에 Run. 여러 번 실행해도 괜찮음

create table if not exists public.file_comments (
  id         uuid primary key default gen_random_uuid(),
  file_id    uuid not null references public.files(id) on delete cascade,
  author     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null check (length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);
create index if not exists file_comments_file on public.file_comments (file_id, created_at);

create or replace function public.file_subject(fid uuid) returns uuid
language sql stable security definer set search_path = public as $$ select subject_id from files where id = fid $$;

alter table public.file_comments enable row level security;
drop policy if exists p_sel on public.file_comments;
drop policy if exists p_ins on public.file_comments;
drop policy if exists p_upd on public.file_comments;
drop policy if exists p_del on public.file_comments;
create policy p_sel on public.file_comments for select using (public.can_view_subject(public.file_subject(file_id)));
create policy p_ins on public.file_comments for insert with check (author = auth.uid() and public.can_view_subject(public.file_subject(file_id)));
create policy p_upd on public.file_comments for update using (author = auth.uid()) with check (author = auth.uid());
create policy p_del on public.file_comments for delete using (author = auth.uid() or public.can_write_subject(public.file_subject(file_id)));

-- 새 댓글 알림
create or replace function public.file_comments_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare f record; sname text; who text;
begin
  select * into f from files where id = new.file_id;
  select name into sname from subjects where id = f.subject_id;
  select name into who from profiles where id = new.author;
  insert into notifications (user_id, kind, title, body, link, ref, actor)
  select distinct u, 'comment',
         sname || ' 자료 댓글',
         coalesce(nullif(f.series, ''), f.filename) || ': ' || left(new.body, 120),
         '#/s/' || f.subject_id || '?r=' || coalesce(f.range_id::text, '') || '&b=summary&open=comments&id=' || f.id,
         new.id, who
  from (
    select f.uploader u
    union select w.user_id from subject_writers w where w.subject_id = f.subject_id
    union select c.author from file_comments c where c.file_id = new.file_id
  ) t
  where u is not null and u <> new.author;
  return new;
end $$;
drop trigger if exists trg_file_comments_notify on public.file_comments;
create trigger trg_file_comments_notify after insert on public.file_comments
  for each row execute function public.file_comments_notify();

grant select, insert, update, delete on public.file_comments to authenticated;
grant execute on function public.file_subject(uuid) to authenticated;
