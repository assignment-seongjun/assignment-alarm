# 과제 알리미 (Assignment Alarm)

과제 마감일을 관리하고 학급/학년 단위로 소통하는 웹 애플리케이션입니다.

## 기술 스택

- **Frontend**: HTML, CSS, Vanilla JavaScript
- **Backend**: Node.js + Express
- **Database**: MySQL 8.0
- **Auth**: JWT + bcrypt
- **Container**: Docker & Docker Compose

## 페이지 구성 (5페이지)

| 페이지 | 설명 |
|--------|------|
| `login.html` | 로그인 / 회원가입 |
| `calendar.html` | 날짜화면 — 과제 캘린더 + 완료 처리 |
| `register.html` | 과제 등록 및 내가 등록한 과제 관리 |
| `messages.html` | 학년 공지 / 반 알림장 메세지 |
| `settings.html` | 설정 — 프로필 변경, 알림 On/Off |

## 테이블 구성 (4개)

| 테이블 | 설명 |
|--------|------|
| `users` | 학생/교사 계정, 소속 학급, 프로필, 알림 설정 |
| `assignments` | 과제 제목/내용/마감일, 대상 학급 |
| `messages` | 발신자, 내용, 학년/반 타겟 메세지 |
| `user_assignments` | 학생별 과제 완료 상태 |

## 실행 방법

```bash
docker-compose up -d --build
open http://localhost:70
```

## 포트

- Web: 70
- MySQL: 3307
