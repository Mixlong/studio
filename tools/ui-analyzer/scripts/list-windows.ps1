$ErrorActionPreference = "Stop"
$items = @(
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) } |
    ForEach-Object {
      [pscustomobject]@{
        processName = $_.ProcessName
        pid = $_.Id
        title = $_.MainWindowTitle
        hwnd = [long]$_.MainWindowHandle
        executablePath = $_.Path
      }
    } | Sort-Object processName, title
)
ConvertTo-Json -InputObject $items -Depth 5 -Compress