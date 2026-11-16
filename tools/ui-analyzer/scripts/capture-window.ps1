param(
  [Parameter(Mandatory=$true)][int]$ProcessId,
  [Parameter(Mandatory=$true)][long]$WindowHandle,
  [Parameter(Mandatory=$true)][string]$OutputDir,
  [int]$MaxNodes = 1200
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
if (-not ("DigiwiseWindowCapture" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DigiwiseWindowCapture {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
}
"@
}
$hwnd = [IntPtr]$WindowHandle
if (-not [DigiwiseWindowCapture]::IsWindow($hwnd)) { throw "The selected window handle is no longer valid." }
$proc = Get-Process -Id $ProcessId -ErrorAction Stop
$rect = New-Object DigiwiseWindowCapture+RECT
if (-not [DigiwiseWindowCapture]::GetWindowRect($hwnd, [ref]$rect)) { throw "GetWindowRect failed." }
$left = [int]$rect.Left
$top = [int]$rect.Top
$width = [int]($rect.Right - $rect.Left)
$height = [int]($rect.Bottom - $rect.Top)
if ($width -lt 80 -or $height -lt 60 -or $width -gt 12000 -or $height -gt 12000) {
  throw ("The selected window has invalid bounds: " + $width + "x" + $height + ".")
}
$screenshotPath = Join-Path $OutputDir "window.png"
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$printed = $false
try { $printed = [DigiwiseWindowCapture]::PrintWindow($hwnd, $hdc, 2) }
finally { $graphics.ReleaseHdc($hdc) }
$meanBrightness = 0.0
if ($printed) {
  $samples = @(
    @([int]($width * 0.25), [int]($height * 0.25)),
    @([int]($width * 0.50), [int]($height * 0.50)),
    @([int]($width * 0.75), [int]($height * 0.75))
  )
  $total = 0.0
  foreach ($point in $samples) {
    $pixel = $bitmap.GetPixel($point[0], $point[1])
    $total += ($pixel.R + $pixel.G + $pixel.B) / 3.0
  }
  $meanBrightness = $total / $samples.Count
}
$captureMode = "PrintWindow"
if (-not $printed -or $meanBrightness -lt 2.0) {
  $bitmap.Dispose()
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics.Dispose()
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $copyLeft = [Math]::Max($left, $virtual.Left)
  $copyTop = [Math]::Max($top, $virtual.Top)
  $copyRight = [Math]::Min(($left + $width), ($virtual.Left + $virtual.Width))
  $copyBottom = [Math]::Min(($top + $height), ($virtual.Top + $virtual.Height))
  if ($copyRight -le $copyLeft -or $copyBottom -le $copyTop) {
    throw "The target window is outside the visible desktop. Restore it before capturing."
  }
  $graphics.CopyFromScreen($copyLeft, $copyTop, ($copyLeft - $left), ($copyTop - $top),
    (New-Object System.Drawing.Size(($copyRight - $copyLeft), ($copyBottom - $copyTop))))
  $captureMode = "CopyFromScreen"
}
$bitmap.Save($screenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
$graphics.Dispose()

$nodes = New-Object System.Collections.Generic.List[object]
$treeStatus = "unavailable"
$treeError = $null
try {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue(@($root, 0, -1))
  while ($queue.Count -gt 0 -and $nodes.Count -lt $MaxNodes) {
    $item = $queue.Dequeue()
    $element = $item[0]
    $depth = [int]$item[1]
    $parentIndex = [int]$item[2]
    try {
      $current = $element.Current
      $bounds = $current.BoundingRectangle
      $index = $nodes.Count
      $nodes.Add([pscustomobject]@{
        index = $index
        parentIndex = $parentIndex
        depth = $depth
        name = $current.Name
        controlType = $current.ControlType.ProgrammaticName
        className = $current.ClassName
        automationId = $current.AutomationId
        frameworkId = $current.FrameworkId
        isEnabled = $current.IsEnabled
        isOffscreen = $current.IsOffscreen
        bounds = [pscustomobject]@{
          x = [Math]::Round($bounds.X, 1)
          y = [Math]::Round($bounds.Y, 1)
          width = [Math]::Round($bounds.Width, 1)
          height = [Math]::Round($bounds.Height, 1)
        }
      })
      if ($depth -lt 10) {
        $child = $walker.GetFirstChild($element)
        $childCount = 0
        while ($null -ne $child -and $childCount -lt 250 -and $nodes.Count + $queue.Count -lt $MaxNodes) {
          $queue.Enqueue(@($child, ($depth + 1), $index))
          $child = $walker.GetNextSibling($child)
          $childCount++
        }
      }
    } catch { continue }
  }
  $treeStatus = if ($nodes.Count -gt 2) { "available" } elseif ($nodes.Count -gt 0) { "limited" } else { "empty" }
} catch { $treeError = $_.Exception.Message }

$limitation = $null
if ($treeStatus -eq "limited") {
  $limitation = "The target appears to expose only a top-level Chromium/Direct3D accessibility wrapper. This tree is incomplete and must not be treated as a full control inventory."
}
$nodeArray = $nodes.ToArray()
$payload = [ordered]@{
  process = [ordered]@{ pid = $ProcessId; name = $proc.ProcessName; title = $proc.MainWindowTitle; executablePath = $proc.Path }
  window = [ordered]@{ handle = $WindowHandle; bounds = [ordered]@{ x = $left; y = $top; width = $width; height = $height } }
  screenshotPath = $screenshotPath
  screenshot = [ordered]@{ captured = (Test-Path $screenshotPath); width = $width; height = $height; mode = $captureMode }
  accessibility = [ordered]@{
    status = $treeStatus; nodeCount = $nodes.Count; maxNodes = $MaxNodes; error = $treeError; nodes = $nodeArray
    limitation = $limitation
  }
}
ConvertTo-Json -InputObject $payload -Depth 20 -Compress