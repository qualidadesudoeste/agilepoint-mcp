param(
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (-not $OutputDirectory) { $OutputDirectory = (Split-Path -Parent $projectRoot) }
$outputRoot = (Resolve-Path -LiteralPath $OutputDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string]$manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Versão inválida no package.json.' }
$archivePath = Join-Path $outputRoot "agilepoint-mcp-$version.zip"
if (Test-Path -LiteralPath $archivePath) { throw "O pacote já existe: $archivePath" }

function Add-TextEntry($Archive, [string]$Name, [string]$Text) {
  $entry = $Archive.CreateEntry($Name, [System.IO.Compression.CompressionLevel]::Optimal)
  $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
  try { $writer.WriteLine($Text) } finally { $writer.Dispose() }
}

Push-Location $projectRoot
try {
  foreach ($arguments in @(@('ci'), @('test'), @('run', 'test:discovery'), @('run', 'smoke'), @('audit', '--omit=dev', '--audit-level=low'))) {
    & npm @arguments
    if ($LASTEXITCODE -ne 0) { throw "Falha na verificação: npm $($arguments -join ' ')" }
  }

  # Lista fechada para a distribuição de execução. Histórico, fontes e testes ficam fora.
  $fileMap = [ordered]@{
    'README.md' = 'docs/README_TESTADORES.md'
    'LIMITACOES_CONHECIDAS.md' = 'docs/LIMITACOES_TESTADORES.md'
    'DICA_DE_MESTRE.md' = 'docs/DICA_DE_MESTRE.md'
    'Instalar.ps1' = 'Instalar.ps1'
    'instalar.mjs' = 'instalar.mjs'
    'capabilities.json' = 'capabilities.developer-all-accessible.example.json'
    'scripts/approve.mjs' = 'scripts/approve.mjs'
    'scripts/smoke.mjs' = 'scripts/smoke.mjs'
    'scripts/installer-upgrade.mjs' = 'scripts/installer-upgrade.mjs'
  }
  foreach ($file in Get-ChildItem -LiteralPath (Join-Path $projectRoot 'dist') -File -Filter '*.js') {
    if ($file.Name -in @('apf-kit.js', 'apf-artifacts.js', 'apf-workbook.js', 'apf-guided.js')) { continue }
    $fileMap[('dist/' + $file.Name)] = 'dist/' + $file.Name
  }
  foreach ($relative in $fileMap.Values) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relative) -PathType Leaf)) {
      throw "Arquivo obrigatório ausente: $relative"
    }
  }

  $runtimeManifestJson = & node scripts/runtime-package.mjs manifest
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar manifesto de execução.' }
  $runtimeLockJson = & node scripts/runtime-package.mjs lock
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar lockfile de execução.' }

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::Open($archivePath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Add-TextEntry $archive 'package.json' ($runtimeManifestJson -join [Environment]::NewLine)
    Add-TextEntry $archive 'package-lock.json' ($runtimeLockJson -join [Environment]::NewLine)
    foreach ($entryName in $fileMap.Keys) {
      $source = Join-Path $projectRoot $fileMap[$entryName]
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $source, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $archive.Dispose() }

  $verification = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    $expected = @('package.json', 'package-lock.json') + @($fileMap.Keys)
    $actual = @($verification.Entries | ForEach-Object FullName)
    if (@(Compare-Object ($expected | Sort-Object) ($actual | Sort-Object)).Count) { throw 'Conteúdo inesperado no pacote.' }
    if ($actual -match 'COBERTURA_PENDENTE|INSTRUCOES_OUTRO_CHAT|(^|/)\.env|^src/|scripts/test|create-release|descobrir-endpoints') {
      throw 'Arquivo interno encontrado na distribuição de testadores.'
    }
  } finally { $verification.Dispose() }

  Write-Output "Pacote: $archivePath"
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($archivePath)
  try { $hash = [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '') }
  finally { $stream.Dispose(); $sha256.Dispose() }
  Write-Output "SHA-256: $hash"
} finally { Pop-Location }
