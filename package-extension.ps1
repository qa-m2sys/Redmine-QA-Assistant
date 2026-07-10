# Builds a clean, versioned ZIP of the Chrome extension for distribution.
# Users can download the ZIP, unzip it, and install via chrome://extensions
# -> Developer mode -> "Load unpacked". (Chrome blocks standalone .crx installs,
# so a ZIP + Load unpacked is the simplest way to share it outside the Web Store.)
#
# Usage (from the repo root):
#   powershell -ExecutionPolicy Bypass -File .\package-extension.ps1

$ErrorActionPreference = 'Stop'

$root       = $PSScriptRoot
$srcDir     = Join-Path $root 'chrome-extension'
$distDir    = Join-Path $root 'dist'
$manifest   = Join-Path $srcDir 'manifest.json'

if (-not (Test-Path $manifest)) {
    Write-Error "manifest.json not found at $manifest"
    exit 1
}

# Read name + version from the manifest so the ZIP is always named correctly.
$meta    = Get-Content $manifest -Raw | ConvertFrom-Json
$version = $meta.version
$slug    = ($meta.name -replace '[^A-Za-z0-9]+', '-').Trim('-').ToLower()

# Only the files the extension actually needs at runtime (skip dev tooling like
# generate-icons.ps1 and any non-generated source images in icons/).
$include = @(
    'manifest.json',
    'content.js',
    'content.css',
    'icons/icon16.png',
    'icons/icon48.png',
    'icons/icon128.png'
)

# Stage the files in a temp folder to control exactly what goes in the ZIP.
$stageDir = Join-Path $distDir "$slug-v$version"
if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

foreach ($rel in $include) {
    $srcPath = Join-Path $srcDir $rel
    if (-not (Test-Path $srcPath)) {
        Write-Error "Required file missing: $rel (looked in $srcPath)"
        exit 1
    }
    $destPath = Join-Path $stageDir $rel
    New-Item -ItemType Directory -Path (Split-Path $destPath -Parent) -Force | Out-Null
    Copy-Item $srcPath $destPath -Force
}

$zipPath = Join-Path $distDir "$slug-v$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $zipPath -Force

# Clean up the staging folder; keep only the ZIP.
Remove-Item $stageDir -Recurse -Force

Write-Host "Built $zipPath"
Write-Host "Share this ZIP. To install: unzip it, open chrome://extensions,"
Write-Host "enable Developer mode, then click 'Load unpacked' and pick the folder."
