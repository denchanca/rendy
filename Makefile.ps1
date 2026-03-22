param(
  [ValidateSet('Help','Setup-Venv','Install-Minimal','Demo-CSV-Pinecone','Demo-CSV-Postgres')]
  [string]$Task = 'Help',
  [string]$CsvPath = "${PWD}\training-files\demo\sample.csv",
  [string]$PineconeIndex = 'rendy-demo',
  [string]$Namespace = 'default'
)

$ErrorActionPreference = 'Stop'
$venvPath = Join-Path $PSScriptRoot '.venv'
$venvPy = Join-Path $venvPath 'Scripts\python.exe'

function Ensure-Venv {
  if (!(Test-Path $venvPy)) {
    Write-Host 'Creating virtual environment (.venv)...'
    python -m venv $venvPath
  }
}

function Install-Reqs {
  Ensure-Venv
  & $venvPy -m pip install --upgrade pip
  & $venvPy -m pip install -r (Join-Path $PSScriptRoot 'ETL\CSV-SQL\requirements.txt')
}

function Install-MinimalPkgs {
  Ensure-Venv
  & $venvPy -m pip install --upgrade pip
  & $venvPy -m pip install openai pinecone-client pandas tqdm requests
}

function Load-DotEnv {
  $dotenv = Join-Path $PSScriptRoot '.env'
  if (Test-Path $dotenv) {
    Write-Host 'Loading .env into process environment'
    Get-Content $dotenv | ForEach-Object {
      if ($_ -match '^[#;]') { return }
      if ($_ -match '^(\s*)$') { return }
      if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
        $k = $matches[1]
        $v = $matches[2]
        # Trim surrounding quotes
        if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length-2) }
        if ($v.StartsWith("'") -and $v.EndsWith("'")) { $v = $v.Substring(1, $v.Length-2) }
        [Environment]::SetEnvironmentVariable($k, $v)
      }
    }
  }
}

function Demo-CSVToPinecone {
  Load-DotEnv
  if (-not $env:OPENAI_API_KEY -or -not $env:PINECONE_API_KEY) {
    throw 'OPENAI_API_KEY and PINECONE_API_KEY must be set (in .env or environment).'
  }
  Ensure-Venv
  $script = Join-Path $PSScriptRoot 'ETL\CSV-SQL\csv_to_pinecone_all_columns.py'
  Write-Host "Dry run preview (3 rows) => $CsvPath"
  & $venvPy $script --csv $CsvPath --index $PineconeIndex --namespace $Namespace --dry-run --preview 3
}

function Demo-CSVToPostgres {
  Load-DotEnv
  foreach ($k in 'PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE') {
    if (-not [Environment]::GetEnvironmentVariable($k)) { throw "Missing $k (set in .env or environment)" }
  }
  Ensure-Venv
  $script = Join-Path $PSScriptRoot 'ETL\CSV-SQL\csv_to_postgres_marts.py'
  & $venvPy $script
}

switch ($Task) {
  'Help' {
    @'
Usage:
  # List tasks
  powershell -ExecutionPolicy Bypass -File .\Makefile.ps1 Help

  # Setup venv and install full requirements (CSV/Postgres flows)
  powershell -ExecutionPolicy Bypass -File .\Makefile.ps1 Setup-Venv

  # Install minimal packages (JSON/GitHub/Sitemap flows)
  powershell -ExecutionPolicy Bypass -File .\Makefile.ps1 Install-Minimal

  # Run CSV -> Pinecone demo (dry run) on sample.csv
  powershell -ExecutionPolicy Bypass -File .\Makefile.ps1 Demo-CSV-Pinecone -CsvPath .\training-files\demo\sample.csv -PineconeIndex rendy-demo -Namespace default

  # Run CSV -> Postgres demo (uses PG* and CSV_PATH from .env if present)
  powershell -ExecutionPolicy Bypass -File .\Makefile.ps1 Demo-CSV-Postgres
'@ | Write-Host
  }
  'Setup-Venv' { Install-Reqs }
  'Install-Minimal' { Install-MinimalPkgs }
  'Demo-CSV-Pinecone' { Demo-CSVToPinecone }
  'Demo-CSV-Postgres' { Demo-CSVToPostgres }
}
