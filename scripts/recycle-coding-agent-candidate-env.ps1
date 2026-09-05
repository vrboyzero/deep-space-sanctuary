param(
  [Parameter(Mandatory)][string]$StateRoot,
  [Parameter(Mandatory)][string]$LogPath,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\')
$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if (-not $root.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase)) { throw 'Candidate state escaped system temp.' }
if (Test-Path -LiteralPath $LogPath) { throw 'Candidate cleanup log already exists.' }

function Assert-OrdinaryPath {
  param([string]$Target)
  $current = [IO.Path]::GetFullPath($Target)
  while ($current) {
    $item = Get-Item -LiteralPath $current -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Candidate cleanup path traverses a reparse point.' }
    $parent = Split-Path -Parent $current
    if ($parent -eq $current) { break }
    $current = $parent
  }
}

Assert-OrdinaryPath $root
Assert-OrdinaryPath (Split-Path -Parent ([IO.Path]::GetFullPath($LogPath)))
$entries = @()
foreach ($name in @('.env', '.env.local')) {
  $target = [IO.Path]::GetFullPath((Join-Path $root $name))
  if (-not $target.StartsWith("$root\", [StringComparison]::OrdinalIgnoreCase)) { throw 'Candidate environment path escaped its state root.' }
  if (-not (Test-Path -LiteralPath $target)) { continue }
  Assert-OrdinaryPath $target
  $item = Get-Item -LiteralPath $target -Force
  if ($item.PSIsContainer) { throw 'Candidate environment must be a regular file.' }
  $entries += [PSCustomObject]@{ path = $target; length = [long]$item.Length; sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$log = [ordered]@{
  schemaVersion = 'coding-agent-candidate-env-cleanup/v1'
  stateRoot = $root
  status = if ($Execute) { 'validated' } else { 'dry_run' }
  action = 'send_to_windows_recycle_bin'
  files = $entries
}
if (-not $Execute) { $log | ConvertTo-Json -Depth 8; return }

function Write-NewJson {
  param([string]$Target, [object]$Value)
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 8))
  $stream = [IO.File]::Open($Target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $stream.Write($bytes); $stream.Flush($true) } finally { $stream.Dispose() }
}

Write-NewJson "$LogPath.intent.json" $log
Add-Type -AssemblyName Microsoft.VisualBasic
foreach ($entry in $entries) {
  Assert-OrdinaryPath $entry.path
  $item = Get-Item -LiteralPath $entry.path -Force
  if ($item.PSIsContainer -or $item.Length -ne $entry.length -or (Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) {
    throw 'Candidate environment changed after validation.'
  }
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($entry.path, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
}
$remaining = @($entries | Where-Object { Test-Path -LiteralPath $_.path }).Count
if ($remaining -ne 0) { throw 'Candidate environment cleanup left files.' }
$log.status = 'recycled'
$log.remaining = 0
Write-NewJson $LogPath $log
[PSCustomObject]@{ status = 'recycled'; files = $entries.Count; remaining = 0 } | ConvertTo-Json -Compress
