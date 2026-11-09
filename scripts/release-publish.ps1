# Finalises the PillCrew 1.2.1 release: adds the checksums of every uploaded file to the notes and publishes the draft.
$ErrorActionPreference = 'Stop'
$git = 'C:\Users\krais\AppData\Local\GitHubDesktop\app-3.6.4\resources\app\git\cmd\git.exe'
$lines = "protocol=https`nhost=github.com`n`n" | & $git credential fill 2>$null
$token = ($lines | Where-Object { $_ -match '^password=' }) -replace '^password=', ''
if (-not $token) { throw 'no cached GitHub credential' }
$env:GH_TOKEN = $token
$api = 'https://api.github.com/repos/PillCrew/PillCrew'

$release = Invoke-RestMethod -Uri "$api/releases/439681088" -Headers @{ Authorization = "token $token" }
"draft: $($release.draft)  tag: $($release.tag_name)"

$assets = $release.assets | Sort-Object name
foreach ($a in $assets) {
  $digest = ($a.digest -replace '^sha256:', '')
  "- {0}  {1} bytes  sha256:{2}" -f $a.name, $a.size, $digest
}

$linesOut = $assets | ForEach-Object {
  $digest = ($_.digest -replace '^sha256:', '')
  "- ``$($_.name)`` — $($_.size) bytes`n  ``sha256:$digest``"
}

$body = $release.body
$head, $rest = $body -split '## Checksums', 2
$newBody = @"
$head## Checksums

Windows was built, tested and verified on the maintainer's machine against Smart App Control (**allowed**, second look in
the cloud) and those are the exact bytes below. macOS and Linux were built by GitHub Actions from the same commit, and the
CI run that produced them is green on Windows and Ubuntu.

$($linesOut -join "`n")

Read [CHANGELOG.md](https://github.com/PillCrew/PillCrew/blob/main/CHANGELOG.md) for the whole story, and
[docs/BUMP.md](https://github.com/PillCrew/PillCrew/blob/main/docs/BUMP.md) before running a bump.

> Trade small. Practice Mode is free and uses fake SOL; meme coins are extremely risky and this is a tool, not a promise.
"@

$payload = @{ body = $newBody; draft = $false } | ConvertTo-Json -Depth 4
$tmp = Join-Path $env:TEMP 'pc-release-publish.json'
Set-Content -Path $tmp -Value $payload -Encoding utf8
$done = Invoke-RestMethod -Method Patch -Uri "$api/releases/439681088" -Headers @{ Authorization = "token $token" } -ContentType 'application/json' -InFile $tmp
"published: draft=$($done.draft)  url=$($done.html_url)"
"assets: $(($done.assets | ForEach-Object { $_.name }) -join ', ')"
