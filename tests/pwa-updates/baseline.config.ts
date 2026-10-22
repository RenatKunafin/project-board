import { defineConfig, loadConfigFromFile, mergeConfig } from 'vite';
import { resolve } from 'node:path';

// Настоящие исходники PBT-028; aliases не дают workspace symlink взять новое ядро.
export default defineConfig(async (environment) => {
  const root = process.env.PBT_BASELINE_ROOT!;
  const app = resolve(root, 'apps/project-board');
  const previous = await loadConfigFromFile(environment, resolve(app, 'vite.config.ts'));
  return mergeConfig(previous!.config, {
    root: app,
    resolve: { alias: Object.fromEntries(['dashboard', 'widget-sdk', 'checklist', 'gantt'].map((name) => [
      `@project-board/${name}`, resolve(root, 'packages', name, 'src/index.ts'),
    ])) },
  });
});
