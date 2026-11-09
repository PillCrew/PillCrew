# Creates the GitHub release for PillCrew 1.2.1 and uploads the Windows files that were built and SAC-checked on this machine.
# The token comes from git's own credential store and is never printed. Assets are added one by one; the release is created as a
# draft so macOS and Linux can be attached before anybody sees it.
param(
  [string]$Tag = 'v1.2.1',
  [string[]]$Files = @(
    'C:\Users\krais\OneDrive\Pulpit\PROJEKT\sniperv3\PillCrewSniper\dist\PillCrew-1.2.1-win-x64.exe',
    'C:\Users\krais\OneDrive\Pulpit\PROJEKT\sniperv3\PillCrewSniper\dist\PillCrew-1.2.1-portable-win-x64.exe'
  ),
  [switch]$Publish
)
$ErrorActionPreference = 'Stop'
$git = 'C:\Users\krais\AppData\Local\GitHubDesktop\app-3.6.4\resources\app\git\cmd\git.exe'
$lines = "protocol=https`nhost=github.com`n`n" | & $git credential fill 2>$null
$token = ($lines | Where-Object { $_ -match '^password=' }) -replace '^password=', ''
if (-not $token) { throw 'no cached GitHub credential' }
$env:GH_TOKEN = $token
$headers = @{ Authorization = "token $token"; Accept = 'application/vnd.github+json' }
$api = 'https://api.github.com/repos/PillCrew/PillCrew'

$hashes = foreach ($f in $Files) {
  $h = (Get-FileHash $f -Algorithm SHA256).Hash.ToLower()
  [pscustomobject]@{ name = (Split-Path $f -Leaf); bytes = (Get-Item $f).Length; sha256 = $h }
}

$notes = @'
**PillCrew 1.2.1 — one program.** Pilly Desktop and PillCrew Sniper are the same application now: the sniper, the bump
desk, the AI council on your own keys, and Pilly on your taskbar. One installer, one wallet, one settings file.

## Install

| Platform | File |
| --- | --- |
| Windows 10/11 (x64) | `PillCrew-1.2.1-win-x64.exe` — installs for your user, no admin rights |
| Windows 10/11 (x64), no install | `PillCrew-1.2.1-portable-win-x64.exe` |
| macOS 12+ | `PillCrew-1.2.1-mac-*.dmg` — Intel (`x64`), Apple silicon (`arm64`) or `universal` |
| Linux x64 | `PillCrew-1.2.1-linux-x86_64.AppImage` or `PillCrew-1.2.1-linux-amd64.deb` |

The builds are **not code signed**. Windows SmartScreen may ask once (*More info → Run anyway*); on a machine with Smart App
Control turned on, an installer downloaded from the internet can be refused outright — the portable file, or a build made on
your own machine, gets round it. macOS: right-click → **Open** the first time.

## What is in this release

- **One program.** The trading desk keeps its engine and its rules; the whole of Pilly Desktop came inside it — the Chat tab
  with all thirteen quick actions, your own endpoints, the free-model finder, the look controls and the language lock, and the
  mascot panel with every setting he has. A profile from the old `PillCrew Sniper` is copied across on first boot; nothing is
  deleted and nothing has to be set up again.
- **The sniper** watches every new Pump.fun and PumpSwap coin and scores it 0–100, judging coins four times a second and exits
  forty times a second. Every refusal says why.
- **The bump desk** runs volume for one token from wallets the app creates itself, through a single desk address, and prints
  the cost of the whole run before a lamport moves. It is honest about what it is: real buys and real sells, about 3.5 % of
  each round trip going to the curve and the trade door.
- **The council** asks your own models in parallel: one `VETO` refuses, a failed tier is reported as failed, and silence is
  never consent. Keys stay on your disk and never enter a settings code.
- **Pilly** walks the taskbar, naps, gets spooked, drags where you leave him, and reports the hot radar, the fresh launches,
  the morning brief, his pick, whale alerts and his mood — plus a **scorecard** that keeps his losses as well as his wins.

## Fixed in 1.2.1

- The chat no longer prints the same sentence twice when only one model answers.
- Saving the chat's look really stores it (the save used to throw in the main process before writing anything).
- Pilly's hop stays inside his own window — his hat was being cut off by the top edge — and his walk turns around short of the
  screen edge instead of parking him in the corner.
- The scorecard's four numbers sit in one row, and two chat colours now use this app's own theme instead of a fallback violet.
- The window loads with no console errors at all; a new boot test starts the real application on a scratch profile and refuses
  any startup error.

## Checksums

These are the exact bytes built and tested on the maintainer's machine (Smart App Control: **allowed**, second look):

'@

foreach ($h in $hashes) { $notes += "`n- ``$($h.name)`` — $($h.bytes) bytes`n  ``sha256:$($h.sha256)``" }

$notes += @'


Read [CHANGELOG.md](https://github.com/PillCrew/PillCrew/blob/main/CHANGELOG.md) for the whole story, and
[docs/BUMP.md](https://github.com/PillCrew/PillCrew/blob/main/docs/BUMP.md) before running a bump.

> Trade small. Practice Mode is free and uses fake SOL; meme coins are extremely risky and this is a tool, not a promise.

'@

$body = @{
  tag_name = $Tag
  target_commitish = 'main'
  name = 'PillCrew 1.2.1 — one program'
  body = $notes
  draft = (-not $Publish)
  prerelease = $false
} | ConvertTo-Json -Depth 4

$tmp = Join-Path $env:TEMP 'pc-release.json'
Set-Content -Path $tmp -Value $body -Encoding utf8
$release = Invoke-RestMethod -Method Post -Uri "$api/releases" -Headers $headers -ContentType 'application/json' -InFile $tmp
"release: $($release.html_url)  draft=$($release.draft)"

$uploadUrl = ($release.upload_url -replace '\{.*\}$', '')
foreach ($h in $hashes) {
  $file = $Files | Where-Object { (Split-Path $_ -Leaf) -eq $h.name }
  $uri = "$uploadUrl?name=$($h.name)"
  $resp = curl.exe -s -X POST -H "Authorization: token $env:GH_TOKEN" -H "Content-Type: application/octet-stream" --data-binary "@$file" $uri | ConvertFrom-Json
  if ($resp.state -eq 'uploaded') { "uploaded: $($resp.name)  $([math]::Round($resp.size/1MB,1)) MB" } else { "UPLOAD FAILED: $($resp.message) $($resp.errors | Out-String)" }
}

"done. draft=$(-not $Publish)"
