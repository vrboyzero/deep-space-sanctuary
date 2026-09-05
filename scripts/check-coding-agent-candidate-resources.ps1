param([Parameter(Mandatory)][string]$ConfigPath)

$ErrorActionPreference = "Stop"
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 30
if ($config.schemaVersion -ne "coding-agent-candidate-runner-config/v1") { throw "Invalid candidate resource configuration." }
$counts = [ordered]@{}

function Read-Checked {
  param([string]$Executable, [string[]]$ArgumentList)
  $lines = @(& $Executable @ArgumentList)
  if ($LASTEXITCODE -ne 0) { throw "Read-only candidate resource probe failed: $Executable" }
  return $lines
}

$processes = @(Get-CimInstance Win32_Process)
$byPid = @{}
foreach ($item in $processes) { $byPid[[int]$item.ProcessId] = $item }
$ancestors = [Collections.Generic.HashSet[int]]::new()
$current = [int]$PID
while ($current -gt 0 -and $ancestors.Add($current)) {
  $item = $byPid[$current]
  if ($null -eq $item) { break }
  $current = [int]$item.ParentProcessId
}
$scopePaths = @($config.windowsHarnessRoot, $config.wsl.harnessRoot, $config.roots.artifacts, $config.roots.fixtures, $config.roots.state)
$scopePattern = ($scopePaths | ForEach-Object { [regex]::Escape([string]$_) }) -join '|'
$workspacePattern = [regex]::Escape([string]$config.workspaceRoot)
$windowsMatches = @($processes | Where-Object {
  -not $ancestors.Contains([int]$_.ProcessId) -and $_.CommandLine -and (
    $_.CommandLine -match $scopePattern -or
    ($_.Name -eq 'rg.exe' -and $_.CommandLine -match $workspacePattern) -or
    ($_.Name -eq 'node.exe' -and $_.CommandLine -match $workspacePattern -and $_.CommandLine -match '(vitest|tinypool|run-coding-agent-benchmark)')
  )
})
if ($windowsMatches.Count -ne 0) { throw "Candidate process or scanner is still active; count=$($windowsMatches.Count)." }
$counts.windowsProcesses = $windowsMatches.Count

$portNumbers = @([int]$config.execution.port, 28892) | Select-Object -Unique
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in $portNumbers })
if ($listeners.Count -ne 0) { throw "Candidate Windows listener is still active." }
$counts.windowsListeners = $listeners.Count
$containerCount = 0
foreach ($filter in @('name=belldandy-command-', "ancestor=$($config.execution.ociImage)")) {
  $containers = @(Read-Checked 'docker' @('ps', '-aq', '--filter', $filter))
  if ($containers.Count -ne 0) { throw "Candidate Docker containers remain." }
  $containerCount += $containers.Count
}
$counts.windowsContainers = $containerCount
$leaseCount = 0
foreach ($root in @([IO.Path]::GetTempPath(), $config.roots.fixtures)) {
  if (Test-Path -LiteralPath $root) {
    $leases = @(Get-ChildItem -LiteralPath $root -Force -Filter 'belldandy-command-sandbox*')
    if ($leases.Count -ne 0) { throw "Candidate OCI temporary resources remain." }
    $leaseCount += $leases.Count
  }
}
$counts.windowsLeases = $leaseCount

$hasWsl = @($config.selection | Where-Object { $_.platform -eq 'wsl2-linux' }).Count -gt 0
if ($hasWsl) {
  $distro = [string]$config.wsl.distribution
  $linuxRoot = (Read-Checked 'wsl.exe' @('-d', $distro, '--exec', 'wslpath', '-a', [string]$config.wsl.harnessRoot)) -join ''
  $linuxProcesses = @(Read-Checked 'wsl.exe' @('-d', $distro, '--exec', 'env', 'COLUMNS=160', 'LINES=40', 'ps', '-ww', '-eo', 'pid=,ppid=,comm=,args='))
  $linuxMatches = @($linuxProcesses | Where-Object {
    $_ -match [regex]::Escape($linuxRoot) -or $_ -match [regex]::Escape([string]$config.wsl.toolchainBin) -or
    ($_ -match '\srg\s' -and $_ -match 'star-sanctuary') -or $_ -match 'run-coding-agent-benchmark'
  })
  if ($linuxMatches.Count -ne 0) { throw "Candidate WSL process or scanner remains." }
  $counts.wslProcesses = $linuxMatches.Count
  $linuxListeners = @(Read-Checked 'wsl.exe' @('-d', $distro, '--exec', 'ss', '-Hlnt'))
  $listenerCount = 0
  foreach ($number in $portNumbers) {
    $matchedListeners = @($linuxListeners | Where-Object { $_ -match ":${number}\s" })
    if ($matchedListeners.Count -ne 0) { throw "Candidate WSL listener remains." }
    $listenerCount += $matchedListeners.Count
  }
  $counts.wslListeners = $listenerCount
  $leases = @(Read-Checked 'wsl.exe' @('-d', $distro, '--exec', 'find', '/tmp', '-maxdepth', '1', '-name', 'belldandy-command-sandbox*', '-print'))
  if ($leases.Count -ne 0) { throw "Candidate WSL OCI lease remains." }
  $counts.wslLeases = $leases.Count
  $containers = @(Read-Checked 'wsl.exe' @('-d', $distro, '--exec', "$($config.wsl.toolchainBin)/docker", 'ps', '-aq', '--filter', 'name=belldandy-command-'))
  if ($containers.Count -ne 0) { throw "Candidate WSL Docker containers remain." }
  $counts.wslContainers = $containers.Count
}

[PSCustomObject]@{ status = 'passed'; counts = @($counts.Values); observations = $counts; wslChecked = $hasWsl } | ConvertTo-Json -Compress
