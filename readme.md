# 과제 알리미

학교 Google 계정으로 로그인해 학년·반의 과제와 공지를 확인하는 Express/MySQL 웹 앱입니다. 2026-10-01에 기존 프로젝트를 개선했습니다.

## 이번 개선

- 데스크톱·모바일·다크모드 디자인 개선. 마감 요약, 검색, 제출 상태 필터, 오늘 이동, 제출 진행률.
- 월말 이동·UTC 날짜 오차, 중복 저장·삭제, 통신 오류, 오류 재시도, 모달 키보드 조작 개선.
- **AI 챗봇 원본은 주석으로 보존하고 완전히 비활성화.** 메뉴·스크립트 실행·SDK·AI 호출을 제거했고 `/api/chatbot`, `chatbot.html`, `js/chatbot.js`는 410을 반환합니다. API 키를 입력해도 활성화되지 않습니다.
- Google 표시 이름으로 기존 계정을 가져가던 취약점 제거. 검증한 고유 `sub`로 식별하며 동명이인을 허용합니다. 학교 Workspace의 `hd`도 확인합니다.
- 이메일의 `teacher` 문자열만으로 관리자 권한을 주던 규칙 제거. 명시한 관리자 이메일만 인정합니다.
- 세션/가입 토큰 분리, CSRF, 삭제 계정 세션, 입력·이미지 검증, 비공개 첨부파일 권한 개선.
- 과제·제출 상태 트랜잭션, 이미지 저장 용량 제한, 원격 MySQL TLS, health API.
- Node.js 24 / MySQL 8.4 LTS 기반 Docker, 잠금 파일 기반 설치, 일반 사용자로 서버 실행.

## 실행

Docker와 Compose를 설치한 뒤:

```sh
cp .env.example .env
# 실제 DB 비밀번호, JWT_SECRET, GOOGLE_CLIENT_ID, 관리자 이메일 설정
# JWT_SECRET은 openssl rand -hex 48 로 생성
# localhost:3000을 Google 웹 클라이언트 JavaScript 원본에 등록

docker compose up -d --build
```

로컬 주소는 `http://localhost:3000`입니다. MySQL 포트는 호스트에 공개하지 않고 앱은 loopback에만 연결합니다. DB는 `mysql/data`, 이미지는 Docker의 `assignment-images` volume에 보관됩니다. 개별 이미지 최대 4MB, 전체 저장 한도 기본 512MB이며 `ASSIGNMENT_IMAGE_MAX_STORAGE_MB`로 조정합니다.

## 운영 설정

- `GOOGLE_CLIENT_ID`: 기존 Google OAuth 웹 클라이언트 ID. 현재 `@bssm.hs.kr` 학교 Workspace 계정만 허용합니다.
- `ADMIN_GOOGLE_EMAILS`: 실제 관리자 학교 이메일들을 쉼표로 구분. **기존 Google 관리자 권한도 이 목록으로 다시 계산하므로 배포 전에 설정해야 합니다.**
- `JWT_SECRET`: 32바이트 이상 무작위 비밀값. 이전 세션은 토큰 형식 변경 때문에 재로그인이 필요합니다.
- 외부 HTTPS 운영은 `NODE_ENV=production`, `APP_ORIGIN=https://실제주소`, `TRUST_PROXY=1`. `1`은 이 구성처럼 앱 직접 접속을 막고 단일 프록시를 거칠 때 사용합니다.
- 원격 MySQL은 `DB_SSL=true`, `DB_SSL_CA`에 서비스 CA PEM 인증서를 설정합니다. 인증서 검증을 끄지 않습니다.

기존 비밀번호 계정을 Google 이름으로 자동 연결하지 않습니다. 과거 제출 이력을 연결하려면 관리자가 실제 소유자를 확인해 별도로 이전해야 합니다. 이전의 잘못된 자동 연결로 이미 계정 정보가 바뀌었다면 소스 수정만으로 원래 소유자를 복원할 수 없습니다.

## 배포

남는 라즈베리파이 5 8GB에 서버·DB·이미지를 함께 두는 구성을 준비했습니다. [Pi 설치 안내](docs/RASPBERRY_PI.md)를 확인하세요.

[무료 배포 후보](docs/FREE_HOSTING.md)에 GitHub Pages와 클라우드 대안을 정리했습니다. `render.yaml`은 외부 MySQL 연결용 무료 서버 템플릿입니다. 영구 디스크가 없는 환경에서 이미지가 사라지지 않도록 새 이미지 업로드를 비활성화합니다. 외부 이미지 저장소 연동은 포함하지 않습니다.

Railway 운영 DB와 이미지는 GitHub 소스에 포함되지 않습니다. 기존 volume과 백업을 먼저 확인하고 이전하세요.

## 검증

```sh
cd web
npm ci --ignore-scripts
npm test
npm run check
npm audit --omit=dev
```

HTTP 보안·클라이언트 오류 처리 회귀 테스트는 임시 서버와 DB 대역을 사용하며 운영 데이터를 변경하지 않습니다. 별도로 임시 MySQL 8.4에서 과제 CRUD·반별 권한·제출 상태·공지·알림·외래키 삭제를 확인했고 Chromium에서 데스크톱·모바일 화면을 검증했습니다. 실제 학교 Google 로그인과 Pi 외부 HTTPS 운영은 해당 환경에서 확인해야 합니다.
