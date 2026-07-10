# Generates Chrome extension icons (16/48/128 px) from a source image in icons/.
# Auto-crops surrounding whitespace so the artwork fills the icon, then centers
# it (aspect-preserved) on a transparent square canvas.
#
# Usage (from the chrome-extension folder):
#   powershell -ExecutionPolicy Bypass -File .\generate-icons.ps1 [-Source icons\your-image.png]
param(
    [string]$Source
)

Add-Type -AssemblyName System.Drawing

$iconsDir = Join-Path $PSScriptRoot 'icons'

if (-not $Source) {
    # Pick the first PNG in icons/ that isn't a generated icon.
    $candidate = Get-ChildItem -Path $iconsDir -Filter *.png |
        Where-Object { $_.Name -notmatch '^icon(16|48|128)\.png$' } |
        Select-Object -First 1
    if (-not $candidate) {
        Write-Error "No source image found in $iconsDir. Pass -Source <path>."
        exit 1
    }
    $Source = $candidate.FullName
} elseif (-not [System.IO.Path]::IsPathRooted($Source)) {
    $Source = Join-Path $PSScriptRoot $Source
}

if (-not (Test-Path $Source)) {
    Write-Error "Source image not found: $Source"
    exit 1
}

$src = New-Object System.Drawing.Bitmap($Source)
$w = $src.Width; $h = $src.Height

# Find the bounding box of non-white, non-transparent pixels.
$minX = $w; $minY = $h; $maxX = 0; $maxY = 0
for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
        $p = $src.GetPixel($x, $y)
        if ($p.A -gt 15 -and -not ($p.R -gt 244 -and $p.G -gt 244 -and $p.B -gt 244)) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}
if ($maxX -lt $minX) { $minX = 0; $minY = 0; $maxX = $w - 1; $maxY = $h - 1 }

$bw = $maxX - $minX + 1
$bh = $maxY - $minY + 1
$pad = [int]([Math]::Max($bw, $bh) * 0.06)
$cx = [Math]::Max(0, $minX - $pad)
$cy = [Math]::Max(0, $minY - $pad)
$cw = [Math]::Min($w - $cx, $bw + 2 * $pad)
$ch = [Math]::Min($h - $cy, $bh + 2 * $pad)

$cropRect = New-Object System.Drawing.Rectangle $cx, $cy, $cw, $ch
$crop = $src.Clone($cropRect, $src.PixelFormat)

foreach ($size in 16, 48, 128) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $gfx.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $gfx.Clear([System.Drawing.Color]::Transparent)

    $scale = [Math]::Min($size / $crop.Width, $size / $crop.Height)
    $dw = [int]([Math]::Round($crop.Width * $scale))
    $dh = [int]([Math]::Round($crop.Height * $scale))
    $dx = [int](($size - $dw) / 2)
    $dy = [int](($size - $dh) / 2)
    $gfx.DrawImage($crop, $dx, $dy, $dw, $dh)

    $outPath = Join-Path $iconsDir ("icon{0}.png" -f $size)
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $gfx.Dispose()
    $bmp.Dispose()
    Write-Host "Wrote $outPath ($dw x $dh)"
}

$crop.Dispose()
$src.Dispose()
Write-Host "Done."
