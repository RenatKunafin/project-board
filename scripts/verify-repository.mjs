import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
const read = path => readFileSync(join(root, path), 'utf8');
const list = path => readdirSync(join(root, path), { withFileTypes: true });
const images = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm']);
function walk(path) {
  for (const item of list(path)) {
    const name = `${path}/${item.name}`;
    if (item.isDirectory()) walk(name);
    else check(!images.has(extname(name).toLowerCase()), `OpenSpec содержит UI-артефакт: ${name}`);
  }
}
walk('openspec');
check(!existsSync(join(root, '.docs')), 'Документация должна находиться в docs/');
check(!existsSync(join(root, 'apps/load-demo')), 'Завершённый load-demo не должен возвращаться');
const pkg = JSON.parse(read('package.json'));
check(!JSON.stringify(pkg).includes('load-demo'), 'npm scripts всё ещё ссылаются на load-demo');
const lock = JSON.parse(read('package-lock.json'));
check(!lock.packages?.['apps/load-demo'], 'lockfile содержит удалённый workspace load-demo');

// Включаем новые файлы рабочего дерева, но не игнорируемые локальные артефакты.
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean).filter(path => existsSync(join(root, path)) && statSync(join(root, path)).isFile());
let links = 0;
for (const path of files) {
  // Исторические команды остаются текстом; ссылки должны разрешаться
  // и в архиве, без обязательной локальной .context.
  if (!path.endsWith('.md')) continue;
  const text = read(path).replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, '').split(/\s+['"]/)[0];
    if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith('#')) continue;
    const target = decodeURIComponent(raw.split('#')[0]);
    if (!target) continue;
    links++;
    check(!target.includes('.docs/'), `${path}: старый путь ${target}`);
    check(!target.includes('.context/'), `${path}: обязательная ссылка на локальный материал ${target}`);
    const absolute = target.startsWith('/') ? join(root, target) : resolve(root, dirname(path), target);
    check(existsSync(absolute), `${path}: отсутствует ссылка ${target}`);
  }
}
for (const path of files.filter(path => path.startsWith('tests/') || path.startsWith('scripts/'))) {
  if (!/\.(ts|tsx|mjs|cjs)$/.test(path)) continue;
  const text = read(path);
  check(!/path:\s*['"`]openspec\//.test(text), `${path}: тест пишет артефакт в OpenSpec`);
}
const canonical = '.agents/skills';
const names = list(canonical).filter(item => item.isDirectory()).map(item => item.name).sort();
for (const name of names) {
  const path = `${canonical}/${name}/SKILL.md`;
  check(existsSync(join(root, path)), `${name}: нет SKILL.md`);
  if (!existsSync(join(root, path))) continue;
  const text = read(path);
  const header = text.match(/^---\n([\s\S]*?)\n---/);
  check(!!header, `${path}: нет frontmatter`);
  if (!header) continue;
  check(/^name:\s*(.+)$/m.exec(header[1])?.[1] === name, `${path}: name не совпадает с директорией`);
  check(/^[a-z\d]+(?:-[a-z\d]+)*$/.test(name) && name.length <= 64, `${path}: неверное имя`);
  check((/^description:\s*(.+)$/m.exec(header[1])?.[1]?.length ?? 0) > 0, `${path}: нет description`);
  const alias = join(root, '.claude/skills', name);
  check(existsSync(alias) && realpathSync(alias) === realpathSync(join(root, canonical, name)), `${name}: Claude не подключён к общему источнику`);
}
for (const match of read('CLAUDE.md').matchAll(/^@(.+)$/gm)) {
  check(existsSync(join(root, match[1])), `CLAUDE.md: отсутствует импорт ${match[1]}`);
}
const opencode = JSON.parse(read('opencode.json'));
for (const pattern of opencode.instructions ?? []) {
  if (pattern.endsWith('/*.md')) {
    check(existsSync(join(root, pattern.slice(0, -5))) && list(pattern.slice(0, -5)).some(item => item.name.endsWith('.md')), `OpenCode: пустой набор ${pattern}`);
  } else check(existsSync(join(root, pattern)), `OpenCode: отсутствует ${pattern}`);
}
check(!existsSync(join(root, '.opencode/skills')), 'Не хранить отдельную копию общих скиллов в .opencode');
for (const item of list('.opencode/commands')) {
  if (!item.name.endsWith('.md')) continue;
  const text = read(`.opencode/commands/${item.name}`);
  const target = text.match(/\.agents\/skills\/[^/]+\/SKILL\.md/);
  check(!!target && existsSync(join(root, target[0])), `${item.name}: alias не ведёт к общему скиллу`);
}
if (errors.length) {
  console.error(errors.join('\n')); process.exitCode = 1;
} else console.log(`Repository PASS: ${links} локальных ссылок, ${names.length} общих скиллов, OpenSpec без UI-артефактов.`);
