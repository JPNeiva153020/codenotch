[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$TauriCliPath,
    [switch]$Debug,
    [switch]$AllowDependencyDownload
)
$ErrorActionPreference = 'Stop'
$crate = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\codenotch'))
$config = Get-Content -LiteralPath (Join-Path $crate 'tauri.conf.json') -Raw | ConvertFrom-Json
if ($config.identifier -ne 'com.codenotch.geminiweb' -or $config.mainBinaryName -ne 'codenotch-gemini-web') {
    throw 'Unexpected distribution identity; refusing to package.'
}
if (@($config.plugins.updater.endpoints).Count -ne 0 -or $config.bundle.windows.nsis.installMode -ne 'currentUser') {
    throw 'Expected a manual-update, per-user distribution.'
}
$cli = (Resolve-Path -LiteralPath $TauriCliPath).Path
$version = & node $cli --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^tauri-cli 2\.12\.0$') {
    throw 'Use the pinned official @tauri-apps/cli 2.12.0 in a separate tools directory.'
}
$arguments = @($cli, 'build', '--ci', '--bundles', 'nsis')
if ($Debug) { $arguments += '--debug' }
$arguments += '--'
if (-not $AllowDependencyDownload) { $arguments += '--offline' }
$arguments += @('--locked', '--jobs', '1')
$previousJobs = $env:CARGO_BUILD_JOBS
try {
    $env:CARGO_BUILD_JOBS = '1'
    Push-Location -LiteralPath $crate
    try {
        & node @arguments
        if ($LASTEXITCODE -ne 0) { throw "Tauri build failed: $LASTEXITCODE" }
    } finally { Pop-Location }
} finally { $env:CARGO_BUILD_JOBS = $previousJobs }
