import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DocumentConflictError,
  type ManagedDocument,
} from '@project-board/widget-sdk';
import {
  createDocumentService,
  type DocumentStoreLike,
} from './document-service.js';

vi.useFakeTimers();

const SAVE_DELAY = 250;

class FakeStore implements DocumentStoreLike {
  docs = new Map<string, ManagedDocument>();
  failWritesLeft = 0;
  failDeletesLeft = 0;
  failSaveAllLeft = 0;
  saveCalls: Array<{ id: string; revision: number; expected: number }> = [];
  saveAllCalls: string[][] = [];
  deleteCalls: string[] = [];

  async save(
    document: ManagedDocument,
    expectedStoredRevision: number,
  ): Promise<void> {
    this.saveCalls.push({
      id: document.id,
      revision: document.revision,
      expected: expectedStoredRevision,
    });
    if (this.failWritesLeft > 0) {
      this.failWritesLeft -= 1;
      throw new Error('boom: хранилище недоступно');
    }
    const stored = this.docs.get(document.id);
    const storedRevision = stored?.revision ?? 0;
    if (storedRevision !== expectedStoredRevision) {
      throw new DocumentConflictError(document.id, storedRevision, expectedStoredRevision);
    }
    this.docs.set(document.id, document);
  }

  async saveAll(
    entries: readonly {
      readonly document: ManagedDocument;
      readonly expectedStoredRevision: number;
    }[],
  ): Promise<void> {
    this.saveAllCalls.push(entries.map((entry) => entry.document.id));
    if (this.failSaveAllLeft > 0) {
      this.failSaveAllLeft -= 1;
      throw new Error('boom: пакетная фиксация недоступна');
    }
    // Валидация всех записей до изменений — эмуляция транзакции.
    const updates: ManagedDocument[] = [];
    for (const entry of entries) {
      const stored = this.docs.get(entry.document.id);
      const storedRevision = stored?.revision ?? 0;
      if (storedRevision !== entry.expectedStoredRevision) {
        throw new DocumentConflictError(
          entry.document.id,
          storedRevision,
          entry.expectedStoredRevision,
        );
      }
      updates.push(entry.document);
    }
    for (const document of updates) {
      this.docs.set(document.id, document);
    }
  }

  async get(documentId: string): Promise<ManagedDocument | undefined> {
    return this.docs.get(documentId);
  }

  async listAll(): Promise<ManagedDocument[]> {
    return [...this.docs.values()];
  }

  async delete(documentId: string): Promise<void> {
    this.deleteCalls.push(documentId);
    if (this.failDeletesLeft > 0) {
      this.failDeletesLeft -= 1;
      throw new Error('boom: удаление недоступно');
    }
    this.docs.delete(documentId);
  }
}

function makeDocument(
  id: string,
  revision: number,
  content: string,
): ManagedDocument {
  return {
    id,
    moduleId: 'checklist',
    documentType: 'list',
    title: 'Список',
    schemaVersion: 1,
    revision,
    createdAt: '2026-10-07T10:00:00.000Z',
    updatedAt: '2026-10-07T10:00:00.000Z',
    content,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useFakeTimers();
});

describe('автосохранение — очередь', () => {
  it('быстрые операции дают одну запись последней корректной редакции', async () => {
    const store = new FakeStore();
    const service = createDocumentService({ store, saveDelayMs: SAVE_DELAY });

    const doc = service.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: 'Список',
      content: 'v1',
    });
    service.update(doc.id, 1, 'v2');
    service.update(doc.id, 2, 'v3');

    await vi.advanceTimersByTimeAsync(SAVE_DELAY);

    expect(store.saveCalls).toHaveLength(1);
    expect(store.saveCalls[0]).toMatchObject({ revision: 3, expected: 0 });
    expect(store.docs.get(doc.id)?.content).toBe('v3');
  });

  it('создание сохраняется с ожидаемой хранимой редакцией 0', async () => {
    const store = new FakeStore();
    const service = createDocumentService({ store, saveDelayMs: SAVE_DELAY });

    const doc = service.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: 'Список',
      content: 'v1',
    });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);

    expect(store.saveCalls[0]).toEqual({ id: doc.id, revision: 1, expected: 0 });
  });

  it('операции разных документов сохраняются без потерь', async () => {
    const store = new FakeStore();
    const service = createDocumentService({ store, saveDelayMs: SAVE_DELAY });

    const a = service.create({ moduleId: 'checklist', documentType: 'list', schemaVersion: 1, title: 'Список', content: 'A1' });
    const b = service.create({ moduleId: 'gantt', documentType: 'plan', schemaVersion: 1, title: 'Список', content: 'B1' });
    service.update(a.id, 1, 'A2');

    await vi.advanceTimersByTimeAsync(SAVE_DELAY);

    // Серия A (create + update) — одна запись последней редакции; B сохранён.
    expect(store.saveCalls).toHaveLength(2);
    const byId = new Map(store.saveCalls.map((call) => [call.id, call]));
    expect(byId.get(a.id)).toMatchObject({ revision: 2 });
    expect(byId.get(b.id)).toMatchObject({ revision: 1 });
    expect(store.docs.get(a.id)?.content).toBe('A2');
    expect(store.docs.get(b.id)?.content).toBe('B1');
  });

  it('два подписчика-«представления» не создают конкурирующих очередей', async () => {
    const store = new FakeStore();
    const service = createDocumentService({ store, saveDelayMs: SAVE_DELAY });
    const doc = service.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: 'Список',
      content: 'v1',
    });
    service.subscribe(doc.id, () => {});

    // Оба «представления» вносят изменения; очередь принадлежит документу.
    service.update(doc.id, 1, 'view-1');
    service.update(doc.id, 2, 'view-2');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);

    expect(store.saveCalls.filter((call) => call.id === doc.id)).toHaveLength(1);
    expect(store.docs.get(doc.id)?.content).toBe('view-2');
  });
});

