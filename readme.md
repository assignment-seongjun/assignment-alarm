# 과제 알리미 (Assignment Alarm)

과제 마감일을 관리하고 학급/학년 단위로 소통하는 웹 애플리케이션입니다.

현재 기준 주요 동작:
- 이름 + 비밀번호 기반 로그인 / 회원가입
- 회원가입 시 입력한 학년/반 기준으로만 과제/메세지 범위 적용
- 학년 메세지 / 반 메세지 분리 조회
- 헤더 알림 버튼에서 최근 과제/메세지 확인
- 과제/메세지 렌더링 시 HTML 이스케이프 처리

## 기술 스택

- **Frontend**: HTML, CSS, Vanilla JavaScript
- **Backend**: Node.js + Express
- **Database**: MySQL 8.0
- **Auth**: JWT + bcrypt
- **Container**: Docker & Docker Compose
- **Deploy**: Railway

## 페이지 구성 (5페이지)

| 페이지 | 설명 |
|--------|------|
| `login.html` | 이름 기반 로그인 / 회원가입 |
| `calendar.html` | 날짜화면 — 과제 캘린더 + 완료 처리 |
| `register.html` | 과제 등록 및 내가 등록한 과제 관리 |
| `messages.html` | 학년 공지 / 반 알림장 메세지 |
| `settings.html` | 설정 — 프로필 변경, 알림 On/Off |

## 테이블 구성 (4개)

| 테이블 | 설명 |
|--------|------|
| `users` | 이름, 비밀번호, 소속 학급, 프로필, 알림 설정 |
| `assignments` | 과제 제목/내용/마감일, 대상 학년/반 |
| `messages` | 발신자, 내용, 학년/반 타겟 메세지 |
| `user_assignments` | 학생별 과제 완료 상태 |

## 주요 규칙

- 과제 등록은 로그인한 사용자의 학년/반에만 등록됩니다.
- 반 메세지는 같은 반에서만 보입니다.
- 학년 메세지는 같은 학년에서만 보입니다.
- 사용자는 본인이 작성한 과제/메세지만 삭제할 수 있습니다.

## 배포 사용

- Railway 배포 주소로 접속합니다.
- 이름 + 비밀번호로 회원가입 또는 로그인 후 사용합니다.
- 로그인 후 과제 등록, 메세지, 알림 기능을 사용할 수 있습니다.

## 로컬 개발 실행 방법

```bash
docker-compose up -d --build
open http://localhost:3000
```

## Railway 배포 메모

- Web 서비스와 MySQL 서비스를 함께 사용합니다.
- 서버 시작 시 기본 스키마를 자동 생성합니다.
- 기존 `users.email` 컬럼이 남아 있으면 서버 시작 시 자동으로 제거됩니다.
- 현재 인증은 이메일이 아니라 `name` 기준입니다.

## 포트

- Web: 3000
- MySQL: 3307
