# Builds the debug APK from the ASCII path (S:\repo) because Gradle and Java fail on the real folder name.
# Usage (PowerShell): powershell -ExecutionPolicy Bypass -File scripts\android-build.ps1 [-Task assembleDebug]
param([string]$Task = 'assembleDebug')
$ErrorActionPreference = 'Stop'
if (-not (Test-Path 'S:\repo')) {
  subst S: "$env:LOCALAPPDATA\saltteul"
}
$env:JAVA_HOME = "$env:LOCALAPPDATA\Programs\jdk-21"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
"sdk.dir=$($env:ANDROID_HOME.Replace('\','\\').Replace(':','\:'))" | Out-File -Encoding ascii S:\repo\android\local.properties
cmd /c "cd /d S:\repo && npx cap sync android"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cmd /c "cd /d S:\repo\android && .\gradlew.bat $Task --no-daemon --console=plain"
exit $LASTEXITCODE
