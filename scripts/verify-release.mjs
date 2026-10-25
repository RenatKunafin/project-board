import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Проверяет фактический тег и историю git, а не target_commitish из описания Release. */
export function verifyRelease({ eventName, event, expectedSha, cwd = process.cwd() }) {
  if (eventName !== 'release' || event.action !== 'published' || event.release?.draft !== false) {
    throw new Error('Deployment допускается только для опубликованного GitHub Release.');
  }
  const tag = event.release.tag_name;
  if (typeof tag !== 'string' || !tag) throw new Error('У релиза отсутствует тег.');
  if (!/^[a-f\d]{40}$/i.test(expectedSha ?? '')) throw new Error('Нет корректного SHA события release.');
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['check-ref-format', `refs/tags/${tag}`]);
  const sha = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  if (sha !== expectedSha.toLowerCase()) throw new Error('Тег изменился: SHA не совпадает с событием Release.');
  try { git(['merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main']); }
  catch { throw new Error(`Коммит ${sha} не входит в main либо история main недоступна.`); }
  return { tag, sha };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = verifyRelease({
    eventName: process.env.GITHUB_EVENT_NAME,
    event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    expectedSha: process.env.GITHUB_SHA,
  });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sha=${result.sha}\n`);
  console.log(JSON.stringify(result));
}
