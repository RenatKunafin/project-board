import { describe, expect, it } from 'vitest';
import { Dexie } from 'dexie';
import {
  DocumentConflictError,
  type ManagedDocument,
} from '@project-board/widget-sdk';
import { PersistenceError } from './document-store';
import { createIndexedDbDocumentStore } from './document-store';

function makeDocument(
  id: string,
  overrides: Partial<ManagedDocument> = {},
): ManagedDocument {
  return {
    id,
    moduleId: 'checklist',
    documentType: 'list',
    title: 'Список',
    schemaVersion: 1,
    revision: 1,
    createdAt: '2026-10-07T10:00:00.000Z',
    updatedAt: '2026-10-07T10:00:00.000Z',
    content: { items: [{ id: 'i-1', text: 'Пункт', done: false }] },
    ...overrides,
  };
}

function uniqueDbName(): string {
  return `test-db-${crypto.randomUUID()}`;
}

describe('IndexedDbDocumentStore — сохранение и чтение', () => {
  it('документ переживает повторное открытие БД', async () => {
    const name = uniqueDbName();
    const document = makeDocument('doc-1', { revision: 3 });

    const store = createIndexedDbDocumentStore(name);
    await store.save(document, 0);
    store.close();

    const reopened = createIndexedDbDocumentStore(name);
    const loaded = await reopened.get('doc-1');

    expect(loaded).toEqual(document);
    reopened.close();
  });

  it('get отсутствующего документа возвращает undefined', async () => {
    const store = createIndexedDbDocumentStore(uniqueDbName());
    expect(await store.get('missing')).toBeUndefined();
    store.close();
  });
});

describe('IndexedDbDocumentStore — выборки по модулю и типу', () => {
  it('выборка по модулю возвращает только его документы', async () => {
    const store = createIndexedDbDocumentStore(uniqueDbName());
    await store.save(makeDocument('c-1'), 0);
    await store.save(makeDocument('c-2'), 0);
    await store.save(makeDocument('g-1', { moduleId: 'gantt', documentType: 'plan' }), 0);

    const checklistDocs = await store.listByModule('checklist');
    expect(checklistDocs.map((d) => d.id).sort()).toEqual(['c-1', 'c-2']);
    store.close();
  });

  it('выборка по типу возвращает только нужный тип', async () => {
    const store = createIndexedDbDocumentStore(uniqueDbName());
    await store.save(makeDocument('l-1', { documentType: 'list' }), 0);
    await store.save(makeDocument('p-1', { documentType: 'plan' }), 0);

    const plans = await store.listByType('plan');
    expect(plans.map((d) => d.id)).toEqual(['p-1']);
    store.close();
  });
});

describe('IndexedDbDocumentStore — атомарная запись с проверкой редакции', () => {
  it('конкурентные записи с одной исходной редакцией: первая фиксируется, вторая отклоняется', async () => {
    const store = createIndexedDbDocumentStore(uniqueDbName());
    const first = makeDocument('doc-1', { revision: 1, updatedAt: 'a' });
    const second = makeDocument('doc-1', { revision: 1, updatedAt: 'b' });

    await store.save(first, 0);
    await expect(store.save(second, 0)).rejects.toThrowError(
      DocumentConflictError,
    );

    const stored = await store.get('doc-1');
    expect(stored).toEqual(first);
    store.close();
  });

  it('запись поверх другой хранимой редакции отклоняется', async () => {
    const store = createIndexedDbDocumentStore(uniqueDbName());
    await store.save(makeDocument('doc-1', { revision: 2 }), 0);

    await expect(
      store.save(makeDocument('doc-1', { revision: 3 }), 1),
    ).rejects.toThrowError(DocumentConflictError);

    expect((await store.get('doc-1'))?.revision).toBe(2);
    store.close();
  });

  it('последовательные записи с корректными редакциями проходят', async () => {
    const store = createIndexedDbDocumentStore(uniqueDbName());
    await store.save(makeDocument('doc-1', { revision: 1 }), 0);
    await store.save(makeDocument('doc-1', { revision: 2 }), 1);
    await store.save(makeDocument('doc-1', { revision: 3 }), 2);

    expect((await store.get('doc-1'))?.revision).toBe(3);
    store.close();
  });
});

describe('IndexedDbDocumentStore — удаление', () => {
  it('удаляет документ; повторное удаление не ошибка', async () => {
    const store = createIndexedDbDocumentStore(uniqueDbName());
    await store.save(makeDocument('doc-1'), 0);

    await store.delete('doc-1');
    expect(await store.get('doc-1')).toBeUndefined();
    await expect(store.delete('doc-1')).resolves.toBeUndefined();
    store.close();
  });
});

describe('IndexedDbDocumentStore — контракт ошибок', () => {
  it('неподдерживаемая версия схемы БД -> PersistenceError schema-version-unsupported', async () => {
    const name = uniqueDbName();

    // «Будущее» приложение создаёт БД более высокой версии схемы.
    const futureDb = new Dexie(name);
    futureDb.version(99).stores({ documents: 'id' });
    await futureDb.open();
    futureDb.close();

    const store = createIndexedDbDocumentStore(name);
    await expect(store.save(makeDocument('doc-1'), 0)).rejects.toThrowError(
      PersistenceError,
    );
    try {
      await store.save(makeDocument('doc-1'), 0);
    } catch (error) {
      expect(error).toBeInstanceOf(PersistenceError);
      expect((error as PersistenceError).code).toBe(
        'schema-version-unsupported',
      );
    }
    store.close();
  });
});
