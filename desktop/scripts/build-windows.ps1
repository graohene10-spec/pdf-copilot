[CmdletBinding()]
param([switch]$Test)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskToolchain = [System.IO.Path]::GetFullPath((Join-Path $taskRoot '..\..\..\tmp\phydog-toolchain'))
if (Test-Path -LiteralPath (Join-Path $taskToolchain 'cargo\bin\cargo.exe')) {
    $env:CARGO_HOME = Join-Path $taskToolchain 'cargo'
    $env:RUSTUP_HOME = Join-Path $taskToolchain 'rustup'
    $env:PATH = (Join-Path $taskToolchain 'cargo\bin') + ';' + $env:PATH
}
$taskVs = Join-Path $taskToolchain 'vs'
$taskDevShell = Join-Path $taskVs 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
if (Test-Path -LiteralPath $taskDevShell) {
    Import-Module -Name $taskDevShell
    Enter-VsDevShell -VsInstallPath $taskVs -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
}
Push-Location $taskRoot
try {
    if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) { throw 'Install the Rust MSVC toolchain before building.' }
    if ($Test) {
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) { throw 'AI tests failed.' }
        & cargo.exe test --manifest-path src-tauri\Cargo.toml
        if ($LASTEXITCODE -ne 0) { throw 'Native tests failed.' }
    }
    & npm.cmd run desktop:build
    if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
} finally { Pop-Location }
