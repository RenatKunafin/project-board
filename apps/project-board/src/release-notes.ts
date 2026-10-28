import releaseNotes from './release-notes.json';

export type ReleaseNote = {
  readonly version: string;
  readonly date: string;
  readonly summary: string;
  readonly changes: readonly string[];
};

export type ReleaseNotes = { readonly releases: readonly ReleaseNote[] };

export const RELEASE_NOTES: ReleaseNotes = releaseNotes;

export function isReleaseNotes(value: unknown): value is ReleaseNotes {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { releases?: unknown }).releases)) return false;
  const releases = (value as { releases: unknown[] }).releases;
  return releases.every((release) => {
    if (!release || typeof release !== 'object') return false;
    const item = release as Record<string, unknown>;
    return typeof item.version === 'string' && typeof item.date === 'string'
      && typeof item.summary === 'string' && Array.isArray(item.changes)
      && item.changes.every((change) => typeof change === 'string');
  });
}
