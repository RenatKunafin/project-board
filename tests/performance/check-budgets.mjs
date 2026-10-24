import { readFile } from 'node:fs/promises';

const directory = 'test-results/release-performance';
const names = ['A', 'B', 'A-interactions'];
let failed = false;
const environment = JSON.parse(await readFile(`${directory}/environment.json`, 'utf8'));
if (environment.headless) throw new Error('Headless results cannot qualify the headed release benchmark');
for (const name of names) {
  const data = JSON.parse(await readFile(`${directory}/${name}.json`, 'utf8'));
  if (data.runId !== environment.runId) throw new Error(`Mixed or stale run: ${name}`);
  if (name === 'A-interactions' && data.interactions?.gestureFailure) { failed = true; process.stdout.write('FAIL A-interactions: gesture did not complete/stabilize; see raw results\n'); }
  if (process.env.PBT_BENCH_RUN_ID && data.runId !== process.env.PBT_BENCH_RUN_ID) throw new Error(`Stale results: ${name}`);
  const visit = (value, path) => {
    if (!value || typeof value !== 'object') return;
    if ('budget' in value) {
      process.stdout.write(`${value.passes ? 'PASS' : 'FAIL'} ${path}: median=${value.median.toFixed(1)}, p95=${value.p95.toFixed(1)}, budget=${value.budget}\n`);
      if (!value.passes) failed = true;
    }
    for (const [key, child] of Object.entries(value)) {
      if (!Array.isArray(child)) visit(child, `${path}.${key}`);
    }
  };
  visit(data, name);
}
if (failed) {
  process.stderr.write('Бюджеты PBT-058 не выполнены; raw результаты сохранены. Требуется отдельная оптимизация или явное решение владельца.\n');
  process.exitCode = 1;
}
