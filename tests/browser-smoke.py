"""Optional browser QA, requires Python Playwright + a Chromium executable.
Run: python3 tests/browser-smoke.py --chromium /usr/bin/chromium
No external services. Opens the actual file:// app and blocks HTTP(S) traffic.
"""
import argparse
import csv
import io
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--chromium', default='/usr/bin/chromium')
parser.add_argument('--screenshots', default=None, help='Optional screenshot output directory')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
errors = []
requests = []
checks = []

def check(condition, description):
    assert condition, description
    checks.append(description)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: requests.append(r.url) if r.url.startswith(('http:', 'https:')) else None)
    context.route('http://**/*', lambda route: route.abort())
    context.route('https://**/*', lambda route: route.abort())
    page.goto((root / 'index.html').as_uri())
    check(page.locator('#profit').inner_text() == '¥34.78', 'Default contribution profit')
    check(page.locator('#break-even').inner_text() == '¥61.92', 'Break-even rounded up to cents')
    check(page.locator('#target-price').inner_text() == '¥78.58', 'Target price rounded up to cents')
    check(page.locator('#margin').inner_text() == '35.35%', 'Margin uses retained revenue')
    check(page.locator('#damage-total').inner_text() == '¥1.67', 'Damage includes refund revenue loss')
    if args.screenshots:
        out = Path(args.screenshots); out.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(out / 'desktop.png'), full_page=True)
    page.locator('#price').fill('0')
    check(page.locator('#margin').inner_text() == '不适用', 'Zero-price undefined margin')
    page.locator('#price').fill('-1')
    check(page.locator('#result-content').is_hidden(), 'Negative input hides stale results')
    check(page.locator('#save').is_disabled() and page.locator('#export').is_disabled(), 'Invalid input disables save and export')
    check(page.locator('#price').get_attribute('aria-invalid') == 'true', 'Accessible invalid field')
    page.locator('#price').fill('')
    check(page.locator('#error-summary').is_visible(), 'Blank required field rejected')
    page.locator('#reset').click()
    check(page.locator('#profit').inner_text() == '¥34.78', 'Reset restores sample')
    page.locator('#scenario-name').fill('=HYPERLINK("x","y"),测试')
    page.locator('#save').click()
    page.locator('#price').fill('109')
    page.locator('#scenario-name').fill('<img src=x onerror=alert(1)>')
    page.locator('#save').click()
    check(page.locator('#comparison tbody tr').count() == 3, 'Comparison keeps current + snapshots')
    check(page.locator('#comparison tbody tr').nth(1).locator('td').nth(2).inner_text() == '¥34.78', 'Snapshot does not change with input')
    check(page.locator('#comparison img').count() == 0, 'Scenario labels cannot inject HTML')
    with page.expect_download() as event:
        page.locator('#export').click()
    download = event.value
    path = download.path()
    raw = Path(path).read_bytes()
    check(raw.startswith(b'\xef\xbb\xbf'), 'UTF-8 BOM for Chinese CSV')
    rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
    check(len(rows) == 4 and len(rows[0]) == len(rows[1]), 'CSV includes current and saved rows with all fields')
    check(rows[2][0].startswith("'="), 'CSV formula prefix neutralized')
    check(rows[3][0] == '<img src=x onerror=alert(1)>', 'CSV correctly preserves ordinary names')
    page.locator('#save').click(); page.locator('#save').click()
    check(page.locator('#save').is_disabled(), 'Four-snapshot limit enforced')
    page.locator('.delete-button').first.click()
    check(page.locator('#save').is_enabled(), 'Remove permits new snapshot')
    page.locator('#reset').click()
    check(page.locator('#comparison tbody tr').count() == 4, 'Reset preserves saved scenarios')
    page.locator('#breakageRate').fill('100'); page.locator('#reshipShare').fill('0')
    check(page.locator('#margin').inner_text() == '不适用', 'Full refund has no defined margin')
    check(page.locator('#break-even').inner_text() == '不可达', 'Full-refund positive-cost break-even unreachable')
    check(page.locator('#target-price').inner_text() == '不可达', 'Full-refund target unreachable')
    page.locator('#reset').click()
    for field in ['product', 'packaging', 'shipping', 'commissionRate', 'paymentRate', 'fixedFee', 'advertising', 'other', 'breakageRate', 'reshipProduct', 'reshipPackaging', 'reshipShipping', 'reshipOther', 'refundExtra']:
        page.locator(f'#{field}').fill('0')
    page.locator('#targetMargin').fill('100')
    check(page.locator('#target-price').inner_text() == '¥0.01 起', 'Zero-cost 100% target requires positive cent price')
    check('目标利润率不可达' not in page.locator('#result-warning').inner_text(), 'Infimum does not show false unreachable warning')
    page.locator('#monthlyOrders').fill('1.5')
    check(page.locator('#monthlyOrders').get_attribute('aria-invalid') == 'true', 'Fractional order count rejected')
    page.locator('#reset').click()
    page.set_viewport_size({'width': 390, 'height': 844})
    check(page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), '390px viewport has no document overflow')
    check(page.locator('#profit').inner_text() == '¥34.78', 'Mobile state consistent')
    if args.screenshots:
        page.screenshot(path=str(out / 'mobile.png'), full_page=True)
    page.set_viewport_size({'width': 320, 'height': 740})
    check(page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), '320px viewport has no document overflow')
    page.reload()
    check(page.locator('#comparison tbody tr').count() == 1, 'Reload clears session-only scenarios')
    check(not requests, f'No network requests: {requests}')
    check(not errors, f'No browser JavaScript errors: {errors}')
    browser.close()
print(f'PASS: {len(checks)} browser checks')
for item in checks:
    print(f'  ✓ {item}')
