[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
    [ValidatePattern('^[a-p]{32}$')][string]$ChromeExtensionId,
    [ValidatePattern('^[a-p]{32}$')][string]$EdgeExtensionId,
    [string]$CodexPath,
    [ValidateSet('Both', 'Edge', 'Chrome')][string]$Browser = 'Both'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$requiredCodexVersion = [Version]'0.159.2'

function Get-CodexCandidates {
    # Enumerate only known CLI locations; do not search the user's whole drive.
    $paths = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $packageRoots = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($commandName in @('codex.exe', 'codex.cmd', 'codex', 'npm.cmd', 'npm')) {
        foreach ($command in @(Get-Command $commandName -CommandType Application -All -ErrorAction SilentlyContinue)) {
            if (-not $command.Source) { continue }
            if ([IO.Path]::GetFileName($command.Source) -ieq 'codex.exe') { [void]$paths.Add($command.Source) }
            # npm installs use a .cmd shim; launch the package's real Windows exe.
            $commandRoot = Split-Path $command.Source -Parent
            foreach ($package in @('codex', 'codex-win32-x64', 'codex-win32-arm64')) {
                [void]$packageRoots.Add((Join-Path $commandRoot "node_modules\@openai\$package"))
            }
        }
    }
    foreach ($package in @('codex', 'codex-win32-x64', 'codex-win32-arm64')) {
        if ($env:APPDATA) { [void]$packageRoots.Add((Join-Path $env:APPDATA "npm\node_modules\@openai\$package")) }
    }
    $knownRoots = @()
    if ($env:LOCALAPPDATA) {
        $existingConfig = Join-Path $env:LOCALAPPDATA 'PdfCopilot\NativeHost\host-config.json'
        if (Test-Path -LiteralPath $existingConfig -PathType Leaf) {
            try {
                $configuredPath = ([IO.File]::ReadAllText($existingConfig) | ConvertFrom-Json).codexPath
                if ($configuredPath -is [string] -and [IO.Path]::IsPathRooted($configuredPath)) { [void]$paths.Add($configuredPath) }
            } catch { } # A malformed old helper configuration must not block discovery.
        }
        [void]$paths.Add((Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin\codex.exe'))
        [void]$paths.Add((Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\codex.exe'))
        $knownRoots += @(
            (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'),
            (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin'),
            (Join-Path $env:LOCALAPPDATA 'PdfCopilot\Codex'),
            (Join-Path $env:LOCALAPPDATA 'PdfCopilot\CodexCLI')
        )
    }
    foreach ($root in @($knownRoots) + @($packageRoots)) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        foreach ($candidate in @(Get-ChildItem -LiteralPath $root -Filter 'codex.exe' -File -Recurse -ErrorAction SilentlyContinue)) {
            [void]$paths.Add($candidate.FullName)
        }
    }
    foreach ($candidate in $paths) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { (Resolve-Path -LiteralPath $candidate).ProviderPath }
    }
}

function Get-CodexVersion([string]$ExecutablePath) {
    $result = [PSCustomObject]@{ Path = $ExecutablePath; Version = $null; DisplayVersion = $null; Error = $null }
    if ([IO.Path]::GetFileName($ExecutablePath) -ine 'codex.exe' -or -not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
        $result.Error = 'Not a Windows codex.exe executable.'
        return $result
    }
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $process.StartInfo.FileName = $ExecutablePath
    $process.StartInfo.Arguments = '--version'
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    try {
        if (-not $process.Start()) { throw 'Could not start executable.' }
        if (-not $process.WaitForExit(5000)) { $process.Kill(); throw 'CLI version check timed out.' }
        $display = $process.StandardOutput.ReadToEnd().Trim()
        # Accept Codex's semver suffixes, comparing its numeric version floor.
        if ($process.ExitCode -ne 0 -or $display.Length -gt 512 -or $display -notmatch '^codex-cli\s+(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
            throw 'Executable did not return a valid codex-cli version.'
        }
        $result.Version = [Version]$Matches[1]
        $result.DisplayVersion = $display
    } catch {
        # Do not echo CLI stderr or raw upstream output: it may contain private data.
        $result.Error = 'Could not verify this Codex CLI with --version.'
    } finally { $process.Dispose() }
    return $result
}
if (-not $ExtensionId) {
    foreach ($idPath in @((Join-Path $projectRoot 'extension-id.txt'), (Join-Path $projectRoot 'dist\extension-id.txt'))) {
        if (Test-Path -LiteralPath $idPath -PathType Leaf) { $ExtensionId = [IO.File]::ReadAllText($idPath).Trim(); break }
    }
}
if ($ExtensionId -notmatch '^[a-p]{32}$') { throw 'Extension ID was not found. Load the extension, copy its ID from edge://extensions or chrome://extensions, and pass -ExtensionId with those 32 letters.' }
$sourceExe = Join-Path $projectRoot 'native-host\bin\PdfCopilotHost.exe'
if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) {
    # Release archives keep the executable next to the installation scripts.
    $sourceExe = Join-Path $projectRoot 'PdfCopilotHost.exe'
}
if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) { $sourceExe = Join-Path $PSScriptRoot 'PdfCopilotHost.exe' }
if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) { throw 'Helper executable not found. Build it with scripts\build-host.ps1 first.' }
if ($CodexPath) {
    # An explicit choice is never replaced silently by another installation.
    $CodexPath = (Resolve-Path -LiteralPath $CodexPath).ProviderPath
    $selectedCodex = Get-CodexVersion $CodexPath
    if ($selectedCodex.Error) { throw "Invalid CodexPath: $CodexPath. It must be a working Windows codex.exe, not a .cmd shim or WSL executable." }
    if ($selectedCodex.Version -lt $requiredCodexVersion) {
        throw "Configured CLI is $($selectedCodex.DisplayVersion) at $CodexPath; this helper requires Codex CLI $requiredCodexVersion or newer. Update this CLI or provide a newer -CodexPath. Login has not been checked."
    }
} else {
    $checked = @(Get-CodexCandidates | ForEach-Object { Get-CodexVersion $_ })
    $compatible = @($checked | Where-Object { $_.Version -and $_.Version -ge $requiredCodexVersion } | Sort-Object @{ Expression = 'Version'; Descending = $true }, @{ Expression = { $_.DisplayVersion -match '^codex-cli\s+\d+\.\d+\.\d+$' }; Descending = $true }, @{ Expression = 'Path'; Descending = $false })
    if ($compatible.Count -eq 0) {
        $known = @($checked | Where-Object { $_.Version } | Sort-Object Version -Descending | ForEach-Object { "$($_.DisplayVersion) at $($_.Path)" })
        $details = if ($known.Count) { ' Found: ' + ($known -join '; ') + '.' } else { ' No verified Windows Codex CLI was found.' }
        throw "This helper requires Codex CLI $requiredCodexVersion or newer.$details Install/update Codex CLI, then rerun installation or pass -CodexPath pointing to codex.exe. Login has not been checked."
    }
    $selectedCodex = $compatible[0]
    $CodexPath = $selectedCodex.Path
}
Write-Host "Selected Codex CLI: $($selectedCodex.DisplayVersion)"
Write-Host "CLI executable: $CodexPath"
Write-Host 'Version check passed. Login will be checked separately in extension settings.'
$installRoot = Join-Path $env:LOCALAPPDATA 'PdfCopilot\NativeHost'
$originIds = @($ExtensionId)
if ($ChromeExtensionId) { $originIds += $ChromeExtensionId }
if ($EdgeExtensionId) { $originIds += $EdgeExtensionId }
$allowedOrigins = @($originIds | Select-Object -Unique | ForEach-Object { "chrome-extension://$_/" })
if ($PSCmdlet.ShouldProcess($installRoot, 'Install PDF Copilot helper and register browser native messaging')) {
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    $installedExe = Join-Path $installRoot 'PdfCopilotHost.exe'
    Copy-Item -LiteralPath $sourceExe -Destination $installedExe -Force
    $configuration = @{ codexPath = $CodexPath; allowedOrigins = $allowedOrigins }
    $manifest = @{ name = 'com.pdfcopilot.codex'; description = 'PDF Copilot Codex helper'; path = $installedExe; type = 'stdio'; allowed_origins = $allowedOrigins }
    # Native host and JSON parsers accept UTF-8 without a BOM.
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $installRoot 'host-config.json'), ($configuration | ConvertTo-Json -Depth 5), $utf8)
    $manifestPath = Join-Path $installRoot 'com.pdfcopilot.codex.json'
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5), $utf8)
    $registryPaths = @()
    if ($Browser -in @('Both', 'Edge')) { $registryPaths += 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.pdfcopilot.codex' }
    if ($Browser -in @('Both', 'Chrome')) { $registryPaths += 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.pdfcopilot.codex' }
    foreach ($registryPath in $registryPaths) { New-Item -Path $registryPath -Force | Out-Null; Set-Item -LiteralPath $registryPath -Value $manifestPath }
    Write-Host 'PDF Copilot helper installed for this Windows user. Reopen the extension and test Codex connection.'
}
