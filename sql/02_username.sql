-- kmed-archive 02 : 아이디 로그인
-- 로그인 계정 이메일 = {아이디}@yrr-study.app (메일 발송 없음, 내부용)

alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_key on public.profiles (lower(username));

-- 기존 계정 : 내부용 주소면 앞부분을 아이디로
update public.profiles set username = split_part(email, '@', 1)
where username is null and email like '%@yrr-study.app';

-- 새 계정 생성 시 아이디 자동 채움
create or replace function public.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, username)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''),
          case when new.email like '%@yrr-study.app' then split_part(new.email, '@', 1) end);
  return new;
end $$;
