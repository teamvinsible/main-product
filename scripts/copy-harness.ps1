$ErrorActionPreference = "Stop"
$src = "C:\Users\ansi2\Desktop\Experiment\harness-doctl"
$dst = "C:\Users\ansi2\Documents\teamvinsible\packages\harness-doctl"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
robocopy $src $dst /E /XD node_modules dist .git /NFL /NDL /NJH /NJS /nc /ns /np
$code = $LASTEXITCODE
Write-Host "robocopy_exit=$code"
if ($code -ge 8) { exit $code }
Write-Host "harness-doctl copied"
Get-ChildItem $dst -Name
