$ErrorActionPreference = "Stop"
$src = "C:\Users\ansi2\Desktop\Experiment\agent-swarm"
$dst = "C:\Users\ansi2\Documents\teamvinsible\packages\swarm"

New-Item -ItemType Directory -Force -Path $dst | Out-Null
New-Item -ItemType Directory -Force -Path "C:\Users\ansi2\Documents\teamvinsible\packages\shared\src" | Out-Null
New-Item -ItemType Directory -Force -Path "C:\Users\ansi2\Documents\teamvinsible\apps\web\src" | Out-Null
New-Item -ItemType Directory -Force -Path "C:\Users\ansi2\Documents\teamvinsible\apps\api\src" | Out-Null

robocopy $src $dst /E `
  /XD node_modules dist .swarm .git .agents .claude .codex `
  /XF .env `
  /NFL /NDL /NJH /NJS /nc /ns /np

# robocopy exit codes 0-7 are success
$code = $LASTEXITCODE
Write-Host "robocopy_exit=$code"
if ($code -ge 8) { exit $code }

# Remove nested web node_modules/dist if copied
Remove-Item -Recurse -Force "$dst\web\node_modules" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$dst\web\dist" -ErrorAction SilentlyContinue

Write-Host "=== swarm package root ==="
Get-ChildItem $dst -Name
Write-Host "done"
