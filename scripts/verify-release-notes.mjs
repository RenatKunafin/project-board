import { readFile } from 'node:fs/promises';

const path = new URL('../apps/project-board/src/release-notes.json', import.meta.url);
const { releases } = JSON.parse(await readFile(path, 'utf8'));
if (!Array.isArray(releases) || releases.length === 0) throw new Error('Release notes must contain at least one release.');
const seen = new Set();
for (const [index, release] of releases.entries()) {
  if (!release || typeof release.version !== 'string' || !/^v\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(release.version)) {
    throw new Error(`Release ${index + 1} must have a valid version tag.`);
  }
  if (seen.has(release.version)) throw new Error(`Duplicate release notes version: ${release.version}`);
  seen.add(release.version);
  if (typeof release.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(release.date)) throw new Error(`${release.version} must have an ISO date.`);
  if (typeof release.summary !== 'string' || !release.summary.trim()) throw new Error(`${release.version} must have a summary.`);
  if (!Array.isArray(release.changes) || release.changes.length === 0 || release.changes.some((change) => typeof change !== 'string' || !change.trim())) {
    throw new Error(`${release.version} must have at least one non-empty change.`);
  }
}
console.log(`Validated ${releases.length} release notes entries.`);
const requestedVersion = process.argv.find((argument) => argument.startsWith('--version='))?.slice('--version='.length);
if (requestedVersion && !seen.has(requestedVersion)) throw new Error(`Missing release notes for published tag ${requestedVersion}.`);
if (requestedVersion) console.log(`Release notes found for ${requestedVersion}.`);
