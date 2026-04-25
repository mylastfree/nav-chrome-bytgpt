$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$release = Join-Path $root 'release'
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$zipPath = Join-Path $release "cf-startpage-direct-upload-$stamp.zip"

Push-Location $root
try {
  npm run build

  if (-not (Test-Path -LiteralPath (Join-Path $dist '_worker.js'))) {
    throw 'dist\_worker.js was not created. Check public\_worker.js.'
  }

  if (-not (Test-Path -LiteralPath $release)) {
    New-Item -ItemType Directory -Path $release | Out-Null
  }

  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }

  Compress-Archive -Path (Join-Path $dist '*') -DestinationPath $zipPath -Force

  $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath
  $hash.Hash | Set-Content -Path "$zipPath.sha256" -Encoding ASCII

  Write-Host "ZIP=$zipPath"
  Write-Host "SHA256=$($hash.Hash)"
}
finally {
  Pop-Location
}
