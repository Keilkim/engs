# 2026-10-30 · 안내 문구 오른쪽의 터치 손

- 손등 장갑을 정답·오답 안내 제목의 오른쪽 끝으로 옮겼다. 왼쪽으로 28도 기울어진 상태에서 터치 동작과 직선 효과를 반복하며, 동작 줄이기에서도 기울기는 유지한다.
- 카드 아래에는 밝은 회색 `확인하고 터치!` 문구를 표시한다. 화면 어디든 터치하거나 Enter·Space를 누르면 다음 카드로 넘어가는 동작은 유지한다.
- 320×568, 390×844, 1440×1000에서 제목이 한 줄로 표시되고 손과 겹치지 않는 것을 확인했다. 정답·오답, 손 영역 터치, Enter, 동작 줄이기를 격리된 브라우저 데이터로 확인했다.
- 기존 테스트 158개, TypeScript 검사, 수정 컴포넌트 ESLint, `git diff --check`, Vercel 프로덕션 빌드가 통과했다. 프로덕션 의존성 취약점 0개, 공개 산출물의 비밀 값·개인 파일·소스맵·심볼릭 링크 노출 0개다.
- 대상은 기존 `Keilkim/engs` main 및 <https://engs-red.vercel.app>이다. 배포 후 HTTP 검사·배포 자산 해시·해당 브라우저 흐름을 확인하고 `.vercel/feedback-hand-position-release-evidence.json`에 정확한 리비전과 배포 정보를 기록한다.
- 직전 정상 배포는 `dpl_5sfFHdrAmJnZHGgjwDFucdNQLc3K`, 리비전 `2b3c0207d2ba8f5c19f634d6fe3f52103d4c5b92`이다. 필요 시 `vercel rollback dpl_5sfFHdrAmJnZHGgjwDFucdNQLc3K --scope lloa9000-6635s-projects --yes`로 복구한다.
- 데이터·스키마·인증·키 변경은 없다. [이전 릴리스](2026-10-30-tap-to-continue.md)의 저장 데이터 암호화·백업·복구 검증 한계, 기존 계정 삭제 키 미설정, 실제 마이크·iOS·실제 사용자 저장 미검증이 이어진다. 브라우저에서 실제 사용자 데이터는 수정하지 않는다.
