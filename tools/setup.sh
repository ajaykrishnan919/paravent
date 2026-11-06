#!/usr/bin/env bash
# ParaVent one-time setup for macOS / Linux.   Run from anywhere:  bash tools/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null 2>&1 || { echo "$2 is not installed. Install it ($3), then run this script again."; exit 1; }; }
need git "Git" "https://git-scm.com/downloads"
need gh "GitHub CLI" "macOS: brew install gh · Linux: https://cli.github.com"
command -v node >/dev/null 2>&1 || echo "Note: Node.js not found (needed for tests and builds): https://nodejs.org"

# Authorship and commit hygiene for this repository only
git config user.name  "Ajay Krishnan A"
git config user.email "121338826+ajaykrishnan919@users.noreply.github.com"
git config core.hooksPath tools/git-hooks
chmod +x tools/git-hooks/commit-msg
echo "Git identity and commit-message hook configured for this repository."

# GitHub sign-in (opens your browser; nothing is stored in this folder)
gh auth status >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git

echo
echo "Setup complete."
echo "Open Claude Code in this folder and say:  publish ParaVent to GitHub"
