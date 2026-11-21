-- kmed-archive 00 : 전부 지우기 (01을 다시 실행하기 전에만 사용)
-- 주의: 모든 테이블과 데이터가 사라짐. 로그인 계정(auth.users)은 남음

drop trigger if exists trg_auth_user_created on auth.users;

drop table if exists
  public.user_state, public.wordbook, public.item_progress, public.hanja_progress,
  public.doc_revisions, public.docs,
  public.um_sentences, public.jung_lines, public.hanja_cards, public.hanja_units,
  public.subject_writers, public.blocks, public.ranges, public.subjects,
  public.login_logs, public.profiles
  cascade;

drop function if exists
  public.on_auth_user_created(), public.profiles_grade_year(),
  public.kst_now(), public.current_semester(), public.academic_year(),
  public.grade_of(int), public.effective_grade(int,int,int),
  public.is_admin(), public.my_grade(), public.can_view_subject(uuid),
  public.can_write_subject(uuid), public.range_subject(uuid),
  public.docs_touch(), public.docs_log(),
  public.touch_session(text), public.finish_first_login(int), public.set_my_student_no(int)
  cascade;
