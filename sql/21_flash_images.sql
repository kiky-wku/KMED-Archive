-- ════════════════════════════════════════════════
--  21 : 플래시카드 사진 (앞면 · 뒷면 한 장씩)
--  · 사진 파일은 Cloudflare R2 (과목id/img/무작위.jpg), 여기에는 그 열쇠만 저장
--  · 보기 · 올리기 · 지우기 주소는 Edge Function 'files' 가 권한 확인 후 발급
-- ════════════════════════════════════════════════
alter table public.flash_cards add column if not exists front_img text;
alter table public.flash_cards add column if not exists back_img  text;
create index if not exists flash_cards_front_img on public.flash_cards (front_img) where front_img is not null;
create index if not exists flash_cards_back_img  on public.flash_cards (back_img)  where back_img  is not null;
