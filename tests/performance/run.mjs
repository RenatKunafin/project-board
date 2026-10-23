import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { cpus, totalmem, release, arch } from 'node:os';
import { createHash } from 'node:crypto';

const runId = new Date().toISOString();
process.env.PBT_BENCH_RUN_ID = runId;
const args = process.argv.slice(2);
const directory = 'openspec/changes/pbt-058-release-performance/results';
await mkdir(directory, { recursive: true });
const environment = {
  runId, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version, osRelease: release(), arch: arch(), cpu: cpus()[0].model, memoryBytes: totalmem(),
  headless: process.env.PBT_BENCH_HEADLESS === '1', args,
  lockfileSha256: createHash('sha256').update(await readFile('package-lock.json')).digest('hex'),
};
await writeFile(`${directory}/environment.json`, JSON.stringify(environment, null, 2) + '\n');
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.performance.config.ts', ...args], { stdio: 'inherit', env: process.env });
const code = await new Promise((resolve, reject) => {
  child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
});
if (code) process.exitCode = code;
else if (args.length) process.stdout.write('Диагностический выборочный прогон: общий итог бюджетов не вычисляется.\n');
else await import('./check-budgets.mjs');
