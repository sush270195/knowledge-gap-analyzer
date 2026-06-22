# refresh-data.ps1
# Run this script to pull fresh case counts from Salesforce and push to GitHub.
# Requires: sf CLI authenticated, gh CLI authenticated
#
# Usage: powershell -ExecutionPolicy Bypass -File refresh-data.ps1

$ErrorActionPreference = "Stop"
$repoDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Querying Salesforce for last-30-day case counts..." -ForegroundColor Cyan

# --- SOQL query via sf CLI ---
$soql = @"
SELECT OwnerId, Owner.Name, CaseReportingTaxonomy__r.Name tax, COUNT(Id) cnt
FROM Case
WHERE CreatedDate = LAST_N_DAYS:30
  AND CaseReportingTaxonomy__c != null
GROUP BY OwnerId, Owner.Name, CaseReportingTaxonomy__r.Name
ORDER BY OwnerId
LIMIT 5000
"@

$tmpFile = "$env:TEMP\sf_cases_raw.json"
sf data query --query $soql --json | Out-File $tmpFile -Encoding utf8
$raw = Get-Content $tmpFile | ConvertFrom-Json
$records = $raw.result.records

if (-not $records) {
    Write-Error "No records returned. Check sf CLI auth: sf org display"
    exit 1
}
Write-Host "  Got $($records.Count) taxonomy/owner rows" -ForegroundColor Gray

# Group by OwnerId
$byPerson = @{}
foreach ($r in $records) {
    $uid = $r.OwnerId
    if (-not $byPerson.ContainsKey($uid)) {
        $byPerson[$uid] = @{ name = $r.Name; topics = @{}; total = 0 }
    }
    $t = $r.tax
    if ($t) {
        if (-not $byPerson[$uid].topics.ContainsKey($t)) { $byPerson[$uid].topics[$t] = 0 }
        $byPerson[$uid].topics[$t] += $r.cnt
    }
    $byPerson[$uid].total += $r.cnt
}

# Build engineers map
$engineers = @{}
foreach ($uid in $byPerson.Keys) {
    $engineers[$uid] = @{
        name       = $byPerson[$uid].name
        totalCases = $byPerson[$uid].total
        topics     = $byPerson[$uid].topics
    }
}

$output = @{
    generatedAt = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    engineers   = $engineers
}

$jsonPath = Join-Path $repoDir "data.json"
$output | ConvertTo-Json -Depth 5 | Set-Content $jsonPath -Encoding UTF8
Write-Host "  data.json written ($($byPerson.Count) engineers)" -ForegroundColor Gray

# --- Git commit and push ---
Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
Push-Location $repoDir
git add data.json
git commit -m "chore: refresh live case data $(Get-Date -Format 'yyyy-MM-dd')"
git push origin main
Pop-Location

Write-Host ""
Write-Host "Done! Live site will update in ~60s:" -ForegroundColor Green
Write-Host "  https://sush270195.github.io/knowledge-gap-analyzer/" -ForegroundColor Blue
