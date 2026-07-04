-- ============================================
-- 기존 DB에 "바뀐 부분만" 안전하게 적용하는 마이그레이션
-- (2026-07-04 진단 수정 반영분)
--
-- 사용법: Supabase → SQL Editor 에 "이 파일 전체"를 붙여넣고 Run.
-- 여러 번 실행해도 안전합니다(모두 IF NOT EXISTS / DROP-then-CREATE).
-- ※ supabase-schema.sql(전체 스키마)은 "새 프로젝트 최초 세팅용"이며,
--   이미 운영 중인 DB에는 이 마이그레이션 파일만 돌리세요.
-- ============================================

-- 1) sources: YouTube/언어 컬럼 보장 (이미 있으면 무시)
ALTER TABLE sources ADD COLUMN IF NOT EXISTS youtube_data JSONB;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS captions_data JSONB;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS source_language VARCHAR(10);
ALTER TABLE sources ADD COLUMN IF NOT EXISTS to_read BOOLEAN DEFAULT FALSE;

-- 2) annotations.source_id 를 NULL 허용으로
--    (마이페이지의 '단어 직접 추가 / 패턴 추가'는 특정 소스에 묶이지 않음)
--    이미 nullable이면 아무 일도 일어나지 않습니다.
ALTER TABLE annotations ALTER COLUMN source_id DROP NOT NULL;

-- 3) review_items: SM-2 복습에 필요한 컬럼 보장 (이미 있으면 무시)
ALTER TABLE review_items ADD COLUMN IF NOT EXISTS interval_days INTEGER DEFAULT 1;
ALTER TABLE review_items ADD COLUMN IF NOT EXISTS ease_factor REAL DEFAULT 2.5;
ALTER TABLE review_items ADD COLUMN IF NOT EXISTS repetitions INTEGER DEFAULT 0;
ALTER TABLE review_items ADD COLUMN IF NOT EXISTS last_reviewed TIMESTAMP WITH TIME ZONE;

-- 4) [핵심] Storage 파일 삭제 정책
--    자료/계정 삭제 시 업로드했던 실제 파일(PDF/이미지)을 지울 수 있게 함.
--    이게 없으면 '계정 삭제'와 '고아 파일 정리'가 파일을 못 지웁니다.
DROP POLICY IF EXISTS "Allow authenticated deletes" ON storage.objects;
CREATE POLICY "Allow authenticated deletes"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'sources');
