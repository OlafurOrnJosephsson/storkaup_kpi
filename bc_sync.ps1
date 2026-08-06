# BC Drop Sync — uploadar XLSX skrar ur bc_drop/ i Google Drive og hreinsar eftir
$LOCAL  = "$PSScriptRoot\bc_drop"
$O      = [char]0x00D3
$REMOTE = "storkaup_drive:ST${O}RKAUP_KPI_CORE/BC_DROP"
$RCLONE = "C:\Users\olafur\AppData\Local\Microsoft\WinGet\Packages\Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe\rclone-v1.74.1-windows-amd64\rclone.exe"

$files = Get-ChildItem "$LOCAL\*.xlsx" -ErrorAction SilentlyContinue
if ($files.Count -eq 0) {
    Write-Host "Engar XLSX skrar i bc_drop\ - ekki neitt ad gera." -ForegroundColor Yellow
    exit 0
}

Write-Host "Uploading $($files.Count) skra(r) i Drive..." -ForegroundColor Cyan
& $RCLONE copy $LOCAL $REMOTE --include "*.xlsx" --progress

if ($LASTEXITCODE -ne 0) {
    Write-Host "VILLA: rclone failed (exit $LASTEXITCODE)" -ForegroundColor Red
    exit 1
}

Write-Host "Upload lokid. Hreinsa local skrar..." -ForegroundColor Cyan
$files | Remove-Item -Force

Write-Host "Lokid! Skrar eru nu i Drive BC_DROP." -ForegroundColor Green
Write-Host ""
Write-Host "NAESTA SKREF ER HANDVIRKT - ekkert trigger sekir thessar skrar." -ForegroundColor Yellow
Write-Host "  Opna STORKAUP_KPI_CORE sheet -> valmynd 'BC Sync':" -ForegroundColor Yellow
Write-Host "    1. 'Kiktu a BC headers (diagnostic)'  (read-only, ef langt er sidan sidast var hladid)" -ForegroundColor Yellow
Write-Host "    2. 'Importa BC skrar ur Drive Drop'   (hledur inn og faerir skrar i archive)" -ForegroundColor Yellow
Write-Host ""
Write-Host "ATH: local skrar i bc_drop\ voru eyddar eftir upload - Drive er eina afritid." -ForegroundColor DarkGray
# Fyrri utgafa af thessari linu sagdi "Apps Script trigger keyrir processBcDrop_v1()
# sjalf". Thad var ranght: scheduledBcSync_v1 og trigger-installerinn voru fjarlaegd
# 2026-04-30 (commit d83c7c5). Enginn BC-trigger er til - processBcDrop_v1 keyrir
# EINGONGU ur valmyndinni. Skrar sem eru uploadadar liggja osottar thar til einhver
# ytir a hnappinn.
