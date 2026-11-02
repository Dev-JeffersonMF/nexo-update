<#
  Instala o APK release do Nexus no aparelho e RELIGA o Auto-Bot.

  Por que isso existe: o Android DESLIGA o serviço de acessibilidade (e o
  leitor de notificações) sempre que o aplicativo é reinstalado ou atualizado.
  Sem religar, a automação do WhatsApp, das chamadas e da mídia para de
  funcionar — e o usuário precisa caçar o ajuste do sistema toda vez.

  Uso:
    powershell -ExecutionPolicy Bypass -File tools\nexus-install.ps1
    powershell -ExecutionPolicy Bypass -File tools\nexus-install.ps1 -SkipBuild
#>
param(
  [string]$Apk = '',
  [string]$Adb = '',
  [switch]$SkipBuild,
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Apk) {
  $Apk = Join-Path $projectRoot 'android\app\build\outputs\apk\release\app-release.apk'
}
if (-not $Adb) {
  $Adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
}

$package = 'com.jefferson.nexusassistente'
$autoBot = "$package/$package.service.NexusAccessibilityService"
$notificationListener = "$package/$package.service.NexusNotificationListenerService"

if (-not (Test-Path $Adb)) {
  throw "adb não encontrado em $Adb"
}

if (-not $SkipBuild) {
  Write-Host '>> Compilando o release...'
  Push-Location (Join-Path $projectRoot 'android')
  try {
    & .\gradlew.bat :app:assembleRelease --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Falha na compilação do release' }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path $Apk)) {
  throw "APK não encontrado em $Apk"
}

Write-Host '>> Instalando o APK (dados preservados)...'
& $Adb install -r $Apk
if ($LASTEXITCODE -ne 0) { throw 'Falha na instalação do APK' }

# O Android desliga a acessibilidade a cada instalação do APK — e a limpeza do
# sistema acontece DEPOIS do `install` volta. Por isso a espera e a conferência:
# sem isso, o serviço é desligado logo em seguida e o Auto-Bot some.
Start-Sleep -Seconds 3

Write-Host '>> Religando o Auto-Bot (acessibilidade) e a leitura de notificações...'
$ligado = $false
for ($tentativa = 1; $tentativa -le 4 -and -not $ligado; $tentativa++) {
  & $Adb shell settings put secure enabled_accessibility_services $autoBot
  & $Adb shell settings put secure accessibility_enabled 1
  & $Adb shell settings put secure enabled_notification_listeners $notificationListener
  & $Adb shell settings put secure notification_listener_enabled 1
  Start-Sleep -Seconds 2
  $estado = (& $Adb shell settings get secure enabled_accessibility_services).Trim()
  $ligado = $estado -like '*nexusassistente*'
  if (-not $ligado) {
    Write-Host "   (tentativa $tentativa): o sistema desligou de novo, tentando..."
    Start-Sleep -Seconds 2
  }
}

$estado = (& $Adb shell settings get secure enabled_accessibility_services).Trim()
Write-Host "   Acessibilidade: $estado"
if ($estado -notlike '*nexusassistente*') {
  Write-Warning 'O Auto-Bot não ficou ligado. Ative em Ajustes › Acessibilidade.'
}

if (-not $NoLaunch) {
  Write-Host '>> Abrindo o Nexus...'
  # SEM `am force-stop`: no Android, parar o pacote à força DESLIGA o serviço de
  # acessibilidade dele (e o sistema tira o serviço da lista de habilitados).
  # A instalação já derruba o app, então não é preciso forçar nada.
  & $Adb shell am start -n "$package/.MainActivity"
  Start-Sleep -Seconds 3
  $final = (& $Adb shell settings get secure enabled_accessibility_services).Trim()
  if ($final -notlike '*nexusassistente*') {
    Write-Warning 'O Auto-Bot foi desligado ao abrir o app. Religando...'
    & $Adb shell settings put secure enabled_accessibility_services $autoBot
    & $Adb shell settings put secure accessibility_enabled 1
    Start-Sleep -Seconds 2
    $final = (& $Adb shell settings get secure enabled_accessibility_services).Trim()
  }
  Write-Host "   Acessibilidade: $final"
}

Write-Host '>> Pronto.'