describe('автосохранение — сбои и повторы', () => {
  it('сбой записи -> состояние error, повтор следующей операцией не теряет изменения', async () => {
    const store = new FakeStore();
    store.failWritesLeft = 10;
    const service = createDocumentService({ store, saveDelayMs: SAVE_DELAY });
    const doc = service.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: 'Список',
      content: 'v1',
    });
    service.subscribeSaveState(doc.id, () => {});

    service.update(doc.id, 1, 'v2');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY + 250 + 500 + 1000 + 1000);

    expect(service.getSaveState(doc.id)?.status).toBe('error');
    expect(store.docs.has(doc.id)).toBe(false);

    store.failWritesLeft = 0;
    service.update(doc.id, 2, 'v3');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);

    expect(service.getSaveState(doc.id)?.status).toBe('saved');
    expect(store.docs.get(doc.id)?.content).toBe('v3');
  });

  it('восстановление хранилища: следующая операция сохраняет накопленную редакцию', async () => {
    const store = new FakeStore();
    store.failWritesLeft = 10;
    const service = createDocumentService({ store, saveDelayMs: SAVE_DELAY });
    const doc = service.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: 'Список',
      content: 'v1',
    });
    service.update(doc.id, 1, 'v2');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY + 250 + 500 + 1000 + 1000);
    expect(service.getSaveState(doc.id)?.status).toBe('error');

    store.failWritesLeft = 0;
    service.update(doc.id, 2, 'v3');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);

    expect(service.getSaveState(doc.id)?.status).toBe('saved');
    expect(store.docs.get(doc.id)?.content).toBe('v3');
  });
});

describe('автосохранение — конфликт двух окон', () => {
  it('устаревшая запись отклоняется, сервис перечитывает документ и уведомляет', async () => {
    const store = new FakeStore();
    const service = createDocumentService({ store, saveDelayMs: SAVE_DELAY });
    const doc = service.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: 'Список',
      content: 'v1',
    });
    const changeHandler = vi.fn();
    service.subscribe(doc.id, changeHandler);
    service.subscribeSaveState(doc.id, () => {});

    // «Второе окно» напрямую кладёт более новую редакцию в хранилище.
    store.docs.set(doc.id, makeDocument(doc.id, 5, 'other-window'));

    service.update(doc.id, 1, 'stale-local');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);

    expect(service.getSaveState(doc.id)?.status).toBe('conflict');
    expect(changeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 5, content: 'other-window' }),
    );
    expect(service.get(doc.id)?.content).toBe('other-window');
  });
});

describe('activeSubscriptionCount — диагностика подписок (PBT-027)', () => {
  it('считает активные подписки; циклы подписки/отписки не умножают', () => {
    const service = createDocumentService();
    const doc = service.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: 'Список',
      content: 'v1',
    });
    expect(service.activeSubscriptionCount()).toBe(0);

    const unsubscribes = Array.from({ length: 20 }, () =>
      service.subscribe(doc.id, () => {}),
    );
    expect(service.activeSubscriptionCount()).toBe(20);
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
    expect(service.activeSubscriptionCount()).toBe(0);

    // Цикл «монтирование → размонтирование» ×20: подписки освобождаются.
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const unsubscribe = service.subscribe(doc.id, () => {});
      expect(service.activeSubscriptionCount()).toBe(1);
      unsubscribe();
    }
    expect(service.activeSubscriptionCount()).toBe(0);
  });
});

