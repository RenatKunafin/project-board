import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const source = resolve(import.meta.dirname, '..');
const output = join(source, 'test-results/widget-example-report');
mkdirSync(output, { recursive: true });
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
const temporary = mkdtempSync(join(tmpdir(), 'pbt060-widget-'));
const checkout = join(temporary, 'checkout');
const report = { commit, cleanCheckout: true, checks: [], status: 'running' };
let attached = false;
function command(executable, args, cwd = checkout) {
  console.log(`> ${executable} ${args.join(' ')}`);
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const text = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(join(output, 'commands.log'), `> ${executable} ${args.join(' ')}\n${text}\n`, { flag: 'a' });
  if (result.status !== 0) throw new Error(`${executable} ${args.join(' ')} failed: ${text.slice(-5000)}`);
  report.checks.push({ command: [executable, ...args], passed: true });
}
try {
  writeFileSync(join(output, 'commands.log'), `Проверяется HEAD ${commit}; исходный checkout не меняется.\n`);
  command('git', ['worktree', 'add', '--detach', checkout, commit], source); attached = true;
  cpSync(join(checkout, 'examples/counter-widget'), join(checkout, 'packages/counter-widget'), { recursive: true });
  const appPath = join(checkout, 'apps/project-board/package.json');
  const app = JSON.parse(readFileSync(appPath, 'utf8'));
  app.dependencies['@project-board/counter-widget'] = '*';
  writeFileSync(appPath, JSON.stringify(app, null, 2) + '\n');
  const registrationPath = join(checkout, 'apps/project-board/src/widgets.ts');
  const registration = readFileSync(registrationPath, 'utf8');
  writeFileSync(registrationPath, "import { createCounterModule } from '@project-board/counter-widget';\n" +
    registration.replace('  ...createChecklistModule().widgetTypes,', '  ...createCounterModule().widgetTypes,\n  ...createChecklistModule().widgetTypes,'));
  command('npm', ['install', '--package-lock-only', '--ignore-scripts']);
  command('npm', ['ci', '--no-audit', '--no-fund']);
  command('git', ['add', '-N', 'packages/counter-widget']);
  const diff = execFileSync('git', ['diff', '--', 'apps/project-board/package.json', 'apps/project-board/src/widgets.ts', 'package-lock.json', 'packages/counter-widget'], { cwd: checkout, encoding: 'utf8' });
  writeFileSync(join(output, 'integration.patch'), diff);
  const touched = execFileSync('git', ['diff', '--name-only'], { cwd: checkout, encoding: 'utf8' }).trim().split('\n');
  if (touched.some(path => path.startsWith('packages/dashboard/') || path.startsWith('packages/widget-sdk/'))) {
    throw new Error('Пример потребовал изменения платформы или SDK.');
  }
  report.touched = touched;
  command('npm', ['run', 'lint']);
  command('npm', ['run', 'typecheck']);
  // Проверяем подключённую копию; исходный образец не запускаем второй раз.
  command('npm', ['test', '--', '--exclude', 'examples/**']);
  command('npm', ['run', 'build']);
  command(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=tests/widget-example/playwright.config.ts']);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error);
  console.error(error); process.exitCode = 1;
} finally {
  const artifacts = join(checkout, 'test-results/widget-example');
  if (existsSync(artifacts)) cpSync(artifacts, join(output, 'browser'), { recursive: true });
  writeFileSync(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  if (attached) {
    const removal = spawnSync('git', ['worktree', 'remove', '--force', checkout], { cwd: source, encoding: 'utf8' });
    if (removal.status !== 0) {
      console.error(`Временный worktree не удалён: ${checkout}\n${removal.stderr}`); process.exitCode = 1;
    } else rmSync(temporary, { recursive: true, force: true });
  } else rmSync(temporary, { recursive: true, force: true });
}
console.log(`Отчёт: ${output}`);
