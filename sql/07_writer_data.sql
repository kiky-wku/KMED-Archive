-- kmed-archive 07 : 과목 담당(작성자)도 맡은 과목의 학습 데이터(단원·한자·해석·문장)를 넣고 고칠 수 있게
--  (관리자는 기존 p_adm 정책으로 이미 가능)
do $$
declare t text;
begin
  foreach t in array array['hanja_units','hanja_cards','jung_lines','um_sentences'] loop
    execute format('drop policy if exists p_wr on public.%I', t);
    execute format('create policy p_wr on public.%I for all
      using (public.can_write_subject(public.range_subject(range_id)))
      with check (public.can_write_subject(public.range_subject(range_id)))', t);
  end loop;
end $$;
