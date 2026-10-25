import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
for (const version of ['A', 'B']) {
  const result = spawnSync('npm', ['run', 'build', '-w', 'apps/project-board', '--', '--config', '../../tests/pages/build.config.ts',
    '--outDir', resolve('.cache/pages', version), '--emptyOutDir'], {
    stdio: 'inherit', env: { ...process.env, PBT_PAGES_VERSION: version },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
