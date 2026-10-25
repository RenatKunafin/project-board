export interface CounterContent { readonly count: number }

export function parseCounter(content: unknown): CounterContent {
  if (typeof content !== 'object' || content === null ||
      !('count' in content) || !Number.isSafeInteger(content.count)) {
    throw new Error('Документ счётчика должен содержать целое безопасное число count.');
  }
  return { count: content.count as number };
}

/** Чистая миграция прежнего формата { value } в { count }. */
export function migrateCounterV1(content: unknown): CounterContent {
  if (typeof content !== 'object' || content === null || !('value' in content)) {
    throw new Error('В документе счётчика v1 отсутствует value.');
  }
  return parseCounter({ count: content.value });
}
