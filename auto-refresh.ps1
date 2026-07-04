# auto-refresh.ps1
# Fetches fresh OrgCS data and pushes data.json to git.soma
# Run manually or via Windows Task Scheduler (setup-scheduler.ps1)

$ErrorActionPreference = "Stop"
$repoDir  = "C:\Users\sushmita.srivastava"
$nodeExe  = "C:\Program Files\sf\client\bin\node.exe"
$tokenFile = Join-Path $repoDir "sf-token.txt"
$logFile   = Join-Path $repoDir "auto-refresh.log"

function Log($msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
  Add-Content -Path $logFile -Value $line
  Write-Host $line
}

# ── Read token ────────────────────────────────────────────────────────────────
if (-not (Test-Path $tokenFile)) {
  Log "ERROR: sf-token.txt not found. Create it with your SF_ACCESS_TOKEN."
  Log "       Run:  Set-Content '$tokenFile' -Value '00D...your-token...'"
  exit 1
}

$token = (Get-Content $tokenFile -Raw).Trim()
if (-not $token -or $token.Length -lt 20) {
  Log "ERROR: sf-token.txt is empty or invalid."
  exit 1
}

Log "Starting OrgCS data refresh..."

# ── Run fetch-data.js ─────────────────────────────────────────────────────────
Push-Location $repoDir
try {
  $env:SF_ACCESS_TOKEN  = $token
  $env:SF_INSTANCE_URL  = "https://orgcs.my.salesforce.com"
  $env:SF_API_VERSION   = "v61.0"

  & $nodeExe fetch-data.js
  if ($LASTEXITCODE -ne 0) {
    Log "ERROR: fetch-data.js exited with code $LASTEXITCODE (token may be expired)"
    exit 1
  }
  Log "data.json updated successfully"
} catch {
  Log "ERROR during fetch: $_"
  exit 1
}

# ── Git commit + push to soma ─────────────────────────────────────────────────
try {
  git add data.json
  $diff = git diff --cached --stat
  if (-not $diff) {
    Log "No changes in data.json — skipping commit"
  } else {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    git commit -m "chore: refresh OrgCS data $timestamp"
    git push soma main
    Log "Pushed to git.soma successfully"
  }
} catch {
  Log "ERROR during git push: $_"
  exit 1
} finally {
  Pop-Location
}

Log "Done."
