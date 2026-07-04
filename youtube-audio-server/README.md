# youtube-audio-server

YouTube 오디오 추출 서버 (Railway 배포용). LangBuddy 앱의 `/api/whisper`가
자막 없는 영상을 음성 인식할 때, 이 서버에서 yt-dlp로 오디오를 추출한다.

- **엔드포인트**: `POST /api/extract-audio` — body `{ videoId, startSec?, durationSec? }`.
  `startSec`/`durationSec`를 주면 그 구간만 추출(긴 영상 분할 전사용).
- **봇 차단 우회**: player_client 순회(android_vr, tv, …). 필요 시 쿠키를
  환경변수 `YTDLP_COOKIES_TXT`(Netscape cookies.txt 전체 내용)로 주입.
- **자동 최신화**: 컨테이너 부팅 시 yt-dlp를 최신으로 업데이트(Dockerfile CMD).

## Railway 배포
- Root Directory: `youtube-audio-server`
- Builder: Dockerfile (railway.json 참고)
- Vercel 쪽 `RAILWAY_AUDIO_URL`(미설정 시 코드의 기본 URL)이 이 서비스 주소를 가리켜야 함.

> 참고: Vercel(프론트) 빌드는 이 폴더를 사용하지 않는다. Railway 전용.
