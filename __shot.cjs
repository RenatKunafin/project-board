
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 3100, height: 1050 } });
  await page.goto('file:///tmp/pb-plantuml-reference.svg');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'openspec/changes/pbt-055-plantuml-generator/screenshots/reference-render.png', fullPage: true });
  await browser.close();
})();
