# LDPlayer: prefer 127.0.0.1:5559 (Expo breaks on ghost emulator-5558).
$Adb = "C:\LDPlayer\LDPlayer9\adb.exe"
if (-not (Test-Path $Adb)) {
  $Adb = "D:\LDPlayer123\LDPlayer9\adb.exe"
}
if (-not (Test-Path $Adb)) {
  throw "adb.exe not found under LDPlayer installs"
}

$serial = "127.0.0.1:5559"

function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & $Adb @Args 2>&1 | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) {
      $_.Exception.Message
    } else {
      "$_"
    }
  }
}

Invoke-Adb start-server | Out-Null
Invoke-Adb connect $serial | Out-Null

# Drop ghost serial if present (ignore "no such device")
$devices = @(Invoke-Adb devices)
if ($devices -match "emulator-5558") {
  Invoke-Adb disconnect emulator-5558 | Out-Null
}

Invoke-Adb -s $serial wait-for-device | Out-Null
Invoke-Adb -s $serial reverse tcp:8081 tcp:8081 | Out-Null

$env:ANDROID_SERIAL = $serial
Write-Host "ANDROID_SERIAL=$serial"
Invoke-Adb devices -l
Write-Host ""
Write-Host "Next: npx expo run:android --device $serial"
Write-Host "  or: npx expo start --dev-client  (open Qchat app; do not press a)"
