# v1.1.2 boot sequence, Windows convenience wrapper around scripts/verify-boot.js:
# a fresh boot; park the pet, restart on the same profile and check he comes back
# to the exact spot; start him through the UI; prove a plain Settings Save neither
# switches him off nor wipes the API keys; a focus session plus a reminder coming
# due; and finally a boot pointed at an RPC endpoint that cannot answer, so the
# loud half of the RPC health rule is exercised too. Every run gets its own
# throwaway profile except the pair that shares one.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\run-boot-seq.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$el = Join-Path $root "node_modules\electron\dist\electron.exe"
$harness = Join-Path $PSScriptRoot "verify-boot.js"
if (-not (Test-Path $el)) { throw "Electron not found at $el - run npm install first." }
# No BOOT_VERIFY_TIMEOUT_MS override: the harness picks its own default (210 s for
# --focus-nudge, which has to wait out a real 10 s reminder poll, 150 s otherwise).
Remove-Item Env:\BOOT_VERIFY_TIMEOUT_MS -ErrorAction SilentlyContinue
$log = Join-Path $env:TEMP "pilly-boot-seq.log"
"boot sequence started $(Get-Date -Format o)" | Set-Content -Path $log -Encoding utf8
$failTotal = 0

# $minChecks is a floor on how many assertions the boot has to have run. It is how
# a mode that silently did nothing gets caught: passing "--flag-a --flag-b" as one
# argument made both flags invisible to the harness, which then booted the app,
# ran the two generic checks and reported a clean pass.
function Run($name, $profile, $flags, $minChecks, $extraEnv = $null) {
  $line = "================ $name ================"
  Write-Output $line
  Add-Content -Path $log -Value $line -Encoding utf8
  $cli = @($harness)
  if ($profile) { $cli += "--user-data-dir=$profile" }
  if ($flags) { $cli += ($flags -split '\s+' | Where-Object { $_ }) }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  # Chromium writes warnings to stderr ("GPU state invalid ...") and a native
  # command's stderr is a terminating error under Stop, so relax it just here.
  # Every line then has to be flattened with ToString(): a merged stderr line
  # arrives as an ErrorRecord, and Out-String renders those with the whole
  # "At C:\... + CategoryInfo : NativeCommandError" decoration. Boot H points
  # Pilly at a dead endpoint on purpose, so that noise is expected output, not a
  # failure - and a red PowerShell error block in a green run reads like one.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    if ($extraEnv) { foreach ($k in $extraEnv.Keys) { Set-Item -Path "Env:\$k" -Value $extraEnv[$k] } }
    $out = ((& $el @cli 2>&1 | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine)
  } finally {
    $ErrorActionPreference = $prev
    if ($extraEnv) { foreach ($k in $extraEnv.Keys) { Remove-Item -Path "Env:\$k" -ErrorAction SilentlyContinue } }
  }
  $elapsed = [int]$sw.Elapsed.TotalSeconds
  Write-Output $out
  Write-Output "---- $name took ${elapsed}s"
  Add-Content -Path $log -Value $out -Encoding utf8
  Add-Content -Path $log -Value "---- $name took ${elapsed}s" -Encoding utf8
  # A boot that never reports itself is a failure even if it exited 0.
  $m = [regex]::Matches($out, "BOOT_VERIFY_DONE checks=(\d+) failures=(\d+)")
  if ($m.Count -eq 0) {
    $script:failTotal += 1000
    Write-Output "FAIL  this boot never printed BOOT_VERIFY_DONE"
    Add-Content -Path $log -Value "FAIL  this boot never printed BOOT_VERIFY_DONE" -Encoding utf8
    return
  }
  $ran = [int]$m[$m.Count - 1].Groups[1].Value
  $script:failTotal += [int]$m[$m.Count - 1].Groups[2].Value
  if ($ran -lt $minChecks) {
    $script:failTotal += 1
    $msg = "FAIL  only $ran checks ran, expected at least $minChecks - did the flags reach the harness?"
    Write-Output $msg
    Add-Content -Path $log -Value $msg -Encoding utf8
  }
}

# --focus-nudge is the one mode that needs a real focus session, so it gets its
# own profile: a session left behind by a crash on a shared one would change what
# the next boot is measuring.
$fresh = Join-Path $env:TEMP "pilly-fresh-$(Get-Random)"
$park = Join-Path $env:TEMP "pilly-park-$(Get-Random)"
$save = Join-Path $env:TEMP "pilly-save-$(Get-Random)"
$fn = Join-Path $env:TEMP "pilly-fn-$(Get-Random)"
$deadRpc = Join-Path $env:TEMP "pilly-rpc-$(Get-Random)"
Run "boot A - fresh profile" $fresh $null 2
Run "boot B - park the pet, then quit" $park "--park-pet" 7
Run "boot C - restart on the same profile" $park "--expect-parked" 3
# Boot D also carries a throwaway .env tier: switching the pet on must not copy
# that key into the settings file (v1.1.2 made the pet writes merge onto the saved
# settings for exactly this reason), and the harness can only check that if there
# is a key in the environment to look for.
Run "boot D - start the pet through the UI" $save "--click-pet" 26 @{
  PILLY_TIER1_URL = "https://env-tier.invalid/v1/chat/completions"
  PILLY_TIER1_KEY = "sk-env-tier-must-not-be-persisted"
  PILLY_TIER1_MODEL = "env-tier-model"
}
Run "boot E - plain Save must not switch him off" $save "--click-save" 30
Run "boot F - repeat the window checks (no save)" $save $null 24
Run "boot G - focus ring + reminder nudge" $fn "--click-pet --focus-nudge" 58
# Boot H: point Pilly at an endpoint that cannot answer (a dead port answers
# instantly, so this does not depend on the machine being offline or online) and
# prove the loud half of the RPC rule - the menu says so and the tooltip carries
# the note. Without this, a healthy endpoint would make that half untestable.
Run "boot H - a dead RPC endpoint is reported" $deadRpc $null 8 @{ PILLY_RPC_URL = "http://127.0.0.1:9" }
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $fresh, $park, $save, $fn, $deadRpc
$verdict = if ($failTotal -eq 0) { "BOOT_SEQ_DONE all checks passed" } else { "BOOT_SEQ_FAILED failures=$failTotal" }
Write-Output $verdict
Add-Content -Path $log -Value $verdict -Encoding utf8
if ($failTotal -ne 0) { exit 1 }
