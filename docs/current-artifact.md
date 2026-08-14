# 현재 산출물 공유·버전 운영

## 공유 주소

- 산출물 허브: <https://omelette-archive.github.io/KIIP/>
- 최신 알파 대시보드: <https://omelette-archive.github.io/KIIP/latest/>
- 렌더링 가능한 버전 내역: <https://omelette-archive.github.io/KIIP/versions/>
- Git 원본 이력: <https://github.com/omelette-archive/KIIP/commits/main/07-dashboard/dashboard.html>
- 피드백: <https://github.com/omelette-archive/KIIP/issues/new?template=artifact-feedback.yml>

공유 대상은 현재 `07-dashboard/dashboard.html`이다. 이 파일은 스타일·스크립트·스냅샷 데이터를
포함한 단일 HTML이므로 별도 서버 기능 없이 정적 페이지로 열 수 있다.

## 자동 게시 흐름

1. `07-dashboard/dashboard.html`을 생성·수정한다.
2. 변경사항을 PR로 올리면 산출물 사이트 생성 검증을 실행한다.
3. PR이 `main`에 병합되면 `.github/workflows/publish-artifacts.yml`이 최신본을 Pages에 게시한다.
4. 게시 사이트의 `/latest/`는 새 HTML로 교체되고, `/versions/<commit>/`에는 과거 Git 버전이 유지된다.

Pages 사이트는 커밋을 별도 저장소에 복제하는 방식이 아니다. 배포 시 `dashboard.html`을 변경한
최근 Git 커밋에서 과거 HTML을 다시 꺼내 정적 사이트에 함께 싣는다. Git 이력이 원본 기록이며,
Pages 버전 목록은 이를 클릭 가능한 HTML로 보여 주는 읽기 전용 뷰다.

로컬에서 같은 사이트를 만들려면 다음을 실행한다.

```bash
node scripts/buildArtifactSite.js --output .artifact-site --limit 50
```

그 뒤 `.artifact-site/index.html`을 열어 허브·최신본·버전 링크를 확인할 수 있다.

## 버전 표기와 피드백

- 버전 ID는 `dashboard.html`을 변경한 Git 커밋의 앞 12자리다.
- 최신 페이지의 내용 자체는 원본 HTML과 바이트 단위로 동일하게 유지한다.
- 화면·수치·문구에 대한 의견은 산출물 피드백 이슈 양식에 페이지 주소와 버전 ID를 함께 남긴다.
- 의미 있는 알파 마일스톤은 필요할 때 GitHub Release와 태그를 추가해 별도 명칭을 부여할 수 있다.

## 알파 해석 주의

현재 HTML은 배포 전 검토 산출물이다. 스냅샷 내부의 `pipelineStatus`, `warnings`, 지표별
`availability`와 `blockingIssue`가 해석 기준이다. 수집이 부분 완료된 값과 지역 귀속이 검증되지
않은 값은 공식 통계로 인용하지 않는다.
