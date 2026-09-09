$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$schemaNames = @(
    'episode-package-v2.1.schema.json',
    'external-ai-result-v2.1.schema.json',
    'shot-package-v2.1.schema.json'
)

foreach ($schemaName in $schemaNames) {
    $schemaPath = Join-Path $PSScriptRoot $schemaName
    $rootSchema = Get-Content -LiteralPath $schemaPath -Raw | ConvertFrom-Json
    $versionSchema = $rootSchema.properties.version | ConvertTo-Json -Compress

    $stringVersionAccepted = Test-Json -Json '"2.1"' -Schema $versionSchema -ErrorAction SilentlyContinue
    $numericVersionAccepted = Test-Json -Json '2.1' -Schema $versionSchema -ErrorAction SilentlyContinue
    $otherStringAccepted = Test-Json -Json '"2.2"' -Schema $versionSchema -ErrorAction SilentlyContinue

    if (-not $stringVersionAccepted) {
        throw "$schemaName must accept string version `"2.1`"."
    }
    if ($numericVersionAccepted) {
        throw "$schemaName must reject numeric version 2.1."
    }
    if ($otherStringAccepted) {
        throw "$schemaName must reject unsupported string versions."
    }

    Write-Output "$schemaName VERSION_CONTRACT_OK"
}
