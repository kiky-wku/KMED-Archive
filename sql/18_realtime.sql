-- 18. 실시간 연결 : 알림과 자료 변경을 앱에 바로 보내기
-- Supabase 실시간 목록(supabase_realtime)에 두 표를 넣는다. 이미 들어 있으면 건너뜀.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'files') then
    alter publication supabase_realtime add table public.files;
  end if;
end $$;
