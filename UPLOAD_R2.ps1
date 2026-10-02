param(
  [string]$Remote = "r2",
  [string]$Bucket = "epa-data"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "[ERROR] rclone is not installed." -ForegroundColor Red
  Write-Host "Install rclone, configure an R2 remote named 'r2', then rerun this script."
  exit 1
}

$ManifestPath = Join-Path $PSScriptRoot "R2_FILES.json"
$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json

if (-not $Manifest.files -or $Manifest.files.Count -eq 0) {
  Write-Host "No R2 files are required."
  exit 0
}

Write-Host "Uploading EPA large/raw data to R2..." -ForegroundColor Cyan

foreach ($item in $Manifest.files) {
  $src = $item.source
  $key = $item.r2_key
  $destParent = Split-Path $key -Parent

  if (-not (Test-Path $src)) {
    Write-Host "[SKIP] missing: $src" -ForegroundColor Yellow
    continue
  }

  if ([string]::IsNullOrWhiteSpace($destParent)) {
    $dest = "${Remote}:${Bucket}"
  } else {
    $dest = "${Remote}:${Bucket}/$destParent"
  }

  Write-Host "[UPLOAD] $src -> $dest/"
  & rclone copy $src $dest --progress --transfers 4 --checkers 8

  if ($LASTEXITCODE -ne 0) {
    throw "rclone upload failed: $src"
  }
}

Write-Host ""
Write-Host "R2 upload complete." -ForegroundColor Green
