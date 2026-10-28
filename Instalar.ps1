param(
  [string]$Cliente = 'detectar',
  [string]$Destino,
  [string]$Dados,
  [string]$Config,
  [switch]$Preparar,
  [switch]$UsarNodePortatil
)

$ErrorActionPreference = 'Stop'
$nodeExecutable = $null
if (-not $UsarNodePortatil) {
  $existingNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($existingNode) {
    $nodeVersion = & $existingNode.Source --version
    if ($LASTEXITCODE -eq 0 -and $nodeVersion -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22) {
      $nodeExecutable = $existingNode.Source
    }
  }
}

if (-not $nodeExecutable) {
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'This installer requires 64-bit Windows.' }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
  $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 120
  $release = $releases | Where-Object { $_.lts -and $_.version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22 -and $_.files -contains "win-$architecture-zip" } | Select-Object -First 1
  if (-not $release -or $release.version -notmatch '^v\d+\.\d+\.\d+$') { throw 'No compatible official Node.js LTS release found.' }
  $runtimeParent = Join-Path $env:LOCALAPPDATA 'AgilePointMCP\runtime'
  New-Item -ItemType Directory -Path $runtimeParent -Force | Out-Null
  $folderName = "node-$($release.version)-win-$architecture"
  $runtimePath = Join-Path $runtimeParent $folderName
  $nodeExecutable = Join-Path $runtimePath 'node.exe'
  if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
    $stagingPath = Join-Path $runtimeParent ('download-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stagingPath | Out-Null
    $fileName = "$folderName.zip"
    $archivePath = Join-Path $stagingPath $fileName
    $baseUri = "https://nodejs.org/dist/$($release.version)"
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUri/$fileName" -OutFile $archivePath -TimeoutSec 300
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri "$baseUri/SHASUMS256.txt" -TimeoutSec 120).Content
    $checksumLine = @($checksums -split "`n" | Where-Object { $_.Trim() -match ('^[a-fA-F0-9]{64}\s+' + [regex]::Escape($fileName) + '$') })
    if ($checksumLine.Count -ne 1) { throw 'Official checksum not found.' }
    $expectedHash = ($checksumLine[0].Trim() -split '\s+')[0].ToUpperInvariant()
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($archivePath)
    try { $actualHash = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
    if ($actualHash -ne $expectedHash) { throw 'Node.js checksum mismatch; installation stopped.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
      foreach ($entry in $archive.Entries) {
        $name = $entry.FullName.Replace('\', '/')
        if ($name -match '(^/|^[A-Za-z]:|(^|/)\.\.(/|$))') { throw 'Unsafe path in Node.js archive.' }
      }
    } finally { $archive.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $stagingPath)
    if (Test-Path -LiteralPath $runtimePath) { throw 'Runtime destination already exists; no existing runtime was replaced.' }
    $resolvedSource = (Resolve-Path -LiteralPath (Join-Path $stagingPath $folderName)).Path
    $resolvedParent = (Resolve-Path -LiteralPath $runtimeParent).Path
    $resolvedTarget = [IO.Path]::GetFullPath($runtimePath)
    if ((Split-Path -Parent $resolvedTarget) -ne $resolvedParent -or (Split-Path -Parent $resolvedSource) -ne (Resolve-Path -LiteralPath $stagingPath).Path) { throw 'Unexpected runtime paths.' }
    Move-Item -LiteralPath $resolvedSource -Destination $resolvedTarget
    # Delete only the verified staging directory created by this invocation.
    $resolvedStaging = (Resolve-Path -LiteralPath $stagingPath).Path
    $resolvedParent = (Resolve-Path -LiteralPath $runtimeParent).Path
    if ((Split-Path -Parent $resolvedStaging) -ne $resolvedParent -or (Split-Path -Leaf $resolvedStaging) -notmatch '^download-[a-f0-9]{32}$') { throw 'Unexpected staging path.' }
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
  }
}

$installer = Join-Path $PSScriptRoot 'instalar.mjs'
$arguments = @($installer, '--cliente', $Cliente)
if ($Destino) { $arguments += @('--destino', $Destino) }
if ($Dados) { $arguments += @('--dados', $Dados) }
if ($Config) { $arguments += @('--config', $Config) }
if ($Preparar) { $arguments += '--preparar' }
& $nodeExecutable @arguments
exit $LASTEXITCODE
