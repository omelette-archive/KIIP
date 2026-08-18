# 현재 산출물 공유·버전 운영

## 공유 주소

- 산출물 허브: <https://omelette-archive.github.io/KIIP-artifacts/>
- 최신 대시보드: <https://omelette-archive.github.io/KIIP-artifacts/latest/>
- 렌더링 가능한 버전 내역: <https://omelette-archive.github.io/KIIP-artifacts/versions/>
- 공개 게시 저장소: <https://github.com/omelette-archive/KIIP-artifacts>
- Git 원본 이력: <https://github.com/omelette-archive/KIIP/commits/main/07-dashboard/dashboard.html>
- 피드백 댓글: <https://github.com/omelette-archive/KIIP/issues/76>

공유 대상은 현재 `07-dashboard/dashboard.html`이다. 이 파일은 스타일·스크립트·스냅샷 데이터를
포함한 단일 HTML이므로 별도 서버 기능 없이 정적 페이지로 열 수 있다.

## 자동 게시 흐름

1. `07-dashboard/dashboard.html`을 생성·수정한다.
2. 변경사항을 PR로 올리면 산출물 사이트 생성 검증을 실행한다.
3. PR이 `main`에 병합되면 `.github/workflows/publish-artifacts.yml`이 공개 전용 저장소
   `omelette-archive/KIIP-artifacts`에 정적 사이트만 동기화한다.
4. 게시 사이트의 `/latest/`는 새 HTML로 교체되고, `/versions/<commit>/`에는 과거 Git 버전이 유지된다.

원본 `KIIP` 저장소는 비공개로 유지한다. 공개 전용 저장소에는 생성된 정적 사이트만 들어가며,
원본 파이프라인 코드·수집 파일·비밀값은 게시하지 않는다. 배포 시 `dashboard.html`을 변경한 최근
Git 커밋에서 과거 HTML을 다시 꺼내 정적 사이트에 함께 싣는다. 원본 Git 이력이 기준 기록이며,
Pages 버전 목록은 이를 클릭 가능한 HTML로 보여 주는 읽기 전용 뷰다.

두 저장소 사이는 공개 저장소에만 쓰기 권한이 있는 deploy key로 연결한다. 비공개 원본 저장소의
Actions secret `ARTIFACT_PUBLISH_KEY_B64`에 개인키를 base64로 보관하고, 실행 시에만 Linux
러너의 임시 SSH 파일로 복원한다. 공개 저장소에는 대응하는 공개키만 등록하며, 이 키는
`KIIP-artifacts` 외의 저장소에는 접근할 수 없다.

로컬에서 같은 사이트를 만들려면 다음을 실행한다.

```bash
node scripts/buildArtifactSite.js --output .artifact-site --limit 50
```

그 뒤 `.artifact-site/index.html`을 열어 허브·최신본·버전 링크를 확인할 수 있다.

## 버전 표기와 피드백

- 버전 ID는 `dashboard.html`을 변경한 Git 커밋의 앞 12자리다.
- 최신 페이지의 내용 자체는 원본 HTML과 바이트 단위로 동일하게 유지한다.
- 화면·수치·문구에 대한 의견은 고정 피드백 이슈 #76에 댓글로 남긴다. 별도 언급이 없으면
  댓글 작성 시점의 최신 공개본에 대한 의견으로 보며, 과거 버전에 관한 의견일 때만 버전을 적는다.
- 의미 있는 공개 마일스톤은 필요할 때 GitHub Release와 태그를 추가해 별도 명칭을 부여할 수 있다.

## 데이터 해석 주의

현재 HTML은 알파 테스트 기반의 공개 검토 산출물이다. 스냅샷 내부의 `pipelineStatus`, `warnings`, 지표별
`availability`와 `blockingIssue`가 해석 기준이다. 수집이 부분 완료된 값과 지역 귀속이 검증되지
않은 값은 공식 통계로 인용하지 않는다.
