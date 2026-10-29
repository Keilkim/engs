# 2026-10-30 · 오늘의 작은 복습 릴리스

## 대상과 변경

- 저장소: `Keilkim/engs`, 기존 공개 저장소·`main` 유지.
- 호스팅: Vercel `lloa9000-6635s-projects / engs`, 프로젝트 `prj_ds9lpfb2o6fJqBTXmbnLwqG0AxIN`.
- 프로덕션: <https://engs-red.vercel.app>.
- 기반 커밋: `1bc0d5b`. 새 리비전은 이 문서를 포함한 Git 커밋이며, 실제 배포 리비전·ID와 배포 후 결과는 로컬 `.vercel/release-evidence.json`에 기록한다. 인증 값은 기록하지 않는다.
- 구현: [오늘의 작은 복습](../vocabulary-learning/implementation.md). 페르소나 5명·가상 인터뷰·공개 조사·실험 계획도 함께 저장한다.
- 현재 패키지 범위 안에서 잠금 파일의 취약 의존성을 갱신했다. 브라우저 마이크를 허용하면서 카메라·위치 권한을 차단하고 MIME sniffing 방지·referrer 정책 헤더를 추가했다.

## 배포 전 검증

| 검사 | 결과 |
|---|---|
| `npm run build` | 성공 |
| `npm test` | 152개 통과, 실패 0 |
| `npx tsc --noEmit` | 통과 |
| `npm run lint` | 오류 0, 기존 hooks 경고 10 |
| `npm audit --omit=dev` | 알려진 취약점 0건, 검사 시점 기준 |
| `git diff --check` | 통과 |
| `dist` 공개 산출물 | 43개 파일, 비공개 파일·소스맵·심볼릭 링크 0, 로컬의 비공개 환경 값 3개와 대조해 노출 0 |
| Chrome 브라우저 | 390px·1280px, 16개 흐름 통과, page error 0 |

브라우저 확인: 홈 진입, 무음, 5개 한 묶음, 정답 공개, 공개 위치 복원, 저장 실패 재시도, 오답 재시도 시 일정 유지, 일시정지, STT 실패 시 미채점, 보류·복원, 화면 크기, 한 번 눌러 샘플 시작, 샘플 복원·무저장, 명시적 TTS, STT 일치 후 자기확인, 대안 표현 입력 후 자기확인. Supabase와 음성을 격리된 fixture로 대체했으며 운영 사용자 데이터를 읽거나 수정하지 않았다.

빌드에는 Supabase 의존성 wrapper의 default export 관련 경고가 남아 있지만 번들 생성은 성공한다. 실제 브라우저 음성 인식의 품질·이어폰 분리, iOS Safari, 실제 로그인 계정의 원격 저장 성공, 실제 사용자 장기 효과는 이 검사로 증명되지 않는다. 일별 통계는 카드 저장과 별도 요청이므로 통계 요청 실패 시 집계 누락 가능성이 있다.

## 배포 후 확인

`node scripts/verify-release.mjs https://engs-red.vercel.app`으로 HTTPS·보안 헤더·기본 문서, 미인증/잘못된 토큰의 API 거부, 비공개 경로가 실제 파일 내용을 반환하지 않는지 확인한다. SPA rewrite가 문서를 반환하는 경우 HTML fallback인지 검사한다. 배포된 자산의 새 복습 UI는 격리된 브라우저로 재확인한다.

배포 산출물에서는 `.env*`, Git 메타데이터, 조사 문서·페르소나·SQL·테스트를 `.vercelignore`로 제외한다. 공개 JavaScript는 누구나 읽을 수 있으며, 압축을 기밀성의 근거로 삼지 않는다.

## 복구와 데이터 경계

- 이전 정상 배포: `dpl_AeGZJccDV6sZ1hgDGT2nxb4hJy9A`.
- 이전 불변 주소: `https://engs-pu4lypppi-lloa9000-6635s-projects.vercel.app`.
- 필요 시 `vercel rollback dpl_AeGZJccDV6sZ1hgDGT2nxb4hJy9A --scope lloa9000-6635s-projects --yes` 후 별칭과 HTTP 검사를 다시 확인한다. 실제 롤백은 이번 정상 릴리스에서 실행하지 않는다.
- 데이터 저장소는 기존 Supabase이며 스키마·인증 방식·복구 키·암호화 키를 변경하지 않는다. 신규 브라우저 체크포인트는 구버전이 읽지 않아도 기존 서버 복습 데이터에 영향을 주지 않는다.
- HTTPS 전송 보안은 공개 HTTP 검사로 확인한다. 저장 데이터 암호화, 비밀번호 해시 구현, 최근 백업 시각·격리 복원·원본 호스트 손실 후 백업 생존성은 이 작업에서 관리 측 증거를 확보하지 못했으므로 검증 완료로 표시하지 않는다. 데이터 마이그레이션은 수행하지 않았다.
- 기존 비밀 값은 Vercel 프로젝트 환경 변수와 Supabase 관리 체계를 유지한다. 별도 복구 키의 보관 위치는 확인하지 못했으며 생성·이동하지 않았다.
