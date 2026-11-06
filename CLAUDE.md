# ParaVent: notes for Claude Code

ParaVent is a browser-based parametric perforation generator. The owner and sole author is **Ajay Krishnan A** (GitHub: `ajaykrishnan919`).

## Authorship rules (always)

- Commits are authored and committed as `Ajay Krishnan A <121338826+ajaykrishnan919@users.noreply.github.com>`. Check with `git config user.name` / `git config user.email` before committing. If they differ, set them locally in this repository (not globally).
- **Never** add `Co-Authored-By: Claude`, `Claude-Session:`, "Generated with Claude Code" or any other AI attribution to commits, pull requests, releases or files. `.claude/settings.json` turns attribution off, and `tools/git-hooks/commit-msg` strips such lines as a safety net. Make sure the hook is active: `git config core.hooksPath` must print `tools/git-hooks`.
- Never force-push `main` or rewrite pushed history without asking first.

## Project layout

| Path | Purpose |
|---|---|
| `src/core.js` | Geometry core (patterns, fillets, regions, SVG/DXF/STEP writers). No dependencies, no DOM. |
| `src/app.html` | Editor UI. The core is inlined at the `/*CORE*/` marker. |
| `index.html` | **Built file** served by GitHub Pages. Regenerate with `npm run build` and commit it. |
| `test/core.test.mjs` | Unit tests (`npm test`). |
| `test/validate_step.py` | OpenCascade check of sample STEP files (`npm run validate:step`, needs `pip install cadquery-ocp`). |
| `examples/` | Example presets (`*.paravent.json`) and SVG outlines. |

Before every commit: `npm test` and `npm run build`, then commit `index.html` together with the source change. CI fails if `index.html` is stale.

## Publishing to GitHub

When asked to "publish", "push" or "upload" ParaVent, follow these steps in order and report each result:

1. **Check tools:** `git --version`, `gh --version`, `gh auth status`. If `gh` is not signed in, ask the user to run `gh auth login` (do not handle their credentials).
2. **Check the work:** `npm test` and `npm run build`. Stop and report if tests fail. Commit any changes, following the authorship rules above.
3. **Make sure the GitHub repository is called `paravent`:**
   - `gh repo view ajaykrishnan919/paravent` succeeds → use it.
   - Otherwise, if `gh repo view ajaykrishnan919/ventforge` succeeds → rename it: `gh repo rename paravent --repo ajaykrishnan919/ventforge --yes`. GitHub keeps redirects from the old name.
   - Otherwise create it: `gh repo create ajaykrishnan919/paravent --public --description "ParaVent: parametric vent and perforation pattern generator with gradients, shape morphing, G2 fillets and solid STEP/DXF/SVG export. Runs in the browser."`
4. **Push:** `git remote set-url origin https://github.com/ajaykrishnan919/paravent.git` (or `git remote add origin …` if missing), then `git push -u origin main`.
5. **Turn on the live app (GitHub Pages) if it is not already on:**
   - Check: `gh api repos/ajaykrishnan919/paravent/pages`
   - Enable: `gh api -X POST repos/ajaykrishnan919/paravent/pages -f build_type=legacy -f "source[branch]=main" -f "source[path]=/"`
6. **Repository details:** `gh repo edit ajaykrishnan919/paravent --homepage https://ajaykrishnan919.github.io/paravent/ --add-topic perforation --add-topic vent --add-topic parametric-design --add-topic step --add-topic dxf --add-topic cad --add-topic laser-cutting --add-topic cnc`
7. **Verify and report:** the repository URL, the commit author (`git log -1 --format='%an <%ae>'`), that the last commit message has no AI attribution, and the live-app URL `https://ajaykrishnan919.github.io/paravent/`. The first Pages build can take a minute or two; check with `gh api repos/ajaykrishnan919/paravent/pages --jq .status`.