describe('restoreAll', () => {
  it('восстанавливает документы из хранилища в память', async () => {
    const store = new FakeStore();
    await store.save(makeDocument('doc-1', 4, 'restored'), 0);

    const service = createDocumentService({ store, saveDelayMs: SAVE_DELAY });
    const restored = await service.restoreAll();

    expect(restored.map((d) => d.id)).toEqual(['doc-1']);
    expect(service.get('doc-1')).toMatchObject({ revision: 4, content: 'restored' });
  });

  it('без store restoreAll возвращает пустой список', async () => {
    const service = createDocumentService();
    expect(await service.restoreAll()).toEqual([]);
  });
});

describe('без store — прежнее поведение', () => {
  it('операции работают в памяти без сохранения', () => {
    const service = createDocumentService();
    const doc = service.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: 'Список',
      content: 'v1',
    });
    service.update(doc.id, 1, 'v2');
    expect(service.get(doc.id)).toMatchObject({ revision: 2, content: 'v2' });
    expect(service.getSaveState(doc.id)).toBeUndefined();
  });
});

describe('rename — название в метаданных', () => {
  it('переименование меняет только название и фиксирует новую редакцию', async () => {
    const store = new FakeStore();
    const service = createDocumentService({ store, saveDelayMs: SAVE_DELAY });
    const doc = service.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: 'Покупки',
      content: { items: [] },
    });
    const changeHandler = vi.fn();
    service.subscribe(doc.id, changeHandler);

    const renamed = service.rename(doc.id, 1, 'Продукты');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);

    expect(renamed).toMatchObject({
      title: 'Продукты',
      revision: 2,
      content: { items: [] },
    });
    expect(service.get(doc.id)?.title).toBe('Продукты');
    expect(changeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Продукты', revision: 2 }),
    );
    expect(store.docs.get(doc.id)).toMatchObject({ title: 'Продукты', revision: 2 });
  });

  it('устаревшая редакция отклоняется конфликтом', () => {
    const service = createDocumentService();
    const doc = service.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: 'Покупки',
      content: { items: [] },
    });
    expect(() => service.rename(doc.id, 5, 'Продукты')).toThrow(
      DocumentConflictError,
    );
    expect(service.get(doc.id)).toMatchObject({ title: 'Покупки', revision: 1 });
  });

  it('пустое название отклоняется', () => {
    const service = createDocumentService();
    const doc = service.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: 'Покупки',
      content: { items: [] },
    });
    expect(() => service.rename(doc.id, 1, '   ')).toThrow(
      'Название документа не может быть пустым.',
    );
    expect(service.get(doc.id)).toMatchObject({ title: 'Покупки', revision: 1 });
  });
});

describe('delete — удаление документа', () => {
  it('снимает отложенную запись: незавершённый таймер не сохранит документ', async () => {
    const store = new FakeStore();
    const service = createDocumentService({ store, saveDelayMs: SAVE_DELAY });
    const doc = service.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: 'Покупки',
      content: 'v1',
    });

    await service.delete(doc.id);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY * 4);

    expect(store.saveCalls).toHaveLength(0);
    expect(store.docs.has(doc.id)).toBe(false);
    expect(service.get(doc.id)).toBeUndefined();
  });

  it('удаляет из хранилища и очищает состояние сохранения', async () => {
    const store = new FakeStore();
    const service = createDocumentService({ store, saveDelayMs: SAVE_DELAY });
    const doc = service.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: 'Покупки',
      content: 'v1',
    });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);
    expect(service.getSaveState(doc.id)?.status).toBe('saved');

    await service.delete(doc.id);

    expect(store.deleteCalls).toEqual([doc.id]);
    expect(store.docs.has(doc.id)).toBe(false);
    expect(service.get(doc.id)).toBeUndefined();
    expect(service.getSaveState(doc.id)).toBeUndefined();
  });

  it('удаление отсутствующего документа не считается ошибкой', async () => {
    const store = new FakeStore();
    const service = createDocumentService({ store, saveDelayMs: SAVE_DELAY });
    await expect(service.delete('missing-id')).resolves.toBeUndefined();
  });

  it('ошибка хранилища наружу: документ остаётся в памяти', async () => {
    const store = new FakeStore();
    store.failDeletesLeft = 1;
    const service = createDocumentService({ store, saveDelayMs: SAVE_DELAY });
    const doc = service.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: 'Покупки',
      content: 'v1',
    });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);

    await expect(service.delete(doc.id)).rejects.toThrow('удаление недоступно');
    expect(service.get(doc.id)).toMatchObject({ title: 'Покупки' });
    // Очередь снята, но документ жив: следующая операция снова сохраняет.
    service.update(doc.id, 1, 'v2');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);
    expect(store.docs.get(doc.id)?.content).toBe('v2');
  });
});
