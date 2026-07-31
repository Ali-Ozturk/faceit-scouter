Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
Set-Location $root

if (-not (Test-Path -LiteralPath ".env")) {
  Copy-Item -LiteralPath ".env.example" -Destination ".env"
  Write-Host "Created .env from .env.example"
} else {
  Write-Host ".env already exists"
}

$folders = @(
  "data/incoming",
  "data/processing",
  "data/completed",
  "data/failed",
  "data/decompressed",
  "data/temporary"
)

foreach ($folder in $folders) {
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
}

Write-Host "Data folders are ready"
Write-Host "Next: docker compose up -d --build"
