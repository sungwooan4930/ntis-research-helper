# 국가R&D 과제 도우미

NTIS Open API와 OpenAI를 활용한 국가R&D 과제 신청 지원 웹서비스입니다.

## 주요 기능

1. **유사 과제 검색** - NTIS에 등록된 국가R&D 과제를 키워드로 검색
2. **과제 평가** - AI가 연구과제 내용을 항목별로 평가하고 개선점 제안
3. **신청서 평가·수정** - AI가 신청서의 강점/약점을 분석하고 수정본 제안

## 설치 방법

```bash
# 저장소 클론
git clone <repository-url>
cd ntis-research-helper

# 의존성 설치
npm install
```

## 환경변수 설정

`.env.example`을 복사하여 `.env` 파일을 생성하고 실제 키를 입력합니다.

```bash
cp .env.example .env
```

| 변수명 | 설명 |
|--------|------|
| `NTIS_API_KEY` | [NTIS 오픈API](https://www.ntis.go.kr/rndopen/openApi/apiList.do) 인증키 |
| `OPENAI_API_KEY` | [OpenAI](https://platform.openai.com/api-keys) API 키 |
| `PORT` | 서버 포트 (기본값: 3000) |

## 실행 방법

```bash
# 일반 실행
npm start

# 개발 모드 (파일 변경 시 자동 재시작)
npm run dev
```

브라우저에서 `http://localhost:3000` 으로 접속합니다.

## 배포 방법 (Render.com)

1. [Render](https://render.com)에 로그인 후 **New > Web Service** 선택
2. GitHub 저장소 연결
3. 설정:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. **Environment** 탭에서 환경변수 추가:
   - `NTIS_API_KEY`
   - `OPENAI_API_KEY`
   - `PORT` → `3000`
5. **Create Web Service** 클릭

## 기술 스택

- **백엔드**: Node.js + Express
- **프론트엔드**: HTML + CSS + Vanilla JS
- **외부 API**: NTIS Open API, OpenAI API (gpt-4o-mini)

## 라이선스

MIT
