export interface ChecklistItem {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
}

export interface ChecklistContent {
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

export function addItem(
  content: ChecklistContent,
  text: string,
): ChecklistContent {
  const trimmed = text.trim();
  if (trimmed === '') {
    return content;
  }
  return {
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
    items: content.items.map((item) =>
      item.id === itemId ? { ...item, done } : item,
    ),
  };
}

export function removeItem(
  content: ChecklistContent,
  itemId: string,
): ChecklistContent {
  return { items: content.items.filter((item) => item.id !== itemId) };
}
