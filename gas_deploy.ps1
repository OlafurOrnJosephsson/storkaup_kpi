# gas_deploy.ps1 - push + utgafusett deploy a BADUM Apps Script verkefnum.
#
# HVERS VEGNA THESSI SKRA ER TIL:
#   clasp vinnur a einu verkefni i einu - hann les .clasp.json ur nuverandi
#   moppu. Repoid hefur TVO verkefni (rot + admin/), svo "clasp push" i rot
#   sendir adeins helminginn. .claspignore utilokar admin/** ur adalpushinu.
#
#   Og push er ekki nog. Lifandi /exec keyrir PINNADA utgafu, svo "clasp push"
#   uppfaerir adeins @HEAD. Vefappid breytist ekki fyrr en ny utgafa er sett.
#   Thad gildir um BADI verkefnin:
#     - admin: HTML-appid sjalft er borid fram ur pinnadri utgafu.
#     - rot:   "Keyra aftur"-hnappurinn i admin-appinu fer gegnum doPost a
#              /exec adalverkefnisins, sem er lika pinnad. Pushir thu bara,
#              keyrir hnappurinn GAMLA kodann.
#
# Notkun:
#   .\gas_deploy.ps1 "lysing a breytingunni"
#   .\gas_deploy.ps1 "lysing" -PushOnly     # push, engin ny utgafa
#   .\gas_deploy.ps1 "lysing" -Only Admin   # adeins annad verkefnid
#
# Git er EKKI hluti af thessu. clasp push (Apps Script) og git push
# (GitHub/jsDelivr fyrir Webflow) eru sitt hvad - sja .claude/commands/deploy.md

param(
    [Parameter(Position = 0)]
    [string]$Description = "",

    [switch]$PushOnly,

    [ValidateSet("Both", "Main", "Admin")]
    [string]$Only = "Both"
)

# --- Utgafusettu uppsetningarnar. EINI stadurinn sem geymir thessi audkenni.
# Aldrei bua til NYJA uppsetningu (thad breytir /exec slodinni og brytur
# Webflow-iframeid og navtenglana). Alltaf -i a thessi.
$MAIN_DEPLOY  = "AKfycbwgKkjKG64Avj4qoCgZOzbDd8mGvhtEf4IaT1-LTawVurQwfZ5OFLNsieCKZIJw3noA4w"
$ADMIN_DEPLOY = "AKfycbxVuynUgT4lmNgUYWYQGZ_0a5pU_ZbQBuaXT46SX8xRsexRm0j3TWeIB09zctYq_RJ1mA"

# @HEAD-uppsetningarnar. Skradar her til ad vornin nedar geti hafnad theim.
$HEAD_DEPLOYS = @(
    "AKfycbyvxp5JmYoo6Fdb7gFZWwb9gSiAuE2EZYvn3N3oBCTI",  # rot
    "AKfycbyKdhIuuCZLZDF9u9DQvxJmit7AUV8zjIFLgY-qvSdw"   # admin
)

$projects = @()
if ($Only -eq "Both" -or $Only -eq "Main") {
    $projects += [pscustomobject]@{
        Name = "Main (rot)"; Dir = $PSScriptRoot; Deployment = $MAIN_DEPLOY
    }
}
if ($Only -eq "Both" -or $Only -eq "Admin") {
    $projects += [pscustomobject]@{
        Name = "Admin"; Dir = (Join-Path $PSScriptRoot "admin"); Deployment = $ADMIN_DEPLOY
    }
}

if ([string]::IsNullOrWhiteSpace($Description)) {
    $Description = "deploy " + (Get-Date -Format "yyyy-MM-dd HH:mm")
    Write-Host "(engin lysing gefin - nota '$Description')" -ForegroundColor DarkGray
}

# --- Vorn: hafna @HEAD adur en nokkud er gert.
foreach ($p in $projects) {
    if ($HEAD_DEPLOYS -contains $p.Deployment) {
        Write-Host "VILLA: $($p.Name) beinist a @HEAD-uppsetningu. Stodva." -ForegroundColor Red
        exit 1
    }
    if (-not (Test-Path (Join-Path $p.Dir ".clasp.json"))) {
        Write-Host "VILLA: $($p.Name) - .clasp.json finnst ekki i $($p.Dir)" -ForegroundColor Red
        exit 1
    }
}

$results = @()

foreach ($p in $projects) {
    Write-Host ""
    Write-Host "=== $($p.Name) ===" -ForegroundColor Cyan

    Push-Location $p.Dir
    try {
        # --force yfirskrifar fjar-manifestid an spurningar (an thess haengir
        # skriftan a interactive prompti). Thad er ohaett HER af thvi badi
        # appsscript.json geyma vefappstillinguna sjalf og rett:
        #   rot   access: ANYONE_ANONYMOUS
        #   admin access: DOMAIN      <- oryggiskrafa, sja CLAUDE.md
        # Vaeru thessar stillingar adeins server-side myndi --force skola
        # theim ut. Breytist manifestid, athugadu thetta aftur.
        Write-Host "  clasp push..." -ForegroundColor DarkGray
        & clasp push --force
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  VILLA: clasp push mistokst (exit $LASTEXITCODE)" -ForegroundColor Red
            exit 1
        }

        if ($PushOnly) {
            Write-Host "  push OK - engin ny utgafa (-PushOnly)" -ForegroundColor Yellow
            $results += "$($p.Name): push OK, ENGIN ny utgafa"
        }
        else {
            Write-Host "  clasp deploy -i $($p.Deployment.Substring(0,12))..." -ForegroundColor DarkGray
            $out = & clasp deploy -i $p.Deployment -d $Description
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  VILLA: clasp deploy mistokst (exit $LASTEXITCODE)" -ForegroundColor Red
                Write-Host "  ATH: push er BUINN en utgafa EKKI sett - /exec keyrir enn gamla kodann." -ForegroundColor Yellow
                exit 1
            }
            $out | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
            $ver = ($out | Select-String -Pattern "@(\d+)" | Select-Object -First 1)
            if ($null -eq $ver) { $verTxt = "?" } else { $verTxt = $ver.Matches[0].Value }
            $results += "$($p.Name): push OK, ny utgafa $verTxt"
        }
    }
    finally {
        Pop-Location
    }
}

Write-Host ""
Write-Host "=== SAMANTEKT ===" -ForegroundColor Green
foreach ($r in $results) { Write-Host "  $r" }

if ($PushOnly) {
    Write-Host ""
    Write-Host "ATH: -PushOnly var valid. Vefoppin keyra enn gomlu utgafuna." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Git er ser: 'git add/commit/push' eda /deploy skillid." -ForegroundColor DarkGray
