-- kmed-archive 05 : 서버 함수(관리자 키)용 테이블 권한
-- (새 테이블 자동 노출을 꺼서 service_role 에도 직접 허용해야 함)
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
