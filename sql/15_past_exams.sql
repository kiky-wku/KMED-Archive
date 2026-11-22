-- kmed-archive 15 : 자료 종류에 '기출' 추가
--  이름은 '25학번 기말' 처럼 학번 + 중간/기말로만 (앱에서 고르게 함)
--  여러 번 실행해도 괜찮음
alter table public.files drop constraint if exists files_category_check;
alter table public.files add constraint files_category_check check (category in ('summary','etc','past'));
