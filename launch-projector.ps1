param(
    [string]$Url = "http://localhost:5173/projector"
)

Add-Type -AssemblyName System.Windows.Forms

$screens = [System.Windows.Forms.Screen]::AllScreens
$targetScreen = if ($screens.Count -gt 1) { $screens[1] } else { $screens[0] }

$left = $targetScreen.Bounds.Left
$top = $targetScreen.Bounds.Top
$width = $targetScreen.Bounds.Width
$height = $targetScreen.Bounds.Height

$browserCandidates = @(
    "$Env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$Env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$Env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$Env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe"
)

$browserPath = $browserCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $browserPath) {
    throw "Could not find Chrome or Edge. Install one of them or edit launch-projector.ps1 with the correct browser path."
}

$arguments = @(
    "--new-window",
    "--window-position=$left,$top",
    "--window-size=$width,$height",
    "--kiosk",
    $Url
)

Start-Process -FilePath $browserPath -ArgumentList $arguments