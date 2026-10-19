# 오렌지 더스트 (Orange Dust) - 영어 학습 앱

React + Vite + Supabase + Vercel 기반 AI 영어 학습 튜터 앱

## 🚀 시작하기

### 1. Supabase 설정

1. [Supabase](https://supabase.com)에서 새 프로젝트 생성
2. SQL Editor에서 `supabase-schema.sql` 실행
3. Storage > Create bucket "sources" (Public)
4. Authentication > Providers에서 Google, Kakao 설정 (선택)

### 2. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일 수정:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_GOOGLE_API_KEY=your-google-api-key
```

### 3. 실행

```bash
npm install
npm run dev
```

### 4. Vercel 배포

계정 삭제 API(`/api/delete-account`)에는 Vercel 서버 환경 변수
`SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`가 필요합니다.
서비스 역할 키는 브라우저에 노출되면 안 되므로 `VITE_` 접두사를 붙이지 마세요.
설정이 없으면 삭제 API는 자료를 지우지 않고 오류를 반환합니다.
삭제 시 사용자의 `sources` Storage 폴더(연결이 끊긴 업로드 포함)를 먼저 정리한 뒤
Auth 계정을 삭제합니다. 앱 데이터는 `supabase-schema.sql`의
`auth.users ... ON DELETE CASCADE` 제약으로 함께 삭제되므로 해당 스키마를 적용해야 합니다.
파일 정리에 실패하거나 한 번의 처리 한도를 넘으면 계정은 유지되며 재시도로 정리를 이어갑니다.

```bash
npm run build
vercel
```

## 📁 프로젝트 구조

```
src/
├── pages/           # 페이지 컴포넌트
│   ├── login/       # 로그인
│   ├── register/    # 회원가입
│   ├── home/        # 메인 홈
│   ├── viewer/      # 학습 뷰어
│   ├── review/      # 복습 센터
│   ├── chat/        # AI 대화
│   ├── mypage/      # 마이페이지
│   └── settings/    # 설정
├── components/      # 공통 컴포넌트
├── containers/      # 컨테이너 컴포넌트
├── contexts/        # React Context
├── services/        # API 서비스
├── hooks/           # Custom Hooks
├── utils/           # 유틸리티
└── styles/          # CSS (추후 적용)
```

## ✨ 기능

- 📚 PDF/URL/이미지 소스 학습
- ✏️ 텍스트 하이라이트 & 메모
- 🤖 AI 단어/문법 분석 (Google Gemini)
- 🔊 TTS 발음 듣기
- 📝 SM-2 알고리즘 복습 시스템
- 💬 AI 튜터 대화
- 📊 학습 통계 대시보드

## 🛠 기술 스택

- **Frontend**: React 18 + Vite
- **Backend**: Supabase (Auth, DB, Storage)
- **AI**: Google Gemini API
- **Deploy**: Vercel
