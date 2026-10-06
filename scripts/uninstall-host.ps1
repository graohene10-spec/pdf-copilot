[CmdletBinding(SupportsShouldProcess)]
param()
$ErrorActionPreference = 'Stop'
$installRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'PdfCopilot\NativeHost'))
$expectedParent = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'PdfCopilot'))
if ([IO.Path]::GetDirectoryName($installRoot) -ine $expectedParent -or [IO.Path]::GetFileName($installRoot) -ine 'NativeHost') { throw 'Unexpected helper installation path; nothing was removed.' }
if ($PSCmdlet.ShouldProcess($installRoot, 'Unregister and remove PDF Copilot native helper')) {
    foreach ($registryPath in @('HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.pdfcopilot.codex', 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.pdfcopilot.codex')) {
        if (Test-Path -LiteralPath $registryPath) {
            $registeredManifest = (Get-Item -LiteralPath $registryPath).GetValue('')
            if ($registeredManifest -ieq (Join-Path $installRoot 'com.pdfcopilot.codex.json')) { Remove-Item -LiteralPath $registryPath -Force }
        }
    }
    # Delete known helper files only. Preserve unknown user-created files and Codex itself.
    foreach ($fileName in @('PdfCopilotHost.exe', 'host-config.json', 'com.pdfcopilot.codex.json')) {
        $filePath = Join-Path $installRoot $fileName
        if (Test-Path -LiteralPath $filePath -PathType Leaf) { Remove-Item -LiteralPath $filePath -Force }
    }
    if ((Test-Path -LiteralPath $installRoot) -and @(Get-ChildItem -LiteralPath $installRoot -Force).Count -eq 0) { Remove-Item -LiteralPath $installRoot -Force }
    Write-Host 'PDF Copilot helper removed. Codex login and browser extension settings were preserved.'
}
