# PIM Drop Sync - uploadar Plytix CSV ur pim_drop/ i Google Drive.
#
# MUNUR A THESSU OG bc_sync.ps1 (tvennt, badhvort viljandi):
#   1. Local skrar eru EKKI eyddar eftir upload. Hrai utdratturinn er lika
#      inntakid i pim/heitalinter.py, sem er keyrdur local. BC eydir sinum af thvi
#      Drive er eina afritid thar; her er thad ekki.
#   2. Linter-uttakid (_brot, _commercial_name, _tillogur) er EKKI uploadad.
#      Thad eru lika .csv skrar, og buildPimWorksheet velur nyjustu .csv i mopunni.
#      GAS-scriptan sleppir theim lika, en betra er ad thaer fari aldrei upp.

$LOCAL  = "$PSScriptRoot\pim_drop"
$O      = [char]0x00D3
$REMOTE = "storkaup_drive:ST${O}RKAUP_KPI_CORE/PIM_DROP"
$RCLONE = "C:\Users\olafur\AppData\Local\Microsoft\WinGet\Packages\Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe\rclone-v1.74.1-windows-amd64\rclone.exe"

# Bara hrai utdratturinn - linter-uttakid sia sig ut her.
$files = Get-ChildItem "$LOCAL\*.csv" -ErrorAction SilentlyContinue |
         Where-Object { $_.Name -notmatch '_(brot|commercial_name|tillogur)\.csv$' }

if ($files.Count -eq 0) {
    Write-Host "Enginn hrar Plytix-utdrattur i pim_drop\ - ekki neitt ad gera." -ForegroundColor Yellow
    Write-Host "(Linter-uttak er sad ut - thad a ekki ad fara i Drive.)" -ForegroundColor DarkGray
    exit 0
}

Write-Host "Uploading $($files.Count) skra(r) i Drive..." -ForegroundColor Cyan
foreach ($f in $files) { Write-Host "  $($f.Name)" -ForegroundColor DarkGray }

& $RCLONE copy $LOCAL $REMOTE `
    --include "*.csv" `
    --exclude "*_brot.csv" `
    --exclude "*_commercial_name.csv" `
    --exclude "*_tillogur.csv" `
    --progress

if ($LASTEXITCODE -ne 0) {
    Write-Host "VILLA: rclone failed (exit $LASTEXITCODE)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Upload lokid. Local skrar eru OSNERTAR - heitalinter tharf thaer." -ForegroundColor Green
Write-Host ""
Write-Host "NAESTA SKREF ER HANDVIRKT - ekkert trigger sekir thessar skrar." -ForegroundColor Yellow
Write-Host "  Opna STORKAUP_KPI_CORE sheet -> valmynd 'Voruinnihald':" -ForegroundColor Yellow
Write-Host "    'Byggja vinnusheet ur Plytix-utdraetti'" -ForegroundColor Yellow
Write-Host ""
Write-Host "ATH: utdratturinn ur Plytix ma EKKI vera siadur a birtingarras." -ForegroundColor DarkGray
Write-Host "     Allur vorulistinn, lika thad sem er obirt - annars verdur" -ForegroundColor DarkGray
Write-Host "     EKKI_A_VEF flipinn tomur af smidi og nefnarinn rangur." -ForegroundColor DarkGray
Write-Host ""
Write-Host "ATH: dalkar sem tharf: Label, SKU, Brand Name, Commercial Name," -ForegroundColor DarkGray
Write-Host "     Long Description, Categories, Thumbnail." -ForegroundColor DarkGray
