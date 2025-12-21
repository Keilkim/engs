-- ============================================
-- ENGS 앱 Supabase 데이터베이스 스키마
-- Supabase SQL Editor에서 실행하세요
-- ============================================

-- 1. sources (학습 소스)
CREATE TABLE IF NOT EXISTS sources (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('pdf', 'url', 'image', 'screenshot')),
  content TEXT,
  thumbnail TEXT,
  screenshot TEXT,
  pages TEXT,
  ocr_data JSONB,
  file_path TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_accessed TIMESTAMP WITH TIME ZONE,
  pinned BOOLEAN DEFAULT FALSE,
  to_read BOOLEAN DEFAULT FALSE
);

-- Migration: Add screenshot column if not exists
-- ALTER TABLE sources ADD COLUMN IF NOT EXISTS screenshot TEXT;

-- Migration: Add pages column for PDF page images (JSON array of base64 strings)
-- ALTER TABLE sources ADD COLUMN IF NOT EXISTS pages TEXT;

-- Migration: Add ocr_data column for pre-computed word positions (JSONB)
-- ALTER TABLE sources ADD COLUMN IF NOT EXISTS ocr_data JSONB;
-- ocr_data structure:
-- {
--   "pages": [
--     { "pageIndex": 0, "words": [{ "text": "Hello", "bbox": { "x": 10.5, "y": 5.2, "width": 8.3, "height": 2.1 } }] }
--   ]
-- }

-- Migration: Add pinned and to_read columns
-- ALTER TABLE sources ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT FALSE;
-- ALTER TABLE sources ADD COLUMN IF NOT EXISTS to_read BOOLEAN DEFAULT FALSE;

-- Migration: Update type constraint to include 'screenshot'
-- Run this if you already have the sources table:
-- DO $$
-- DECLARE
--     constraint_name TEXT;
-- BEGIN
--     FOR constraint_name IN
--         SELECT conname FROM pg_constraint
--         WHERE conrelid = 'sources'::regclass AND contype = 'c'
--         AND pg_get_constraintdef(oid) LIKE '%type%'
--     LOOP
--         EXECUTE 'ALTER TABLE sources DROP CONSTRAINT ' || constraint_name;
--     END LOOP;
-- END $$;
-- ALTER TABLE sources ADD CONSTRAINT sources_type_check
--   CHECK (type IN ('pdf', 'url', 'image', 'screenshot'));

-- 2. annotations (어노테이션 - 하이라이트/메모)
CREATE TABLE IF NOT EXISTS annotations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  source_id BIGINT REFERENCES sources(id) ON DELETE CASCADE NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('highlight', 'memo')),
  coordinates TEXT,
  selected_text TEXT,
  memo_content TEXT,
  ai_analysis_json TEXT,
  selection_rect TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migration: Add selection_rect column for image annotations
-- ALTER TABLE annotations ADD COLUMN IF NOT EXISTS selection_rect TEXT;

-- 3. review_items (복습 아이템)
-- stack: 모르면 +1, 알면 -1. -10이면 완전히 외움 (더 이상 출현 안함)
-- stack이 높을수록 자주 등장 (가중치)
CREATE TABLE IF NOT EXISTS review_items (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  annotation_id BIGINT REFERENCES annotations(id) ON DELETE CASCADE NOT NULL,
  next_review_date DATE NOT NULL,
  interval_days INTEGER DEFAULT 1,
  ease_factor REAL DEFAULT 2.5,
  repetitions INTEGER DEFAULT 0,
  stack INTEGER DEFAULT 0,
  last_reviewed TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'suspended'))
);

-- Migration: Add stack column if not exists
-- ALTER TABLE review_items ADD COLUMN IF NOT EXISTS stack INTEGER DEFAULT 0;

-- 4. chat_logs (채팅 로그)
CREATE TABLE IF NOT EXISTS chat_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  source_id BIGINT REFERENCES sources(id) ON DELETE SET NULL,
  role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_scrapped BOOLEAN DEFAULT FALSE
);

