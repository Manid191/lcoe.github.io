"""Capture baseline screenshots for chart UI review.

Usage:
  python scripts/capture_chart_baseline.py [base_url]
"""
from __future__ import annotations

import sys

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError
except ModuleNotFoundError:
    print(
        "Missing dependency: playwright\n"
        "Install with:\n"
        "  python -m pip install -r scripts/requirements-dev.txt\n"
        "  python -m playwright install chromium",
        file=sys.stderr,
    )
    raise SystemExit(1)

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173/index.html'

try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1600, "height": 1900})
        page.goto(BASE_URL, wait_until='networkidle', timeout=45_000)

        page.click("button[onclick*=\"results-tab\"]")
        page.wait_for_timeout(1200)
        page.screenshot(path='artifacts/baseline-results-tab.png', full_page=True)

        page.click("button[onclick*=\"payback-tab\"]")
        page.wait_for_timeout(1200)
        page.screenshot(path='artifacts/baseline-payback-tab.png', full_page=True)

        browser.close()
except PWTimeoutError:
    print(
        f"Failed to load page for baseline capture: {BASE_URL}\n"
        "Make sure the app server is running, for example:\n"
        "  python -m http.server 4173",
        file=sys.stderr,
    )
    raise SystemExit(2)
