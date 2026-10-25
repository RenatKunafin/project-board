import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyRelease } from '../../scripts/verify-release.mjs';

// Реальный граф git: annotated tag в main и тег отдельной feature-ветки.
const cwd = mkdtempSync(join(tmpdir(), 'pbt-release-gate-'));
const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (message = 'test commit') => {
  git('-c', 'user.name=PBT tests', '-c', 'user.email=pbt@example.invalid', 'commit', '--allow-empty', '-m', message);
  return git('rev-parse', 'HEAD');
};
git('init', '-b', 'main');
const released = commit();
git('-c', 'user.name=PBT tests', '-c', 'user.email=pbt@example.invalid', 'tag', '-a', 'v0.1.0', '-m', 'release');
const main = commit();
git('update-ref', 'refs/remotes/origin/main', main);
git('checkout', '-b', 'feature', released);
const feature = commit('feature commit');
git('tag', 'feature-tag');
const event = { action: 'published', release: { draft: false, tag_name: 'v0.1.0' } };
const valid = { eventName: 'release', event, expectedSha: released, cwd };
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

describe('gate опубликованного релиза', () => {
  it('принимает annotated tag на предке main и возвращает commit, не объект тега', () => {
    expect(verifyRelease(valid)).toEqual({ tag: 'v0.1.0', sha: released });
  });
  it('отклоняет published Release вне main независимо от target_commitish', () => {
    expect(() => verifyRelease({ ...valid, expectedSha: feature,
      event: { action: 'published', release: { draft: false, tag_name: 'feature-tag', target_commitish: 'main' } } })).toThrow(/не входит в main/);
  });
  it('отклоняет сдвинутый относительно события тег', () => {
    expect(() => verifyRelease({ ...valid, expectedSha: main })).toThrow(/Тег изменился/);
  });
  it('push, создание и draft не допускают deployment', () => {
    expect(() => verifyRelease({ ...valid, eventName: 'push' })).toThrow(/только для опубликованного/);
    expect(() => verifyRelease({ ...valid, event: { ...event, action: 'created' } })).toThrow(/только для опубликованного/);
    expect(() => verifyRelease({ ...valid, event: { ...event, release: { ...event.release, draft: true } } })).toThrow(/только для опубликованного/);
  });
  it('не угадывает SHA/тег и не принимает отсутствующую историю main', () => {
    expect(() => verifyRelease({ ...valid, expectedSha: undefined })).toThrow(/SHA события/);
    expect(() => verifyRelease({ ...valid, event: { ...event, release: { ...event.release, tag_name: 'missing' } } })).toThrow();
    git('update-ref', '-d', 'refs/remotes/origin/main');
    try { expect(() => verifyRelease(valid)).toThrow(/история main недоступна/); }
    finally { git('update-ref', 'refs/remotes/origin/main', main); }
  });
});
