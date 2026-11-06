# Contributing to ParaVent

Thanks for helping improve ParaVent.

## Ground rules

- **Exports must stay valid.** Any change that touches geometry must keep every sample STEP file valid in OpenCascade (`npm run validate:step`) and must not break existing presets.
- **No runtime dependencies.** `src/core.js` is plain JavaScript with no imports, so it runs both in the browser and in Node.
- **Millimetres and Y-up** everywhere in the core. Outer loops run counter-clockwise, hole loops clockwise.

## Workflow

1. Fork and create a branch from `main`.
2. Make your change in `src/core.js` and/or `src/app.html`.
3. Add or update tests in `test/core.test.mjs`.
4. Run:
   ```bash
   npm test
   npm run build              # regenerates index.html; commit it
   npm run validate:step      # if you changed geometry (needs: pip install cadquery-ocp)
   ```
5. Open a pull request that explains the use case (process, material, thickness) and what you verified.

## Reporting bugs

Please attach the preset (**Save preset** → `.paravent.json`), the browser and version, and, for export problems, the CAD software and the error it reports.
