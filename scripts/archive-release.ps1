param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../artifacts/releases')) + [System.IO.Path]::DirectorySeparatorChar
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
if (-not $sourcePath.StartsWith($releaseRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not $destinationPath.StartsWith($releaseRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Release paths must stay inside artifacts/releases.'
}
Compress-Archive -LiteralPath $sourcePath -DestinationPath $destinationPath -Force
