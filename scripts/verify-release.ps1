param(
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDirectory ".."))
# Windows PowerShell 5.1은 BOM 없는 UTF-8을 시스템 코드 페이지로 읽으므로 인코딩을 명시한다.
$sourceManifest = Get-Content -LiteralPath (Join-Path $projectRoot "manifest.json") -Raw -Encoding UTF8 |
  ConvertFrom-Json
$version = [string]$sourceManifest.version

if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $projectRoot "dist"
}

$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$archivePath = Join-Path $outputRoot "nanatool-v$version.zip"
$checksumPath = Join-Path $outputRoot "nanatool-v$version.sha256"

if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
  throw "릴리스 ZIP을 찾을 수 없습니다: $archivePath"
}
if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
  throw "릴리스 체크섬을 찾을 수 없습니다: $checksumPath"
}

$checksumSource = Get-Content -LiteralPath $checksumPath -Raw -Encoding UTF8
$checksumMatch = [regex]::Match(
  $checksumSource,
  "^(?<hash>[a-f0-9]{64})\s+nanatool-v$([regex]::Escape($version))\.zip\s*$",
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)
if (-not $checksumMatch.Success) {
  throw "체크섬 파일 형식이 올바르지 않습니다: $checksumPath"
}

$expectedHash = $checksumMatch.Groups["hash"].Value.ToLowerInvariant()
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expectedHash -ne $actualHash) {
  throw "릴리스 ZIP의 SHA-256이 체크섬 파일과 다릅니다."
}

$requiredEntries = [System.Collections.Generic.List[string]]::new()
$requiredSources = @{}

