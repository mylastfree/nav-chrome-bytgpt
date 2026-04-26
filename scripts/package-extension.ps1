$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$release = Join-Path $root 'release'
$unpacked = Join-Path $release 'nav-bygpt-chrome-extension-unpacked'
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$zipPath = Join-Path $release "nav-bygpt-chrome-extension-$stamp.zip"

Push-Location $root
try {
  npm run build

  if (-not (Test-Path -LiteralPath (Join-Path $dist 'manifest.json'))) {
    throw 'dist\manifest.json was not created. Check public\manifest.json.'
  }

  if (-not (Test-Path -LiteralPath (Join-Path $dist 'index.html'))) {
    throw 'dist\index.html was not created.'
  }

  if (Test-Path -LiteralPath (Join-Path $dist 'assets')) {
    throw 'dist\assets exists. Keep JS/CSS in the root for this project.'
  }

  if (-not (Test-Path -LiteralPath $release)) {
    New-Item -ItemType Directory -Path $release | Out-Null
  }

  $releasePath = (Resolve-Path -LiteralPath $release).Path

  if (Test-Path -LiteralPath $unpacked) {
    $unpackedPath = (Resolve-Path -LiteralPath $unpacked).Path
    if (-not $unpackedPath.StartsWith($releasePath, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove unexpected unpacked path: $unpackedPath"
    }
    Remove-Item -LiteralPath $unpackedPath -Recurse -Force
  }

  New-Item -ItemType Directory -Path $unpacked | Out-Null
  Copy-Item -Path (Join-Path $dist '*') -Destination $unpacked -Recurse -Force

  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }

  Compress-Archive -Path (Join-Path $unpacked '*') -DestinationPath $zipPath -Force

  $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath
  $hash.Hash | Set-Content -Path "$zipPath.sha256" -Encoding ASCII

  Write-Host "UNPACKED=$unpacked"
  Write-Host "ZIP=$zipPath"
  Write-Host "SHA256=$($hash.Hash)"
}
finally {
  Pop-Location
}
