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
