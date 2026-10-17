param(
    [string]$ExtensionId = ""
)

$ErrorActionPreference = "Stop"

function Find-GeminiWebExtensionId {
    $edgeUserData = Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data"
    if (-not (Test-Path $edgeUserData)) {
        return $null
    }

    $prefFiles = @()
    Get-ChildItem -Path $edgeUserData -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        foreach ($fileName in @("Secure Preferences", "Preferences")) {
            $candidate = Join-Path $_.FullName $fileName
            if (Test-Path $candidate) {
                $prefFiles += $candidate
            }
        }
    }

    foreach ($file in $prefFiles) {
        try {
            $raw = Get-Content -Path $file -Raw -Encoding UTF8 -ErrorAction Stop
            $json = $raw | ConvertFrom-Json -ErrorAction Stop
            $settings = $json.extensions.settings
            if (-not $settings) { continue }

            foreach ($prop in $settings.PSObject.Properties) {
                $id = $prop.Name
                if ($id -notmatch '^[a-p]{32}$') { continue }
                $entry = $prop.Value
                $extPath = [string]$entry.path
                $extName = [string]$entry.manifest.name
                if (
                    ($extPath -and ($extPath -match 'prototype-edge[\\/]?$')) -or
                    ($extName -eq "Codenotch Gemini Web Prototype") -or
                    ($extName -like "Gemini Web*leitura local*")
                ) {
                    return $id
                }
            }
        } catch {
            continue
        }
    }
    return $null
}

$resolvedId = $ExtensionId.Trim().ToLowerInvariant()
if (-not $resolvedId) {
    $resolvedId = Find-GeminiWebExtensionId
}

if (-not $resolvedId -or ($resolvedId -notmatch '^[a-p]{32}$')) {
    throw "Nao foi possivel detectar automaticamente um ExtensionId valido (32 letras a-p). Informe -ExtensionId <id>."
}

$hostCmdPath = (Resolve-Path (Join-Path $PSScriptRoot "host.cmd")).Path
$manifestDir = Join-Path $env:APPDATA "codenotch\native-host"
New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null

$manifestPath = Join-Path $manifestDir "com.codenotch.gemini_web.json"
$manifestObj = [ordered]@{
    name = "com.codenotch.gemini_web"
    description = "Codenotch Gemini Web Native Messaging Host"
    path = $hostCmdPath
    type = "stdio"
    allowed_origins = @(
        "chrome-extension://$resolvedId/"
    )
}

$manifestJson = $manifestObj | ConvertTo-Json -Depth 4
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8NoBom)

$registryKeys = @(
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.codenotch.gemini_web",
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.codenotch.gemini_web"
)

foreach ($regKey in $registryKeys) {
    if (-not (Test-Path $regKey)) {
        New-Item -Path $regKey -Force | Out-Null
    }
    Set-ItemProperty -Path $regKey -Name "(Default)" -Value $manifestPath
}

Write-Output "REGISTERED_EXTENSION_ID=$resolvedId"
Write-Output "MANIFEST_PATH=$manifestPath"
Write-Output "HOST_CMD_PATH=$hostCmdPath"
