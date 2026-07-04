# setup-scheduler.ps1
# Registers a Windows Task Scheduler job that runs auto-refresh.ps1 every 30 minutes
# Run ONCE as Administrator:  powershell -ExecutionPolicy Bypass -File setup-scheduler.ps1

$taskName   = "KnowledgeGapDashboard-Refresh"
$scriptPath = "C:\Users\sushmita.srivastava\auto-refresh.ps1"
$logPath    = "C:\Users\sushmita.srivastava\auto-refresh.log"

# Remove existing task if present
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Removed existing task."
}

$action  = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$scriptPath`""

# Trigger: every 30 minutes, starting now, repeating indefinitely
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 30) -Once -At (Get-Date)

$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -RunOnlyIfNetworkAvailable `
  -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName  $taskName `
  -Action    $action `
  -Trigger   $trigger `
  -Settings  $settings `
  -Principal $principal `
  -Description "Refreshes OrgCS data every 30 min and pushes data.json to git.soma"

Write-Host ""
Write-Host "Task '$taskName' registered successfully." -ForegroundColor Green
Write-Host "It will run every 30 minutes while you are logged in."
Write-Host ""
Write-Host "Logs:  $logPath"
Write-Host ""
Write-Host "To run it manually now:"
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
Write-Host ""
Write-Host "To remove it:"
Write-Host "  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
