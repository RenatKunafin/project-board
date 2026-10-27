import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DocumentFutureVersionError,
  type DocumentMigrationsSupport,
  type ManagedDocument,
} from '@project-board/widget-sdk';
import { createIndexedDbDocumentStore } from './document-store';
import {
  createDocumentService,
  type DocumentStoreLike,
} from './document-service';

// Реальные структуры содержимого тестового формата: v1 → v2 → v3.
interface LegacyContentV1 {
  items: string[];
}
interface ContentV2 {
  items: { text: string; done: boolean }[];
}
interface ContentV3 {
  items: { text: string; done: boolean; createdAt: string }[];
  source: 'migrated';
}

const steps: DocumentMigrationsSupport['steps'] = [
  {
    from: 1,
    to: 2,
    migrate: (content) => {
      const legacy = content as LegacyContentV1;
      return {
        items: legacy.items.map((text) => ({ text, done: false })),
      } satisfies ContentV2;
    },
  },
  {
    from: 2,
    to: 3,
    migrate: (content) => {
      const previous = content as ContentV2;
      return {
        items: previous.items.map((item) => ({
          ...item,
          createdAt: '2026-10-13T00:00:00.000Z',
        })),
        source: 'migrated',
      } satisfies ContentV3;
    },
  },
];

const support: DocumentMigrationsSupport = {
  moduleId: 'notes',
  documentType: 'doc',
  actualVersion: 3,
  steps,
};

function legacyDocument(
  overrides: Partial<ManagedDocument> = {},
): ManagedDocument {
  return {
    id: 'doc-legacy',
    moduleId: 'notes',
    documentType: 'doc',
    title: 'Заметки',
    schemaVersion: 1,
    revision: 4,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-12T10:00:00.000Z',
    content: { items: ['Пункт один', 'Пункт два'] } satisfies LegacyContentV1,
    ...overrides,
  };
}

/** Делигирование с подсчётом: обёртка для проверки сбоев пакетной фиксации. */
function wrappingStore(inner: DocumentStoreLike): DocumentStoreLike & {
  failSaveAllNext(): void;
  saveAllCalls: string[][];
} {
  let failSaveAll = false;
  const saveAllCalls: string[][] = [];
  return {
    saveAllCalls,
    save: (document, expected) => inner.save(document, expected),
    saveAll: async (entries) => {
      saveAllCalls.push(entries.map((entry) => entry.document.id));
      if (failSaveAll) {
        failSaveAll = false;
        throw new Error('boom: фиксация недоступна');
      }
      await inner.saveAll(entries);
    },
    get: (id) => inner.get(id),
    listAll: () => inner.listAll(),
    delete: (id) => inner.delete(id),
    failSaveAllNext: () => {
      failSaveAll = true;
    },
  };
}

