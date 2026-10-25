import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Запускается явно при изменении знака/токенов. Сборка использует готовые
// файлы, поэтому установка браузера не становится требованием npm run build.
const app = new URL('../apps/project-board/', import.meta.url);
const tokens = await readFile(new URL('src/tokens.css', app), 'utf8');
const source = await readFile(new URL('pwa/icon.svg', app), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(`<style>${tokens}</style>`);
  const palette = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const color = (token) => {
      ctx.fillStyle = styles.getPropertyValue(token).trim();
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    };
    return { chrome: color('--chrome'), background: color('--background'), primary: color('--primary') };
  });
  const svg = source.replaceAll('var(--chrome)', palette.chrome).replaceAll('var(--primary)', palette.primary);
  const output = new URL('public/icons/', app);
  await mkdir(output, { recursive: true });
  await writeFile(new URL('icon.svg', output), svg);
  for (const [filename, size] of [['pwa-192.png', 192], ['pwa-512.png', 512], ['maskable-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const data = await page.evaluate(async ({ svg, size }) => {
      const image = new Image();
      image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { svg, size });
    await writeFile(new URL(filename, output), Buffer.from(data, 'base64'));
  }
  await writeFile(new URL('pwa/colors.json', app), `${JSON.stringify(palette, null, 2)}\n`);
  // Лицензия распространяется вместе с производными иконками.
  await writeFile(new URL('LICENSE-lucide.txt', output), await readFile(new URL('../node_modules/lucide-react/LICENSE', import.meta.url)));
  console.log('Иконки и цвета PWA созданы из pwa/icon.svg и tokens.css.');
} finally {
  await browser.close();
}
