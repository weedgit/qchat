# Build a preview APK for sideloading on a real Android phone.
param(
  [string]$ApiUrl = "https://rchat.boostbunny.io",
  [string]$LivekitUrl = "wss://rchat.boostbunny.io:7443",
  [string]$OutName = "qchat-mobile-preview.apk"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (-not (Test-Path $sdk)) {
  throw "Android SDK not found at $sdk. Install Android Studio first."
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = $sdk }
# Keep Gradle caches on a short path (Windows MAX_PATH during native builds).
if (-not $env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = "C:\gradle-cache" }
New-Item -ItemType Directory -Force -Path $env:GRADLE_USER_HOME | Out-Null

$env:APP_ENV = "preview"
$env:EAS_BUILD_PROFILE = "preview"
$env:EXPO_PUBLIC_API_URL = $ApiUrl.TrimEnd("/")
$env:EXPO_PUBLIC_LIVEKIT_URL = $LivekitUrl.TrimEnd("/")
$env:QCHAT_TRUST_CERT = "0"
$env:QCHAT_ALLOW_CLEARTEXT = "0"

Write-Host "==> Rchat preview APK"
Write-Host "    API:     $env:EXPO_PUBLIC_API_URL"
Write-Host "    LiveKit: $env:EXPO_PUBLIC_LIVEKIT_URL"

if (-not (Test-Path "node_modules")) {
  npm install
}

npx expo prebuild --platform android --clean

Push-Location android
try {
  .\gradlew.bat assembleRelease --no-daemon
} finally {
  Pop-Location
}

$apk = Get-ChildItem -Path "android\app\build\outputs\apk\release" -Filter "*.apk" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $apk) {
  throw "Release APK not found under android\app\build\outputs\apk\release"
}

$outDir = Join-Path $Root "dist"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$dest = Join-Path $outDir $OutName
Copy-Item $apk.FullName $dest -Force
Write-Host ""
Write-Host "APK ready: $dest"
Write-Host "Size: $([math]::Round($apk.Length / 1MB, 1)) MB"
