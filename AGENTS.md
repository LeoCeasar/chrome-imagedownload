# Repository Guidelines

## Project Structure & Module Organization
- Root: `manifest.json`, `README.md`, `plan.md`.
- Source: `src/`
  - UI: `popup.html/.js/.css`, `sidepanel.html/.js`
  - Runtime: `content-script.js`, `background.js`
  - Payments: `extpay.js` (stub or vendor), `pay.js`, `pay-info.html`
- No external build system; load as an unpacked Chrome extension.

## Build, Test, and Development Commands
- Run locally: Chrome → `chrome://extensions` → Enable Developer Mode → Load unpacked → select repo root.
- Pack (optional): `zip -r dist.zip manifest.json src/ webp2jpeg.html README.md`.
- Git workflow:
  - Create branch: `git checkout -b feat/<topic>`
  - Push: `git push -u origin feat/<topic>`
  - PR (GitHub CLI): `gh pr create --base main --head feat/<topic>`

## Coding Style & Naming Conventions
- Language: Plain JS (MV3), HTML, CSS. Indentation: 2 spaces.
- Filenames: kebab-case (e.g., `sidepanel.js`, `content-script.js`).
- Prefer small, focused modules under `src/`. Avoid global leakage; keep helpers in dedicated files (e.g., `pay.js`).
- Keep DOM IDs/classes consistent with existing patterns; avoid inline styles.

## Testing Guidelines
- No formal test suite. Do manual verification:
  - Content scan works across pages; sidepanel receives live updates.
  - Downloads succeed for original/JPEG; JPEG quality slider applies.
  - Paywall: non-paid limited to 5 images/day; paid bypasses limit.
  - Hover preview shows single image and metadata; list shows one image per row.
- Consider adding lightweight e2e checks with Puppeteer in a future CI.

## Commit & Pull Request Guidelines
- Commit style: Conventional Commits (e.g., `feat(popup): one row per image`, `fix: correct MV3 script paths`).
- PRs should include:
  - Summary, rationale, and screenshots/GIFs for UI changes.
  - Linked issues (if any) and clear test steps.
  - Scope discipline: change only what the PR describes.

## Security & Configuration Tips
- ExtPay: `src/extpay.js` is a stub; replace with official vendor script for production. Initialize via `extpay.startBackground()` in `background.js`.
- Permissions: uses `<all_urls>`, `downloads`, `storage`, `sidePanel`. Be conservative with network requests and headers.
- CSP: avoid inline scripts; keep logic in `src/*.js` files.
