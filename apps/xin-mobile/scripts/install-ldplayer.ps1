# Build + install Qchat Android dev client on LDPlayer (self-signed HTTPS trust).
# Bypasses Expo's fragile emulator-5558 AVD probe when needed.
$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not (Test-Path (Join-Path $PSScriptRoot "..\package.json"))) {
  $Root = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
  $Root = Resolve-Path (Join-Path $PSScriptRoot "..")
}
Set-Location $Root

$SdkAdb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $SdkAdb)) { $SdkAdb = "adb" }

$serial = "127.0.0.1:5559"
& $SdkAdb connect $serial | Out-Null
& $SdkAdb -s $serial wait-for-device
& $SdkAdb -s $serial reverse tcp:8081 tcp:8081 | Out-Null
$env:ANDROID_SERIAL = $serial

Write-Host "Installing to $serial ..."
npx expo run:android --device $serial --no-bundler
