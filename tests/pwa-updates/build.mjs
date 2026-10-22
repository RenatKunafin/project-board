import { access, mkdir, mkdtemp, realpath, symlink, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

function command(executable, args, env = {}) {
  const result = spawnSync(executable, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${executable} failed (${result.status})`);
}

const output = resolve('.cache/pwa-updates');
await mkdir(output, { recursive: true });
for (const version of ['A', 'B']) {
  command('npm', ['run', 'build', '-w', 'apps/project-board', '--', '--config', '../../tests/pwa-updates/build.config.ts',
    '--outDir', join(output, version), '--emptyOutDir'], { PBT_UPDATE_VERSION: version });
}

const baseline = await realpath(await mkdtemp(join(tmpdir(), 'pbt-029-baseline-')));
try {
  const archive = spawnSync('git', ['archive', 'c3494ba'], { maxBuffer: 100 * 1024 * 1024 });
  if (archive.status !== 0) throw new Error('Не удалось извлечь baseline PBT-028.');
  const unpack = spawnSync('tar', ['-x', '-C', baseline], { input: archive.stdout });
  if (unpack.status !== 0) throw new Error('Не удалось распаковать baseline.');
  await symlink(resolve('node_modules'), join(baseline, 'node_modules'), 'dir');
  for (const directory of ['apps/project-board', 'packages/dashboard', 'packages/widget-sdk', 'packages/checklist', 'packages/gantt']) {
    const dependencies = resolve(directory, 'node_modules');
    if (await access(dependencies).then(() => true, () => false)) {
      await symlink(dependencies, join(baseline, directory, 'node_modules'), 'dir');
    }
  }
  command('npm', ['run', 'build', '-w', 'apps/project-board', '--', '--config', '../../tests/pwa-updates/baseline.config.ts',
    '--outDir', join(output, 'baseline'), '--emptyOutDir'], { PBT_BASELINE_ROOT: baseline });
} finally {
  await rm(baseline, { recursive: true, force: true });
}
