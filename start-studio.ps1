$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskNodeCommand = Get-Command node -ErrorAction SilentlyContinue
$taskNodePath = if ($taskNodeCommand) { $taskNodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' }
if (!(Test-Path -LiteralPath $taskNodePath)) { throw 'Node.js 22 또는 24를 설치한 뒤 다시 실행하세요.' }
if (!(Test-Path -LiteralPath 'node_modules/next/dist/bin/next')) { throw '먼저 이 폴더에서 pnpm install --frozen-lockfile을 실행하세요.' }
& $taskNodePath 'node_modules/next/dist/bin/next' dev --hostname 127.0.0.1 --port 3210
