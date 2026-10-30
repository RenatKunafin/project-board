import type { Note } from './model';

const invalidFilename = /[\u0000-\u001f\u007f\\/:*?"<>|]/gu;
const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export function markdownFilename(title: string): string {
  let name = title.replace(invalidFilename, '_').replace(/^[ .]+|[ .]+$/gu, '');
  let prefix = '';
  for (const point of name) {
    if (new TextEncoder().encode(prefix + point).length > 180) break;
    prefix += point;
  }
  name = prefix.replace(/[ .]+$/gu, '') || 'note';
  if (windowsReserved.test(name)) name = `_${name}`;
  return `${name}.md`;
}

export function serializeNoteMarkdown(note: Pick<Note, 'title' | 'body' | 'tags'>): string {
  return `# ${note.title}\n\n${note.body}${note.tags.length ? `\n\n${note.tags.map(tag => `#${tag}`).join(' ')}` : ''}\n`;
}

export function downloadNoteMarkdown(note: Pick<Note, 'title' | 'body' | 'tags'>): void {
  const blob = new Blob([serializeNoteMarkdown(note)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = markdownFilename(note.title);
  anchor.hidden = true;
  try {
    document.body.append(anchor);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    anchor.remove();
  }
}
