# THREADFORGE — working rules

These apply to every session (human or AI) that changes this repository.

## Every change is recorded here
- Commit every change with a clear message, then `git push origin main` in the same session.
  No work stays only on a local machine or in a zip.
- One logical change per commit (a feature, a fix, a doc update).
- Before pushing: `npm test` must pass. For UI changes also run `npm run test:e2e`.
- After pushing, check the **Test and build** workflow on GitHub Actions. If it fails, fix and push again.

## Releases
- Finishing a roadmap phase (or a fix users need) = a release.
- Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`,
  add a `CHANGELOG.md` section, commit and push.
- Publish the release: `gh release create vX.Y.Z --target main --title "THREADFORGE vX.Y.Z" --notes-file <notes>`
  (or GitHub's "Draft a new release" page). Publishing triggers the build, which attaches the
  Windows `.exe` and `.msi` installers to that release.

## Project map
- `src/` React + TypeScript UI. `src/lib/` engines (raster, embroidery, films, tech pack).
- `src-tauri/` Rust shell (Tauri 2). Signed auto-update is opt-in: see README.
- `tests/` geometry sweep, embroidery byte checks, headless UI suites.
- `DECISIONS.md` records every deviation from the build prompt; add a row when you make one.