async function freshStore(name: string): Promise<ReturnType<typeof createIndexedDbDocumentStore>> {
  // Адаптер открывается лениво при первой операции — явный open не требуется.
  return createIndexedDbDocumentStore(name);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('миграции при восстановлении (fake-indexeddb)', () => {
  it('prepares imported documents through existing migrations without writing or changing input', () => {
    const service = createDocumentService({ migrations: [support] });
    const imported = legacyDocument();
    const prepared = service.prepareDocumentsForRestore([imported]);
    expect(prepared[0]).toMatchObject({ schemaVersion: 3, revision: 4, content: { source: 'migrated', items: expect.arrayContaining([{ text: 'Пункт один', done: false, createdAt: '2026-10-13T00:00:00.000Z' }]) } });
    expect(imported).toEqual(legacyDocument());
  });

  it('preserves unknown modules and future versions during import preparation', () => {
    const service = createDocumentService({ migrations: [support] });
    const unknown = legacyDocument({ id: 'unknown', moduleId: 'other', documentType: 'custom' });
    const future = legacyDocument({ id: 'future', schemaVersion: 4 });
    expect(service.prepareDocumentsForRestore([unknown, future])).toEqual([unknown, future]);
  });

  it('fails preparation atomically when an imported migration throws', () => {
    const broken: DocumentMigrationsSupport = { ...support, steps: [{ from: 1, to: 3, migrate: () => { throw new Error('migration failed'); } }] };
    const service = createDocumentService({ migrations: [broken] });
    expect(() => service.prepareDocumentsForRestore([legacyDocument()])).toThrow('migration failed');
  });
  it('старая фикстура преобразуется цепочкой 1→3 с сохранением идентификатора, названия и редакции', async () => {
    const store = await freshStore(`mig-${crypto.randomUUID()}`);
    await store.save(legacyDocument(), 0);

    const service = createDocumentService({ store, migrations: [support] });
    await service.restoreAll();

    const restored = service.get('doc-legacy');
    expect(restored).toMatchObject({
      id: 'doc-legacy',
      moduleId: 'notes',
      documentType: 'doc',
      title: 'Заметки',
      schemaVersion: 3,
      revision: 4,
    });
    const content = restored?.content as ContentV3;
    expect(content.items).toEqual([
      {
        text: 'Пункт один',
        done: false,
        createdAt: '2026-10-13T00:00:00.000Z',
      },
      {
        text: 'Пункт два',
        done: false,
        createdAt: '2026-10-13T00:00:00.000Z',
      },
    ]);
    expect(content.source).toBe('migrated');
    expect(service.listRecoveryIssues()).toEqual([]);

    // Миграция зафиксирована в хранилище (выполняется однократно).
    const stored = await store.get('doc-legacy');
    expect(stored?.schemaVersion).toBe(3);
    store.close();
  });

  it('повторное восстановление не вызывает функции миграций', async () => {
    const store = await freshStore(`mig-${crypto.randomUUID()}`);
    await store.save(legacyDocument(), 0);

    const spies = support.steps.map((step) => vi.spyOn(step, 'migrate'));
    const service = createDocumentService({ store, migrations: [support] });
    await service.restoreAll();
    const callsAfterFirst = spies.reduce(
      (total, spy) => total + spy.mock.calls.length,
      0,
    );
    expect(callsAfterFirst).toBe(2);

    await service.restoreAll();
    const callsAfterSecond = spies.reduce(
      (total, spy) => total + spy.mock.calls.length,
      0,
    );
    expect(callsAfterSecond).toBe(callsAfterFirst);
    store.close();
  });

  it('сбой шага оставляет документ нетронутым, остальные мигрируют', async () => {
    const store = await freshStore(`mig-${crypto.randomUUID()}`);
    // Сломанный документ — отдельный тип с падающей миграцией; соседний — обычная.
    await store.save(
      legacyDocument({ id: 'doc-broken', documentType: 'broken' }),
      0,
    );
    await store.save(
      legacyDocument({ id: 'doc-ok', title: 'Целые заметки' }),
      0,
    );

    const failingSupport: DocumentMigrationsSupport = {
      moduleId: 'notes',
      documentType: 'broken',
      actualVersion: 3,
      steps: [
        steps[0],
        {
          from: 2,
          to: 3,
          migrate: () => {
            throw new Error('формат не распознан');
          },
        },
      ],
    };
    const service = createDocumentService({
      store,
      migrations: [support, failingSupport],
    });
    await service.restoreAll();

    // Сломанный документ остался в хранилище в исходной версии.
    const broken = await store.get('doc-broken');
    expect(broken).toMatchObject({ schemaVersion: 1, revision: 4 });
    expect(broken?.content).toEqual({ items: ['Пункт один', 'Пункт два'] });
    expect(service.get('doc-broken')?.schemaVersion).toBe(1);

    // Проблема доступна приложению, соседний документ приведён.
    const issues = service.listRecoveryIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      documentId: 'doc-broken',
      moduleId: 'notes',
      documentType: 'broken',
      storedVersion: 1,
      targetVersion: 3,
      reason: 'step-failed',
    });
    expect(service.get('doc-ok')?.schemaVersion).toBe(3);
    store.close();
  });

  it('разрыв цепочки: проблема с версиями, документ не тронут', async () => {
    const store = await freshStore(`mig-${crypto.randomUUID()}`);
    await store.save(legacyDocument(), 0);

    const gapped: DocumentMigrationsSupport = {
      moduleId: 'notes',
      documentType: 'doc',
      actualVersion: 3,
      steps: [steps[1]], // есть только «2 → 3», хранимая версия 1
    };
    const service = createDocumentService({ store, migrations: [gapped] });
    await service.restoreAll();

    expect(service.listRecoveryIssues()[0]).toMatchObject({
      documentId: 'doc-legacy',
      storedVersion: 1,
      targetVersion: 3,
      reason: 'chain-gap',
    });
    expect((await store.get('doc-legacy'))?.schemaVersion).toBe(1);
    store.close();
  });

  it('документ будущей версии: читается, записи отклоняются, хранилище неизменно', async () => {
    const store = await freshStore(`mig-${crypto.randomUUID()}`);
    const future = legacyDocument({
      id: 'doc-future',
      schemaVersion: 99,
      content: { format: 'from-the-future' },
    });
    await store.save(future, 0);

    const service = createDocumentService({ store, migrations: [support] });
    await service.restoreAll();

    // Чтение и отображение работают.
    expect(service.get('doc-future')).toMatchObject({
      schemaVersion: 99,
      title: 'Заметки',
    });
    expect(service.isFutureVersion('doc-future')).toBe(true);

    // Все операции записи отклоняются.
    expect(() => service.update('doc-future', 4, { items: [] })).toThrow(
      DocumentFutureVersionError,
    );
    expect(() => service.rename('doc-future', 4, 'Портить')).toThrow(
      DocumentFutureVersionError,
    );
    await expect(service.delete('doc-future')).rejects.toThrow(
      DocumentFutureVersionError,
    );

    // Откат приложения: документ сохранён с исходной версией и содержимым.
    const stored = await store.get('doc-future');
    expect(stored).toEqual(future);
    store.close();
  });

  it('сбой пакетной фиксации отклоняется целиком, хранилище в исходном состоянии', async () => {
    const inner = await freshStore(`mig-${crypto.randomUUID()}`);
    await inner.save(legacyDocument({ id: 'doc-a' }), 0);
    await inner.save(legacyDocument({ id: 'doc-b' }), 0);
    const store = wrappingStore(inner);

    const service = createDocumentService({ store, migrations: [support] });
    store.failSaveAllNext();
    await expect(service.restoreAll()).rejects.toThrow('фиксация недоступна');

    expect((await inner.get('doc-a'))?.schemaVersion).toBe(1);
    expect((await inner.get('doc-b'))?.schemaVersion).toBe(1);
    inner.close();
  });

  it('успешные миграции фиксируются одной пакетной записью', async () => {
    const inner = await freshStore(`mig-${crypto.randomUUID()}`);
    await inner.save(legacyDocument({ id: 'doc-a' }), 0);
    await inner.save(legacyDocument({ id: 'doc-b' }), 0);
    const store = wrappingStore(inner);

    const service = createDocumentService({ store, migrations: [support] });
    await service.restoreAll();

    expect(store.saveAllCalls).toEqual([['doc-a', 'doc-b']]);
    expect((await inner.get('doc-a'))?.schemaVersion).toBe(3);
    expect((await inner.get('doc-b'))?.schemaVersion).toBe(3);
    inner.close();
  });
});
