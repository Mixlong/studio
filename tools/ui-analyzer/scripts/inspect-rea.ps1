param(
  [Parameter(Mandatory=$true)][string]$TargetDir,
  [Parameter(Mandatory=$true)][string]$EvidencePath,
  [Parameter(Mandatory=$true)][string]$SummaryPath
)
$ErrorActionPreference = "Stop"
if (Test-Path $EvidencePath) { throw "REA evidence output already exists; refusing to overwrite." }
$reaArgs = @(
  "--yes", "rea-agents@6.8.0", "inspect-desktop-application", $TargetDir,
  "--max_entries", "20000", "--detail", "summary",
  "--evidence_output", $EvidencePath, "--max_probe_bytes", "16777216",
  "--format", "json", "--full-output"
)
$output = & npx @reaArgs 2>&1
$exitCode = $LASTEXITCODE
$raw = ($output | Out-String).Trim()
[System.IO.File]::WriteAllText($SummaryPath, $raw, [System.Text.UTF8Encoding]::new($false))
if ($exitCode -ne 0) {
  Write-Error ("REA inspect-desktop-application failed with exit code " + $exitCode + ". " + $raw)
  exit $exitCode
}
Write-Output $raw