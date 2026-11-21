-- kmed-archive 03 : 관리자 계정을 아이디 로그인으로 (kibeom0303)
-- 02_username.sql 다음에 실행

update auth.users
set email = 'kibeom0303@yrr-study.app', email_confirmed_at = coalesce(email_confirmed_at, now())
where id = (select id from public.profiles where role = 'admin' order by created_at limit 1);

update auth.identities
set identity_data = identity_data || jsonb_build_object('email', 'kibeom0303@yrr-study.app')
where provider = 'email'
  and user_id = (select id from public.profiles where role = 'admin' order by created_at limit 1);

update public.profiles
set email = 'kibeom0303@yrr-study.app', username = 'kibeom0303'
where id = (select id from public.profiles where role = 'admin' order by created_at limit 1);
