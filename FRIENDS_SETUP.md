# 친구 대결 연동 가이드

## 현재 상태

- 기존 GitHub Pages 싱글 플레이는 `main`에 그대로 유지합니다.
- 이 브랜치 `feat/friends-league`는 카카오 로그인, 초대형 비공개 친구방, 일간/주간 순위, 서버 점수 검증을 구현한 개발 버전입니다.
- **실제 카카오 로그인, 카카오톡 메시지 전송, Cloudflare 배포는 계정 연결 전에는 완료된 것으로 표시하지 않습니다.**
- 카카오 개발자 계정과 Cloudflare 배포 계정 인증이 필요합니다. API 키나 비밀번호를 채팅/이슈/커밋에 붙여넣지 마세요.

## 사용 흐름

1. 카카오 로그인: 닉네임만 동의. 친구 목록/연락처 권한은 요청하지 않습니다.
2. 방 만들기 또는 초대 링크로 참가. 방은 최대 30명, 직접 만드는 방은 최대 5개.
3. 카카오톡 공유 또는 링크 복사로 친구 초대. 실제 전송 대상은 사용자가 선택합니다.
4. 같은 KST 날짜에는 모두 같은 4×4 퍼즐. 되돌리기 없음.
5. 친구방에서 **현재 기록 등록**을 눌러 시도를 종료. 서버가 이동 기록을 재생해 점수를 계산합니다.
6. 일간은 각자의 최고 점수, 주간은 월요일부터 일별 최고 점수의 합. 방 참가자만 순위 조회. 열린 순위표는 20초마다 갱신.

카카오톡 친구 전체 자동 검색을 사용하는 구조가 아닙니다. 해당 API는 별도 권한 신청과 각 친구의 앱 연결/동의가 필요하므로 초대형 방을 사용합니다.

## 로컬 코드 테스트

Node.js 22.13 이상(내장 SQLite 사용). 외부 패키지 설치 없이:

```sh
npm test
npm run build
npm start
```

`npm start`는 기존 정적 서버입니다. 서버 API가 없으면 친구 진입 버튼을 숨기며 기존 게임은 작동합니다. 테스트의 카카오 API는 고립된 테스트 코드에서만 모의 처리합니다. 운영 서버에는 임시 로그인/게스트 인증 우회 경로가 없습니다.

## Cloudflare 연결

1. 본인 Cloudflare 계정으로 Wrangler를 인증합니다. 유료 플랜이나 유료 사용량을 임의 활성화하지 않습니다.
2. 계정의 최신 Workers/D1 무료 한도와 CPU 한도를 확인합니다. 실제 배포 후 긴 게임 이동 기록의 재생 시간도 확인해야 하며, 무료 한도에서 안정 동작한다고 미리 보장하지 않습니다.

```sh
npx wrangler login
npx wrangler d1 create afterglow-league
```

3. `wrangler.example.jsonc`를 `wrangler.local.jsonc`로 복사합니다.
4. 실제 생성된 D1 `database_id`와 실제 서비스 `PUBLIC_ORIGIN`을 입력합니다. `PUBLIC_ORIGIN`은 경로 없는 HTTPS origin입니다. 로컬 설정 파일은 Git에서 제외됩니다.
5. 공개 파일만 빌드하고 DB 마이그레이션을 적용한 뒤 배포합니다.

```sh
npm run build
npx wrangler d1 migrations apply afterglow-league --remote --config wrangler.local.jsonc
npm run deploy:league
```

Workers가 출력한 주소와 `PUBLIC_ORIGIN`이 다르면 실제 주소로 수정하고 다시 배포합니다. GitHub Pages는 서버/API/공유 DB를 실행할 수 없으므로, 친구 기능은 게임과 API를 같은 Cloudflare origin에서 제공해야 합니다. 기존 Pages 주소를 새 서버로 옮기는 작업은 실제 배포 검증 후 별도로 수행합니다.

## 카카오 개발자 앱 설정

공식 콘솔: https://developers.kakao.com/console/app

