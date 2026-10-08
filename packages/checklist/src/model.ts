export interface ChecklistItem {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
}

export interface ChecklistContent {
  /** Название списка (задаётся при создании через каталог). */
  readonly title?: string;
  readonly items: readonly ChecklistItem[];
}

export const emptyChecklistContent: ChecklistContent = { items: [] };

function isChecklistContent(value: unknown): value is ChecklistContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as ChecklistContent).items)
  );
}

export function parseChecklistContent(value: unknown): ChecklistContent {
  return isChecklistContent(value) ? value : emptyChecklistContent;
}

export function checklistTitle(value: unknown): string {
  const content = parseChecklistContent(value);
  return content.title ?? 'Без названия';
}

export function addItem(
  content: ChecklistContent,
  text: string,
): ChecklistContent {
  const trimmed = text.trim();
  if (trimmed === '') {
    return content;
  }
  return {
    ...content,
    items: [
      ...content.items,
      { id: crypto.randomUUID(), text: trimmed, done: false },
    ],
  };
}

export function renameItem(
  content: ChecklistContent,
  itemId: string,
  text: string,
): ChecklistContent {
  const trimmed = text.trim();
  if (trimmed === '') {
    return content;
  }
  return {
    ...content,
    items: content.items.map((item) =>
      item.id === itemId ? { ...item, text: trimmed } : item,
    ),
  };
}

export function setItemDone(
  content: ChecklistContent,
  itemId: string,
  done: boolean,
): ChecklistContent {
  return {
    ...content,
    items: content.items.map((item) =>
      item.id === itemId ? { ...item, done } : item,
    ),
  };
}

export function removeItem(
  content: ChecklistContent,
  itemId: string,
): ChecklistContent {
  return {
    ...content,
    items: content.items.filter((item) => item.id !== itemId),
  };
}
