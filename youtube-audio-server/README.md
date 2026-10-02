# youtube-audio-server

YouTube 오디오 추출 서버 (Railway 배포용). LangBuddy 앱의 `/api/whisper`가
자막 없는 영상을 음성 인식할 때, 이 서버에서 yt-dlp로 오디오를 추출한다.

- **엔드포인트**: `POST /api/extract-audio` — body `{ videoId, startSec, durationSec }`.
  항상 구간 단위로만 추출(최대 5400초). `POST /api/info` — body `{ videoId }` → 영상 길이.
- **인증(필수)**: 모든 `/api/*` 요청은 `Authorization: Bearer <Supabase access token>`이
  있어야 한다(브라우저는 자기 세션 토큰, Vercel `/api/whisper`는 호출자 토큰을 전달).
  환경변수 `SUPABASE_URL`, `SUPABASE_ANON_KEY`가 없으면 모든 요청을 거부한다(fail-closed).
- **남용 방지**: 사용자당 분당 `EXTRACT_RATE_MAX`(기본 20)회, yt-dlp 동시 실행
  `YTDLP_MAX_CONCURRENT`(기본 6) + 대기열 `YTDLP_MAX_QUEUE`(기본 16), 초과 시 503.
  `ALLOWED_ORIGINS`(쉼표 구분)를 주면 CORS도 그 출처로 제한.
- **봇 차단 우회**: player_client 순회(android_vr, tv, …). 필요 시 쿠키를
  환경변수 `YTDLP_COOKIES_TXT`(Netscape cookies.txt 전체 내용)로 주입.
- **자동 최신화**: 컨테이너 부팅 시 `yt-dlp[default]`를 최신으로 업데이트(Dockerfile CMD).
  Deno와 함께 `yt-dlp-ejs`도 설치/업데이트해야 유튜브 JavaScript challenge를 처리할 수 있다.
  참고: [yt-dlp EJS 설치 안내](https://github.com/yt-dlp/yt-dlp/wiki/EJS).
- **오류 구분**: 봇 차단은 `YOUTUBE_BOT_BLOCKED`(502), 추출 시간 초과는
  `AUDIO_EXTRACTION_TIMEOUT`(504), 그 외 추출 실패는 `AUDIO_EXTRACTION_FAILED`(502).
  stderr/쿠키 내용은 응답에 포함하지 않는다. 인증·쿠키가 필요한 봇 차단은
  코드 업데이트만으로 해소됐다고 판단하지 말고 실제 영상 추출로 확인해야 한다.

## Railway 배포
- Root Directory: `youtube-audio-server`
- Builder: Dockerfile (railway.json 참고)
- Vercel 쪽 `RAILWAY_AUDIO_URL`(미설정 시 코드의 기본 URL)이 이 서비스 주소를 가리켜야 함.

> 참고: Vercel(프론트) 빌드는 이 폴더를 사용하지 않는다. Railway 전용.
