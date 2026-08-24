param(
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDirectory ".."))
$manifestPath = Join-Path $projectRoot "manifest.json"
$fileListPath = Join-Path $projectRoot "release-files.txt"
$iconDataPath = Join-Path $projectRoot "assets/icons/nanatool-icons.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$iconData = Get-Content -LiteralPath $iconDataPath -Raw | ConvertFrom-Json
$version = [string]$manifest.version

if ($version -notmatch '^\d+\.\d+\.\d+$') {
  throw "manifest.json 버전이 올바른 SemVer 형식이 아닙니다: $version"
}

if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $projectRoot "dist"
}

$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$volumeRoot = [System.IO.Path]::GetPathRoot($outputRoot)
if ($outputRoot -eq $volumeRoot) {
  throw "드라이브 루트는 출력 경로로 사용할 수 없습니다: $outputRoot"
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$archivePath = Join-Path $outputRoot "nanatool-v$version.zip"
$checksumPath = Join-Path $outputRoot "nanatool-v$version.sha256"

if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}

$releaseFiles = Get-Content -LiteralPath $fileListPath |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ -and -not $_.StartsWith("#") }

$iconPaths = [ordered]@{
  "16" = "assets/icons/nanatool-16.png"
  "32" = "assets/icons/nanatool-32.png"
  "48" = "assets/icons/nanatool-48.png"
  "128" = "assets/icons/nanatool-128.png"
}
$manifest | Add-Member -NotePropertyName icons -NotePropertyValue ([pscustomobject]$iconPaths) -Force
$manifest.action | Add-Member -NotePropertyName default_icon -NotePropertyValue ([pscustomobject]$iconPaths) -Force
$manifestJson = $manifest | ConvertTo-Json -Depth 20
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Add-TextEntry {
  param($Archive, [string]$Name, [string]$Value)
  $entry = $Archive.CreateEntry($Name, [System.IO.Compression.CompressionLevel]::Optimal)
  $stream = $entry.Open()
  try {
    $bytes = $utf8NoBom.GetBytes($Value)
    $stream.Write($bytes, 0, $bytes.Length)
  } finally {
    $stream.Dispose()
  }
}

function Add-BytesEntry {
  param($Archive, [string]$Name, [byte[]]$Value)
  $entry = $Archive.CreateEntry($Name, [System.IO.Compression.CompressionLevel]::Optimal)
  $stream = $entry.Open()
  try {
    $stream.Write($Value, 0, $Value.Length)
  } finally {
    $stream.Dispose()
  }
}

function Assert-PngDimensions {
  param(
    [byte[]]$Bytes,
    [int]$Width,
    [int]$Height,
    [string]$Label
  )
  $signature = [byte[]](137, 80, 78, 71, 13, 10, 26, 10)
  if ($Bytes.Length -lt 24) {
    throw "$Label PNG 데이터가 너무 짧습니다."
  }
  for ($index = 0; $index -lt $signature.Length; $index += 1) {
    if ($Bytes[$index] -ne $signature[$index]) {
      throw "$Label 파일이 PNG 형식이 아닙니다."
    }
  }
  $actualWidth =
    (([int]$Bytes[16]) -shl 24) -bor
    (([int]$Bytes[17]) -shl 16) -bor
    (([int]$Bytes[18]) -shl 8) -bor
    ([int]$Bytes[19])
  $actualHeight =
    (([int]$Bytes[20]) -shl 24) -bor
    (([int]$Bytes[21]) -shl 16) -bor
    (([int]$Bytes[22]) -shl 8) -bor
    ([int]$Bytes[23])
  if ($actualWidth -ne $Width -or $actualHeight -ne $Height) {
    throw "$Label 크기가 ${Width}x${Height}이 아닙니다: ${actualWidth}x${actualHeight}"
  }
}

$iconBytes = [ordered]@{}
foreach ($size in 16, 32, 48, 128) {
  $encoded = [string]$iconData.PSObject.Properties[[string]$size].Value
  if (-not $encoded) {
    throw "아이콘 원본 데이터가 없습니다: ${size}px"
  }
  $bytes = [Convert]::FromBase64String($encoded)
  Assert-PngDimensions -Bytes $bytes -Width $size -Height $size -Label "${size}px 아이콘"
  $iconBytes[[string]$size] = $bytes
}

$archive = [System.IO.Compression.ZipFile]::Open(
  $archivePath,
  [System.IO.Compression.ZipArchiveMode]::Create
)
try {
  foreach ($relativePath in $releaseFiles) {
    if ($relativePath -eq "manifest.json") {
      Add-TextEntry -Archive $archive -Name "manifest.json" -Value $manifestJson
      continue
    }
    $sourcePath = Join-Path $projectRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      throw "릴리스 파일을 찾을 수 없습니다: $relativePath"
    }
    $entryName = $relativePath.Replace("\", "/")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      $sourcePath,
      $entryName,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
  foreach ($size in 16, 32, 48, 128) {
    Add-BytesEntry -Archive $archive -Name $iconPaths[[string]$size] -Value $iconBytes[[string]$size]
  }
} finally {
  $archive.Dispose()
}

$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumLine = "$archiveHash  $([System.IO.Path]::GetFileName($archivePath))`n"
[System.IO.File]::WriteAllText($checksumPath, $checksumLine, $utf8NoBom)

Write-Output $archivePath
Write-Output $checksumPath
