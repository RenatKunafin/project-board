#!/usr/bin/env node
/**
 * Сборка переносимых артефактов стенда PBT-121 (D7):
 * статическая браузерная панель + npm tarball сервера + manifest с хешами.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const webOut = resolve(root, '.cache/agent-integration/web');
const artifactsDir = resolve(root, '.cache/agent-integration/artifacts');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function sha256(file) {
  const digest = createHash('sha256').update(await readFile(file)).digest('hex');
  return digest;
}

async function collectFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(full, base)));
    else files.push({ path: full.replace(base + '/', ''), file: full });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

// 1. Сервер: чистая установка при отсутствии lockfile-инсталла, сборка, tarball.
await mkdir(artifactsDir, { recursive: true });
run('npm', ['install', '--no-fund', '--no-audit'], { cwd: resolve(root, 'tests/agent-integration/server') });
run('npm', ['run', 'build'], { cwd: resolve(root, 'tests/agent-integration/server') });
run('npm', ['pack', '--pack-destination', artifactsDir], { cwd: resolve(root, 'tests/agent-integration/server') });

// 2. Браузерная панель.
run('npx', ['vite', 'build', '--config', 'tests/agent-integration/web/build.config.ts']);

// 3. Manifest артефактов: источник, хеши, состав.
const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const commit = gitHead.status === 0 ? gitHead.stdout.trim() : 'unknown';
const packed = (await readdir(artifactsDir)).filter((name) => name.endsWith('.tgz'));
const manifest = {
  commit,
  createdAt: new Date().toISOString(),
  server: {
    package: 'project-board-agent-probe-server@0.1.0',
    node: process.version,
    tarball: packed[0] ?? null,
    tarballSha256: packed[0] ? await sha256(resolve(artifactsDir, packed[0])) : null,
  },
  web: {
    base: process.env.AGENT_PROBE_BASE ?? '/',
    files: [],
  },
};
for (const entry of await collectFiles(webOut)) {
  manifest.web.files.push({ path: entry.path, sha256: await sha256(entry.file) });
}
await mkdir(artifactsDir, { recursive: true });
await writeFile(resolve(artifactsDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Артефакты стенда готовы: ${artifactsDir} (commit ${commit.slice(0, 8)})`);
