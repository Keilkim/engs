-- ============================================
-- 기존 DB에 "바뀐 부분만" 안전하게 적용하는 마이그레이션
-- (2026-07-04 진단 수정 반영분 + 2026-10-03 보안 강화: 4~7번)
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

-- 4) [보안] Storage 'sources' 버킷 정책 — 본인 폴더({user_id}/...)만 업로드/조회/삭제
--    이전 정책은 bucket_id만 확인해서
--      · 로그인한 아무 사용자나 "다른 사람의 파일"을 삭제할 수 있었고
--      · anon 키만으로 버킷 전체 파일 목록(list)을 열람할 수 있었습니다.
--    버킷은 public 그대로라 getPublicUrl 로 만든 기존 링크는 계속 열립니다
--    (public 다운로드 경로는 RLS를 거치지 않음). remove()는 SELECT+DELETE 권한이
--    필요해서 SELECT도 본인 폴더로 남겨 둡니다.
--    ※ 2026-07-04 이전 업로드는 버킷 루트에 있어 이 정책으로는 클라이언트에서 지울 수
--      없습니다. 필요하면 대시보드(서비스 롤)에서 정리하세요.
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes" ON storage.objects;

DROP POLICY IF EXISTS "Users upload to own folder" ON storage.objects;
CREATE POLICY "Users upload to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'sources' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users read own folder" ON storage.objects;
CREATE POLICY "Users read own folder"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'sources' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users delete own folder" ON storage.objects;
CREATE POLICY "Users delete own folder"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'sources' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 5) [보안] 다른 사용자의 행을 참조하는 INSERT/UPDATE 차단
--    기존 정책은 user_id만 확인해서, 남의 source_id / annotation_id 를 FK로 걸 수 있었습니다.
DROP POLICY IF EXISTS "Users can insert own annotations" ON annotations;
CREATE POLICY "Users can insert own annotations" ON annotations
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (annotations.source_id IS NULL OR EXISTS (
      SELECT 1 FROM sources s WHERE s.id = annotations.source_id AND s.user_id = auth.uid()))
  );
DROP POLICY IF EXISTS "Users can update own annotations" ON annotations;
CREATE POLICY "Users can update own annotations" ON annotations
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (annotations.source_id IS NULL OR EXISTS (
      SELECT 1 FROM sources s WHERE s.id = annotations.source_id AND s.user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "Users can insert own review_items" ON review_items;
CREATE POLICY "Users can insert own review_items" ON review_items
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM annotations a
                WHERE a.id = review_items.annotation_id AND a.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can update own review_items" ON review_items;
CREATE POLICY "Users can update own review_items" ON review_items
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM annotations a
                WHERE a.id = review_items.annotation_id AND a.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can insert own chat_logs" ON chat_logs;
CREATE POLICY "Users can insert own chat_logs" ON chat_logs
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (chat_logs.source_id IS NULL OR EXISTS (
      SELECT 1 FROM sources s WHERE s.id = chat_logs.source_id AND s.user_id = auth.uid()))
  );
DROP POLICY IF EXISTS "Users can update own chat_logs" ON chat_logs;
CREATE POLICY "Users can update own chat_logs" ON chat_logs
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (chat_logs.source_id IS NULL OR EXISTS (
      SELECT 1 FROM sources s WHERE s.id = chat_logs.source_id AND s.user_id = auth.uid()))
  );

-- 6) [보안] 유료 API 사용량 한도 (Vercel /api 의 consumeQuota 가 호출)
--    api_usage 는 정책이 하나도 없어서 클라이언트가 직접 읽거나 고칠 수 없고,
--    SECURITY DEFINER 함수만 auth.uid() 본인 행을 "증가"시킬 수 있습니다.
--    ⚠️ 이 SQL을 먼저 실행한 뒤 Vercel을 배포하세요. 함수가 없으면 Gemini/Whisper/
--       스크린샷/PDF 프록시가 503으로 거부됩니다(fail-closed).
CREATE TABLE IF NOT EXISTS api_usage (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  day DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('gemini', 'whisper_sec', 'screenshot', 'pdf_proxy')),
  used BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, kind)
);
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON api_usage FROM anon, authenticated;

CREATE OR REPLACE FUNCTION consume_api_quota(p_kind TEXT, p_amount INTEGER, p_limit INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  -- p_amount > 0: a caller can only ever add to its own usage, never reduce it.
  IF v_uid IS NULL OR p_amount IS NULL OR p_amount <= 0 OR p_limit IS NULL OR p_amount > p_limit THEN
    RETURN FALSE;
  END IF;
  INSERT INTO api_usage AS u (user_id, day, kind, used)
  VALUES (v_uid, CURRENT_DATE, p_kind, p_amount)
  ON CONFLICT (user_id, day, kind)
  DO UPDATE SET used = u.used + EXCLUDED.used
  WHERE u.used + EXCLUDED.used <= p_limit;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION consume_api_quota(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION consume_api_quota(TEXT, INTEGER, INTEGER) TO authenticated;

-- 7) 적용 후 확인용 쿼리 (결과만 보고 판단; 실행해도 아무것도 바꾸지 않음)
--   · RLS 꺼진 public 테이블이 있으면 안 됩니다 (특히 스키마 파일에 없는 user_settings):
--       SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--       WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY relname;
--   · 대시보드에서 만든 "다른 이름"의 허용 정책이 남아 있으면 위 정책과 OR 로 합쳐져 무력화됩니다:
--       SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check FROM pg_policies
--       WHERE schemaname IN ('public', 'storage') ORDER BY tablename, cmd;
