param(
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDirectory ".."))
$sourceManifest = Get-Content -LiteralPath (Join-Path $projectRoot "manifest.json") -Raw |
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

$checksumSource = Get-Content -LiteralPath $checksumPath -Raw
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

$requiredEntries = @(
  Get-Content -LiteralPath (Join-Path $projectRoot "release-files.txt") |
    ForEach-Object { $_.Trim().Replace("\", "/") } |
    Where-Object { $_ -and -not $_.StartsWith("#") }
)
$requiredEntries += @(
  "assets/icons/nanatool-16.png",
  "assets/icons/nanatool-32.png",
  "assets/icons/nanatool-48.png",
  "assets/icons/nanatool-128.png"
)

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
  foreach ($requiredEntry in $requiredEntries) {
    if ($entryNames -notcontains $requiredEntry) {
      throw "릴리스 ZIP에 필수 파일이 없습니다: $requiredEntry"
    }
  }
  if ($entryNames -contains "STORE_LISTING.md" -or $entryNames -match "^assets/store/") {
    throw "GitHub 배포판에 사용하지 않는 웹스토어 자료가 포함됐습니다."
  }

  $manifestEntry = $archive.GetEntry("manifest.json")
  if (-not $manifestEntry) {
    throw "릴리스 manifest.json을 찾을 수 없습니다."
  }
  $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
  try {
    $packagedManifest = $reader.ReadToEnd() | ConvertFrom-Json
  } finally {
    $reader.Dispose()
  }
  if ([string]$packagedManifest.version -ne $version) {
    throw "릴리스 manifest 버전이 원본과 다릅니다."
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
} finally {
  $archive.Dispose()
}

Write-Output "릴리스 ZIP·manifest·SHA-256 검증 통과"
Write-Output $archivePath
Write-Output $actualHash
