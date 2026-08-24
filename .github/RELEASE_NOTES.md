# 설치

1. 릴리스 자산의 `nanatool-v*.zip`을 내려받아 원하는 고정 폴더에 압축을 풉니다.
2. Chrome의 `chrome://extensions` 또는 Edge의 `edge://extensions`를 엽니다.
3. 개발자 모드를 켜고 **압축해제된 확장 프로그램을 로드**한 뒤 압축을 푼 폴더를 선택합니다.

GitHub ZIP 설치는 자동 업데이트되지 않습니다. 나나툴이 새 정식 릴리스를 확인하면 화면의 수동 업데이트 버튼과 툴바 `UP` 배지가 나타납니다. 버튼은 이 Release 페이지를 새 탭으로 열기만 합니다. 새 ZIP을 같은 폴더에 덮어쓴 뒤 확장프로그램 카드의 새로고침 버튼을 눌러 적용합니다.

# 무결성 확인

함께 배포된 `.sha256` 파일의 값과 ZIP의 SHA-256이 같은지 확인할 수 있습니다.

```powershell
Get-FileHash .\nanatool-v*.zip -Algorithm SHA256
```

나나툴은 디시인사이드의 공식 확장프로그램이 아닙니다.