-- 5. user_stats (사용자 통계)
CREATE TABLE IF NOT EXISTS user_stats (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  study_time_seconds INTEGER DEFAULT 0,
  cards_reviewed INTEGER DEFAULT 0,
  cards_correct INTEGER DEFAULT 0,
  sources_added INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

-- 6. notification_settings (알림 설정)
CREATE TABLE IF NOT EXISTS notification_settings (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  push_enabled BOOLEAN DEFAULT TRUE,
  review_reminder_enabled BOOLEAN DEFAULT TRUE,
  review_reminder_time TIME DEFAULT '09:00',
  encouragement_enabled BOOLEAN DEFAULT TRUE,
  achievement_enabled BOOLEAN DEFAULT TRUE
);

-- 7. push_tokens (푸시 토큰)
CREATE TABLE IF NOT EXISTS push_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  token VARCHAR(500) NOT NULL,
  device_type VARCHAR(20) CHECK (device_type IN ('ios', 'android', 'web')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- ============================================
-- 인덱스 생성
-- ============================================

CREATE INDEX IF NOT EXISTS idx_sources_user_id ON sources(user_id);
CREATE INDEX IF NOT EXISTS idx_sources_created_at ON sources(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sources_pinned ON sources(user_id, pinned) WHERE pinned = TRUE;
CREATE INDEX IF NOT EXISTS idx_sources_to_read ON sources(user_id, to_read) WHERE to_read = TRUE;

CREATE INDEX IF NOT EXISTS idx_annotations_user_id ON annotations(user_id);
CREATE INDEX IF NOT EXISTS idx_annotations_source_id ON annotations(source_id);

CREATE INDEX IF NOT EXISTS idx_review_items_user_id ON review_items(user_id);
CREATE INDEX IF NOT EXISTS idx_review_items_next_review ON review_items(next_review_date);

CREATE INDEX IF NOT EXISTS idx_chat_logs_user_id ON chat_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_logs_created_at ON chat_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_stats_user_date ON user_stats(user_id, date);

-- ============================================
-- Row Level Security (RLS) 정책
-- 사용자는 자신의 데이터만 접근 가능
-- ============================================

-- RLS 활성화
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- sources 정책
CREATE POLICY "Users can view own sources" ON sources
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sources" ON sources
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sources" ON sources
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sources" ON sources
  FOR DELETE USING (auth.uid() = user_id);

-- annotations 정책
CREATE POLICY "Users can view own annotations" ON annotations
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own annotations" ON annotations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own annotations" ON annotations
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own annotations" ON annotations
  FOR DELETE USING (auth.uid() = user_id);

-- review_items 정책
CREATE POLICY "Users can view own review_items" ON review_items
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own review_items" ON review_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own review_items" ON review_items
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own review_items" ON review_items
  FOR DELETE USING (auth.uid() = user_id);

-- chat_logs 정책
CREATE POLICY "Users can view own chat_logs" ON chat_logs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own chat_logs" ON chat_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own chat_logs" ON chat_logs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own chat_logs" ON chat_logs
  FOR DELETE USING (auth.uid() = user_id);

-- user_stats 정책
CREATE POLICY "Users can view own user_stats" ON user_stats
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own user_stats" ON user_stats
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own user_stats" ON user_stats
  FOR UPDATE USING (auth.uid() = user_id);

-- notification_settings 정책
CREATE POLICY "Users can view own notification_settings" ON notification_settings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own notification_settings" ON notification_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own notification_settings" ON notification_settings
  FOR UPDATE USING (auth.uid() = user_id);

-- push_tokens 정책
CREATE POLICY "Users can view own push_tokens" ON push_tokens
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own push_tokens" ON push_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own push_tokens" ON push_tokens
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own push_tokens" ON push_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- Storage 버킷 생성 (Supabase Dashboard에서 실행)
-- ============================================
-- 1. Storage > Create new bucket
-- 2. Name: "sources"
-- 3. Public bucket: ON (또는 필요에 따라 OFF)
--
-- 또는 SQL로:
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('sources', 'sources', true);

-- 업로드 허용
CREATE POLICY "Allow authenticated uploads"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'sources');

-- 읽기 허용
CREATE POLICY "Allow public read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'sources');