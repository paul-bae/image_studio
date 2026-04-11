# CLAUDE.md — Prototype-05 프로젝트

## 프로젝트 개요

멀티 에이전트 기반 개발 환경. 7개의 전문 에이전트가 역할별로 협업하여 개발 작업을 수행한다.

---

## 개발 에이전트 구성

| 역할 | 에이전트 ID | 색상 |
|------|------------|------|
| 기획 관리자 | `product-planning-manager` | Red |
| 백엔드 개발자 | `backend-architect` | Blue |
| 프런트엔드 개발자 | `frontend-developer` | Green |
| 품질 보증 엔지니어 | `qa-engineer` | Yellow |
| 통합 전문가 | `llm-integration-specialist` | Purple |
| 최적화 전문가 | `perf-optimization-engineer` | Orange |
| UX 디자이너 | `ux-designer` | Cyan |

### 각 에이전트 역할 요약

- **product-planning-manager** : PRD 작성, 전체 개발 일정 관리, 제품 목표·기능·사용자 요구사항 정의
- **backend-architect** : 서버 아키텍처 설계, API 개발, 데이터 처리, 외부 서비스 통합, 보안·성능 최적화
- **frontend-developer** : UI 설계·구현, 반응형 디자인, 웹 접근성, 클라이언트 성능 최적화
- **qa-engineer** : 기능 테스트, 에러 처리 검증, 코드 리뷰, 사용성 개선 제안
- **llm-integration-specialist** : OpenRouter API 연동, LLM 통합, 프롬프트 최적화, AI 파이프라인 구축
- **perf-optimization-engineer** : 병목 지점 탐지·해결, 애플리케이션 속도 개선
- **ux-designer** : 화면 디자인, 버튼 배치, 에러 메시지 개선 (밝고 트렌디한 스타일, 좌:우 = 40%:60%)

---

## 환경 변수

OpenRouter API 키는 `OpenRouterAPI.env` 파일에 저장되어 있다.

```
파일: OpenRouterAPI.env
변수명: OPENROUTER_API_KEY
```

**주의:** API 키를 코드에 직접 하드코딩하지 않는다. 항상 환경 변수 파일에서 로드한다.

---

## MCP 서버 구성

| MCP | 용도 |
|-----|------|
| `github` | 프로젝트 버전 관리, GitHub 저장소 자동 업로드 |
| `supabase` | 클라우드 DB 저장 |
| `playwright` | 웹 브라우저 자동화, UI 테스트 |
| `context7` | 최신 문서 참조 |
| `notion` | 문서 저장, 업데이트 사항 기록 |
| `sequential-thinking` | 복잡한 추론 단계 처리 |

MCP 목록 확인: `claude mcp list`

---

## 배포

**Vercel** 사용. GitHub 저장소에 푸시하면 자동 빌드·배포.

---

## UX 가이드라인

- 화면 스타일: 밝고, 트렌디하고, 산뜻한 디자인
- 레이아웃 비율: 왼쪽 40% / 오른쪽 60%

---

## 주의사항

- `OpenRouterAPI.env` 파일은 절대 git에 커밋하지 않는다.
- API 키 등 민감 정보는 환경 변수 파일로만 관리한다.
