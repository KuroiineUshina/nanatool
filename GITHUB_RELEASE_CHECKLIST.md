# GitHub 공개 배포 체크리스트

## 저장소를 만들기 전

- `dcinside-focus` 폴더의 내용만 새 저장소 루트에 둡니다. 상위 `DC` 폴더에는 다른 작업 파일이 있으므로 함께 올리지 않습니다.
- 배포 저장소 주소가 `https://github.com/KuroiineUshina/nanatool`이 아니라면 `README.md`, `PRIVACY.md`, `privacy.html`의 주소를 실제 저장소 주소로 바꿉니다.
- 제공받은 캐릭터 원본을 GitHub Release에 재배포할 권리가 있는지 확인합니다.
- 현재 본체에는 오픈소스 라이선스가 없습니다. 소스 재사용까지 허용하려면 공개 전에 `LICENSE`를 선택하고, 허용하지 않을 생각이면 현재 상태를 유지합니다.
- 저장소의 **Settings → Security → Private vulnerability reporting**을 켭니다.

## 공개 직전

1. `node --test tests/*.test.js`가 통과하는지 확인합니다.
2. `powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1`로 ZIP과 `.sha256`을 만듭니다.
3. `powershell -ExecutionPolicy Bypass -File scripts/verify-release.ps1`로 필수 파일·manifest·SHA-256을 확인합니다.
4. ZIP을 새 임시 폴더에 풀어 Chrome 개발자 모드에서 로드합니다.
5. 유동 필터, 말머리 설정, 게시물·이미지 북마크, 갤러리아, 전체 설정, 플로팅 버블을 한 번씩 확인합니다.

## 릴리스

- `manifest.json`의 버전과 같은 `v1.0.0` 형식의 태그를 푸시합니다.
- `.github/workflows/release.yml`이 테스트 후 ZIP과 체크섬을 GitHub Release에 첨부합니다.
- Windows·macOS Chrome 사용자는 ZIP을 압축 해제한 뒤 개발자 모드에서 `압축해제된 확장 프로그램을 로드`해야 합니다.
- GitHub ZIP 설치판은 자동 업데이트되지 않으므로 새 릴리스 설치 방법을 릴리스 노트에 계속 적습니다.