function Add-RequiredEntry {
  param([string]$Path, [string]$Source)
  if (-not $Path) { return }
  $normalized = $Path.Trim().Replace("\", "/")
  while ($normalized.StartsWith("./")) { $normalized = $normalized.Substring(2) }
  if (-not $normalized -or $normalized.Contains("*")) { return }
  if (-not $requiredEntries.Contains($normalized)) {
    $requiredEntries.Add($normalized)
    $requiredSources[$normalized] = $Source
  }
}

function Resolve-PackageReference {
  param([string]$BaseEntry, [string]$Reference)
  $value = [System.Net.WebUtility]::HtmlDecode($Reference.Trim())
  if (-not $value) { return $null }
  # 외부 주소, 프로토콜 상대 주소, data:, 페이지 내부 앵커는 패키지 파일이 아니다.
  if ($value -match '^[a-z][a-z0-9+.-]*:' -or $value.StartsWith("//") -or $value.StartsWith("#")) {
    return $null
  }
  $value = ($value -split '[?#]', 2)[0]
  if (-not $value) { return $null }
  if ($value.StartsWith("/")) {
    $segments = @()
  } else {
    $baseDirectory = ""
    $slash = $BaseEntry.LastIndexOf("/")
    if ($slash -ge 0) { $baseDirectory = $BaseEntry.Substring(0, $slash) }
    $segments = @($baseDirectory.Split("/") | Where-Object { $_ })
  }
  foreach ($segment in $value.Split("/")) {
    if (-not $segment -or $segment -eq ".") { continue }
    if ($segment -eq "..") {
      if ($segments.Count -eq 0) { throw "$BaseEntry 가 패키지 밖 경로를 참조합니다: $Reference" }
      $segments = @($segments | Select-Object -First ($segments.Count - 1))
      continue
    }
    $segments += [System.Uri]::UnescapeDataString($segment)
  }
  return ($segments -join "/")
}

function Read-ArchiveText {
  param($Archive, [string]$Name)
  $entry = $Archive.GetEntry($Name)
  if (-not $entry) { return $null }
  $reader = [System.IO.StreamReader]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
  try {
    return $reader.ReadToEnd()
  } finally {
    $reader.Dispose()
  }
}

foreach ($line in @(Get-Content -LiteralPath (Join-Path $projectRoot "release-files.txt") -Encoding UTF8)) {
  $item = $line.Trim().TrimStart([char]0xFEFF)
  if ($item -and -not $item.StartsWith("#")) {
    Add-RequiredEntry -Path $item -Source "release-files.txt"
  }
}
foreach ($size in 16, 32, 48, 128) {
  Add-RequiredEntry -Path "assets/icons/nanatool-$size.png" -Source "빌드 아이콘"
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $entryNames = @($archive.Entries | ForEach-Object { $_.FullName })
  $duplicates = @(
    $entryNames | Group-Object | Where-Object Count -gt 1 | ForEach-Object Name
  )
  if ($duplicates.Count) {
    throw "릴리스 ZIP에 중복 경로가 있습니다: $($duplicates -join ', ')"
  }
  foreach ($entryName in $entryNames) {
    if (
      $entryName.StartsWith("/") -or
      $entryName.Contains("\") -or
      @($entryName.Split("/")).Contains("..")
    ) {
      throw "릴리스 ZIP에 안전하지 않은 경로가 있습니다: $entryName"
    }
  }
  if ($entryNames -contains "STORE_LISTING.md" -or $entryNames -match "^assets/store/") {
    throw "GitHub 배포판에 사용하지 않는 웹스토어 자료가 포함됐습니다."
  }

  $manifestText = Read-ArchiveText -Archive $archive -Name "manifest.json"
  if ($null -eq $manifestText) {
    throw "릴리스 manifest.json을 찾을 수 없습니다."
  }
  $packagedManifest = $manifestText | ConvertFrom-Json
  if ([string]$packagedManifest.version -ne $version) {
    throw "릴리스 manifest 버전이 원본과 다릅니다."
  }
  if ([string]$packagedManifest.name -ne [string]$sourceManifest.name) {
    throw "릴리스 manifest 이름이 원본과 다릅니다(인코딩 확인 필요): $($packagedManifest.name)"
  }
  foreach ($size in 16, 32, 48, 128) {
    $path = "assets/icons/nanatool-$size.png"
    if (
      [string]$packagedManifest.icons.PSObject.Properties[[string]$size].Value -ne $path -or
      [string]$packagedManifest.action.default_icon.PSObject.Properties[[string]$size].Value -ne $path
    ) {
      throw "릴리스 manifest의 ${size}px 아이콘 경로가 올바르지 않습니다."
    }
  }

  # manifest가 가리키는 파일
  foreach ($script in @($packagedManifest.content_scripts)) {
    foreach ($file in @($script.js)) { Add-RequiredEntry -Path ([string]$file) -Source "manifest content_scripts.js" }
    foreach ($file in @($script.css)) { Add-RequiredEntry -Path ([string]$file) -Source "manifest content_scripts.css" }
  }
  $serviceWorker = [string]$packagedManifest.background.service_worker
  Add-RequiredEntry -Path $serviceWorker -Source "manifest background.service_worker"
  Add-RequiredEntry -Path ([string]$packagedManifest.action.default_popup) -Source "manifest action.default_popup"
  Add-RequiredEntry -Path ([string]$packagedManifest.options_ui.page) -Source "manifest options_ui.page"
  Add-RequiredEntry -Path ([string]$packagedManifest.options_page) -Source "manifest options_page"
  foreach ($iconSet in @($packagedManifest.icons, $packagedManifest.action.default_icon)) {
    if ($null -eq $iconSet) { continue }
    foreach ($property in $iconSet.PSObject.Properties) {
      Add-RequiredEntry -Path ([string]$property.Value) -Source "manifest icons"
    }
  }
  foreach ($resourceGroup in @($packagedManifest.web_accessible_resources)) {
    foreach ($resource in @($resourceGroup.resources)) {
      Add-RequiredEntry -Path ([string]$resource) -Source "manifest web_accessible_resources"
    }
  }

  # 서비스 워커의 importScripts 대상
  if ($serviceWorker) {
    $workerText = Read-ArchiveText -Archive $archive -Name $serviceWorker
    if ($null -ne $workerText) {
      foreach ($call in [regex]::Matches($workerText, 'importScripts\(([^)]*)\)')) {
        foreach ($literal in [regex]::Matches($call.Groups[1].Value, '["'']([^"'']+)["'']')) {
          $resolved = Resolve-PackageReference -BaseEntry $serviceWorker -Reference $literal.Groups[1].Value
          Add-RequiredEntry -Path $resolved -Source "$serviceWorker importScripts"
        }
      }
    }
  }

  # 배포되는 HTML의 <script src>, <link href>
  foreach ($htmlEntry in @($entryNames | Where-Object { $_ -match '\.html?$' })) {
    $html = Read-ArchiveText -Archive $archive -Name $htmlEntry
    $patterns = @(
      '<script\b[^>]*?\bsrc\s*=\s*["'']([^"'']+)["'']',
      '<link\b[^>]*?\bhref\s*=\s*["'']([^"'']+)["'']'
    )
    foreach ($pattern in $patterns) {
      $options = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
      foreach ($match in [regex]::Matches($html, $pattern, $options)) {
        $resolved = Resolve-PackageReference -BaseEntry $htmlEntry -Reference $match.Groups[1].Value
        Add-RequiredEntry -Path $resolved -Source $htmlEntry
      }
    }
  }

  $missing = @(
    $requiredEntries | Where-Object { $entryNames -notcontains $_ } |
      ForEach-Object { "$_ ($($requiredSources[$_]))" }
  )
  if ($missing.Count) {
    throw "릴리스 ZIP에 필수 파일이 없습니다: $($missing -join ', ')"
  }
} finally {
  $archive.Dispose()
}

Write-Output "릴리스 ZIP·manifest·HTML 참조·SHA-256 검증 통과 (필수 파일 $($requiredEntries.Count)개)"
Write-Output $archivePath
Write-Output $actualHash
