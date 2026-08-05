<#
  verify-signing.ps1  —  Windows-native check for the APK signing failure.

  Diagnoses:
    "Failed to obtain key with alias 'warehousewizard' ... Wrong password?
     ... BadPaddingException: Given final block not properly padded."

  That error means the STORE password is correct but the KEY password is
  being rejected. This script proves which key password actually unlocks the
  private key, so you know exactly what to set ANDROID_KEY_PASSWORD to.

  HOW TO RUN (no Git Bash needed):
    1. Press Start, type "PowerShell", open it.
    2. Paste this and press Enter:
         powershell -ExecutionPolicy Bypass -File "C:\classicitbb\threeplmgmt\android-twa\scripts\verify-signing.ps1"
    3. If it can't auto-find your keystore, re-run with its path:
         powershell -ExecutionPolicy Bypass -File "C:\classicitbb\threeplmgmt\android-twa\scripts\verify-signing.ps1" -Keystore "C:\path\to\android.keystore"
#>
param(
  [string]$Keystore = "",
  [string]$Alias    = "warehousewizard"
)

$ErrorActionPreference = "Stop"

function Find-Keytool {
  $cmd = Get-Command keytool -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\keytool.exe")) { return "$env:JAVA_HOME\bin\keytool.exe" }
  $roots = @("$env:ProgramFiles\Java","$env:ProgramFiles\Eclipse Adoptium","${env:ProgramFiles(x86)}\Java","$env:LOCALAPPDATA\Programs")
  foreach ($r in $roots) {
    if (Test-Path $r) {
      $k = Get-ChildItem $r -Recurse -Filter keytool.exe -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($k) { return $k.FullName }
    }
  }
  return $null
}

$keytool = Find-Keytool
if (-not $keytool) {
  Write-Host "ERROR: keytool (a JDK) was not found on this machine." -ForegroundColor Red
  Write-Host "Install Temurin JDK 17 from https://adoptium.net then re-run." -ForegroundColor Yellow
  exit 2
}
Write-Host "keytool : $keytool"

if (-not $Keystore) {
  Write-Host "Searching common locations for a keystore..."
  $searchDirs = @("$env:USERPROFILE\Downloads","$env:USERPROFILE\Desktop","$env:USERPROFILE\Documents","$env:USERPROFILE","C:\classicitbb")
  foreach ($d in $searchDirs) {
    if (Test-Path $d) {
      $hit = Get-ChildItem $d -Recurse -Include *.keystore,*.jks,*.p12,*.pfx -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($hit) { $Keystore = $hit.FullName; break }
    }
  }
}

if (-not $Keystore -or -not (Test-Path $Keystore)) {
  Write-Host "Could not locate your keystore automatically." -ForegroundColor Yellow
  Write-Host "Re-run with:  -Keystore `"C:\path\to\android.keystore`"" -ForegroundColor Yellow
  exit 2
}
Write-Host "Keystore: $Keystore"
Write-Host "Alias   : $Alias"
Write-Host ""

# --- helper: run keytool, return $true on exit code 0 ----------------------
function Test-KeytoolList([string]$store) {
  & $keytool -list -keystore $Keystore -storepass $store -alias $Alias *> $null
  return ($LASTEXITCODE -eq 0)
}
function Test-KeyPass([string]$store, [string]$key) {
  $tmp = [System.IO.Path]::Combine($env:TEMP, ([System.IO.Path]::GetRandomFileName() + ".p12"))
  & $keytool -importkeystore -srckeystore $Keystore -srcstoretype PKCS12 `
      -destkeystore $tmp -deststoretype PKCS12 -srcalias $Alias `
      -srcstorepass $store -srckeypass $key -deststorepass changeit -destkeypass changeit *> $null
  $ok = ($LASTEXITCODE -eq 0)
  Remove-Item $tmp -ErrorAction SilentlyContinue
  return $ok
}
function Read-Secret([string]$prompt) {
  $sec = Read-Host -AsSecureString $prompt
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# --- 1. store password ------------------------------------------------------
$store = Read-Secret "Enter the STORE password (ANDROID_KEYSTORE_PASSWORD)"
if (-not (Test-KeytoolList $store)) {
  Write-Host ""
  Write-Host "STORE password is WRONG (or alias '$Alias' is not in this keystore)." -ForegroundColor Red
  Write-Host "Fix ANDROID_KEYSTORE_PASSWORD first, then re-run." -ForegroundColor Yellow
  exit 1
}
Write-Host "OK: STORE password is correct and alias '$Alias' exists." -ForegroundColor Green
Write-Host ""

# --- 2. key password --------------------------------------------------------
Write-Host "Testing whether the KEY password equals the store password (usual PKCS12 case)..."
if (Test-KeyPass $store $store) {
  Write-Host ""
  Write-Host "SOLVED: the KEY password EQUALS the store password." -ForegroundColor Green
  Write-Host "  -> Set the GitHub secret ANDROID_KEY_PASSWORD to the SAME value as" -ForegroundColor Cyan
  Write-Host "     ANDROID_KEYSTORE_PASSWORD, then re-run the workflow." -ForegroundColor Cyan
  exit 0
}

Write-Host "  ...not equal. Enter the key password you think you set."
$keypw = Read-Secret "Enter the KEY password you THINK you set"
if (Test-KeyPass $store $keypw) {
  Write-Host ""
  Write-Host "OK: that KEY password is correct." -ForegroundColor Green
  Write-Host "  -> Re-paste EXACTLY that value into ANDROID_KEY_PASSWORD with no" -ForegroundColor Cyan
  Write-Host "     trailing spaces or newline (a stray newline causes this same error)." -ForegroundColor Cyan
  exit 0
}

Write-Host ""
Write-Host "Neither the store password nor the value you entered unlocks the key." -ForegroundColor Red
Write-Host "Try any other passwords you may have used. If none work, the key is" -ForegroundColor Yellow
Write-Host "unrecoverable and you'll need a NEW keystore (README 2.1) plus an updated" -ForegroundColor Yellow
Write-Host "SHA-256 fingerprint in public\.well-known\assetlinks.json." -ForegroundColor Yellow
exit 1
