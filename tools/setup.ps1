# ParaVent one-time setup for Windows (PowerShell).
# Run from the repository folder:  powershell -ExecutionPolicy Bypass -File tools\setup.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Need($cmd, $wingetId, $name) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "$name is not installed." -ForegroundColor Yellow
    $a = Read-Host "Install it now with winget? (y/n)"
    if ($a -eq 'y') { winget install --id $wingetId -e --source winget; Write-Host "Close this window, open a new PowerShell and run the setup again." -ForegroundColor Cyan; exit 1 }
    else { Write-Host "Install $name, then run this script again." ; exit 1 }
  }
}
Need git 'Git.Git' 'Git'
Need gh 'GitHub.cli' 'GitHub CLI'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host "Node.js not found (needed for tests and builds). Install with: winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow }

# Authorship and commit hygiene for this repository only
git config user.name  "Ajay Krishnan A"
git config user.email "121338826+ajaykrishnan919@users.noreply.github.com"
git config core.hooksPath tools/git-hooks
git config core.autocrlf false
Write-Host "Git identity and commit-message hook configured for this repository." -ForegroundColor Green

# GitHub sign-in (opens your browser; nothing is stored in this folder)
gh auth status 2>$null
if ($LASTEXITCODE -ne 0) { gh auth login --hostname github.com --git-protocol https --web }
gh auth setup-git

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Open Claude Code in this folder and say:  publish ParaVent to GitHub"
