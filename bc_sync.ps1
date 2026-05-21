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
Write-Host "Apps Script trigger keyrir processBcDrop_v1() sjalf." -ForegroundColor Green
