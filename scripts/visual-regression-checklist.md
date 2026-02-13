# Visual Regression Checklist (Charts)

Run this checklist before merge whenever chart UI/export logic changes.

## 0) Prerequisites
- Install Python dependency:
  - `python -m pip install -r scripts/requirements-dev.txt`
- Install browser runtime for Playwright:
  - `python -m playwright install chromium`
- Serve app locally (from repo root):
  - `python -m http.server 4173`
- Optional one-command baseline capture:
  - `bash scripts/run_visual_baseline.sh`

## 1) Baseline capture
- Capture **Results tab** with LCOE + Generation charts visible.
- Capture **Payback tab** with controls visible.
- Capture export outputs for each preset:
  - `ppt` (1920x1080)
  - `report` (1600x1200)
  - `native`

## 2) What to verify
- Typography consistency: title, legend, axis labels readable.
- Chart container spacing and borders are consistent.
- Exported images include white background + title + generated timestamp.
- File names include preset and timestamp suffix.
- Copy-to-clipboard shows success message on supported browsers.

## 3) Pass/Fail template
- [ ] Results tab baseline matches expected layout
- [ ] Payback tab baseline matches expected layout
- [ ] Export preset: ppt
- [ ] Export preset: report
- [ ] Export preset: native
- [ ] Clipboard supported path works
- [ ] Clipboard unsupported path shows fallback message