- 이 게임 전용 앱 생성 또는 적합한 기존 앱 선택. 기존 타 서비스의 설정을 덮어쓰지 않습니다.
- 카카오 로그인 사용 설정 ON.
- REST API 키의 리다이렉트 URI에 `실제 PUBLIC_ORIGIN/api/auth/kakao/callback` 등록.
- 닉네임(`profile_nickname`) 동의항목 설정. 이메일/전화번호/친구 목록은 요청하지 않음.
- JavaScript SDK 도메인과 제품 링크 웹 도메인에 실제 `PUBLIC_ORIGIN` 등록.
- 실제 서비스의 개인정보 안내 URL을 등록하고 운영자 정보와 처리 지역에 맞게 `privacy.html`을 검토·보완.

다음 값은 Cloudflare Secret으로 입력합니다. 저장소나 브라우저 JavaScript에 REST 키/클라이언트 시크릿을 넣지 않습니다.

```sh
npx wrangler secret put KAKAO_REST_API_KEY --config wrangler.local.jsonc
npx wrangler secret put KAKAO_CLIENT_SECRET --config wrangler.local.jsonc
npx wrangler secret put KAKAO_JS_KEY --config wrangler.local.jsonc
```

`KAKAO_JS_KEY`는 Kakao SDK 초기화를 위해 `/api/config`를 통해 브라우저에 전달되는 공개용 JavaScript 키입니다. REST 키 및 클라이언트 시크릿은 전송하지 않습니다. JS 키가 없으면 카카오톡 SDK 버튼 대신 링크 복사/지원 기기의 공유 메뉴가 제공됩니다. 로그인용 키가 없으면 실제 로그인 버튼을 활성화하지 않습니다.

## 공개 전 확인

- [ ] 실제 카카오 계정 2개로 로그인/로그아웃/만료/재로그인 검증
- [ ] PC와 휴대폰 카카오톡에서 초대 메시지 선택, 링크 열기, 방 참가 검증
- [ ] 다른 계정의 기록과 주간 합계가 표시되는지 검증
- [ ] 같은 날짜 퍼즐, KST 자정 만료, 기록 재등록 차단 검증
- [ ] 긴 게임 기록 제출의 CPU 시간과 무료 사용 한도 확인
- [ ] DB 정기 정리 작업, 데이터 삭제, 백업/복구 및 운영 연락처 확인
- [ ] 개인정보 위탁·국외 처리 관련 실제 고지 확정
- [ ] 기존 Pages 플레이/저장 데이터 이전 방식 공지 후 기본 주소 변경 여부 결정

## 보안과 한계

- 세션은 HttpOnly/Secure/SameSite=Lax 쿠키. DB에는 세션 토큰 해시만 저장.
- OAuth state를 쿠키와 대조하고 1회만 사용. 카카오 액세스 토큰은 로그인 처리 후 보관하지 않음.
- 쓰기 요청은 동일 origin과 세션별 CSRF 검증. 공개 CORS 없음.
- 방 ID는 무작위이며 방 참가자만 점수 조회 가능. 초대 링크가 재전달되면 받은 사람도 가입 후 참가 가능하므로 링크를 공개하지 마세요.
- 클라이언트 점수는 받지 않고 서버에서 방향 목록을 재생. 다른 사람의 시도/중복 제출/무효 이동/만료 시도 거부.
- **자동 플레이/봇을 완전히 막는 시스템은 아닙니다.** 캐주얼 친구 경쟁용이며 현금/상품 순위전에 적합하다고 보장하지 않습니다.
- 게임 데이터 삭제는 이 서비스의 서버 데이터를 삭제합니다. 카카오계정 연결 해제는 카카오의 연결된 서비스 설정에서 별도로 가능.

## 참고 문서와 리소스

- 카카오 로그인 설정: https://developers.kakao.com/docs/ko/kakaologin/prerequisite
- 친구 목록 제약: https://developers.kakao.com/docs/ko/kakaotalk-social/common
- 공유 SDK: https://developers.kakao.com/docs/ko/kakaotalk-share/js-link
- 공식 로그인 버튼: https://developers.kakao.com/tool/resource/login
- `assets/kakao-login.svg`는 카카오가 제공한 공식 로그인 버튼이며 Kakao의 디자인/사용 정책을 따릅니다. 프로젝트 자체 MIT 코드 라이선스와 별도입니다.
