import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

const directory = resolve(process.argv[2] ?? 'apps/project-board/dist');
const base = '/project-board/';
const origin = 'https://pages.invalid';
const entry = new URL(base, origin);
const files = [];
function walk(path) {
  for (const name of readdirSync(path)) {
    const file = resolve(path, name);
    if (statSync(file).isDirectory()) walk(file);
    else files.push(relative(directory, file).split(sep).join('/'));
  }
}
walk(directory);
for (const file of files) {
  if (file.startsWith('assets/pages-generation-')) throw new Error('В публичный артефакт попал тестовый JS-probe.');
  if (!/^(index\.html|manifest\.webmanifest|sw\.js|workbox-[\w-]+\.js|assets\/[^/]+|icons\/[^/]+)$/.test(file)) {
    throw new Error(`Неожиданный файл публичного артефакта: ${file}`);
  }
}
function resource(value, parent = entry) {
  const url = new URL(value, parent);
  if (url.origin !== origin || !url.pathname.startsWith(base)) throw new Error(`Ресурс вне base: ${value}`);
  const path = decodeURIComponent(url.pathname.slice(base.length));
  if (!files.includes(path) || !existsSync(resolve(directory, path))) throw new Error(`Ресурс отсутствует: ${value}`);
  return url;
}
const html = readFileSync(resolve(directory, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) resource(match[1]);
const manifestUrl = resource('manifest.webmanifest');
const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.webmanifest'), 'utf8'));
for (const key of ['id', 'start_url', 'scope']) {
  if (new URL(manifest[key], key === 'id' ? origin : manifestUrl).href !== entry.href) throw new Error(`Неверный manifest.${key}`);
}
for (const icon of manifest.icons) resource(icon.src, manifestUrl);
for (const file of files.filter(file => file.endsWith('.css'))) {
  const css = readFileSync(resolve(directory, file), 'utf8');
  for (const match of css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) {
    if (!match[1].startsWith('data:')) resource(match[1], new URL(file, entry));
  }
}
const sw = readFileSync(resolve(directory, 'sw.js'), 'utf8');
if (!/importScripts\([^)]*pwa-update-guard-/.test(sw)) throw new Error('SW не подключает update guard.');
for (const match of sw.matchAll(/importScripts\(([^)]+)\)/g)) {
  for (const script of match[1].matchAll(/["']([^"']+)["']/g)) resource(script[1]);
}
const main = files.find(file => /^assets\/index-[\w-]+\.js$/.test(file));
if (!main) throw new Error('Нет основного bundle.');
const code = readFileSync(resolve(directory, main), 'utf8');
if (code.includes('counter-example') || code.includes('update-fixture')) throw new Error('В продукт попала учебная/тестовая комплектация.');
console.log(`Pages artifact PASS: ${files.length} файлов, base ${base}, manifest/guard/fonts/icons доступны.`);
