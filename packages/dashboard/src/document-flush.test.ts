import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentConflictError, type ManagedDocument } from '@project-board/widget-sdk';
import { createDocumentService, type DocumentStoreLike } from './document-service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function memoryStore() {
  const docs = new Map<string, ManagedDocument>();
  const store: DocumentStoreLike = {
    save: vi.fn(async (doc, expected) => {
      const actual = docs.get(doc.id)?.revision ?? 0;
      if (actual !== expected) throw new DocumentConflictError(doc.id, actual, expected);
      docs.set(doc.id, doc);
    }),
    saveAll: async () => {},
    get: async (id) => docs.get(id),
    listAll: async () => [...docs.values()],
    delete: vi.fn(async (id) => { docs.delete(id); }),
  };
  return { store, docs };
}

const create = (service: ReturnType<typeof createDocumentService>) => service.create({
  moduleId: 'checklist', documentType: 'list', schemaVersion: 1, title: 'Список', content: 'first',
});

afterEach(() => vi.useRealTimers());

describe('подтверждаемое завершение записи (PBT-029)', () => {
  it('ждёт in-flight, следующую редакцию и параллельные flush без дублирования put', async () => {
    const { store, docs } = memoryStore();
    const release = deferred();
    const started = deferred();
    const original = store.save;
    store.save = vi.fn(async (doc, expected) => {
      if (doc.revision === 1) { started.resolve(); await release.promise; }
      await original(doc, expected);
    });
    const service = createDocumentService({ store, saveDelayMs: 0 });
    const doc = create(service);
    await started.promise;
    service.update(doc.id, 1, 'latest');
    let completed = false;
    const first = service.flushAll().then(() => { completed = true; });
    const second = service.flushAll();
    await Promise.resolve();
    expect(completed).toBe(false);
    release.resolve();
    await Promise.all([first, second]);
    expect(docs.get(doc.id)?.content).toBe('latest');
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(service.getSaveState(doc.id)?.status).toBe('saved');
  });

  it('повтор после сбоя не затирает правку, поступившую во время put', async () => {
    vi.useFakeTimers();
    const { store, docs } = memoryStore();
    const release = deferred();
    const started = deferred();
    const original = store.save;
    let first = true;
    store.save = async (doc, expected) => {
      if (first) { first = false; started.resolve(); await release.promise; throw new Error('temporary'); }
      await original(doc, expected);
    };
    const service = createDocumentService({ store });
    const doc = create(service);
    const flush = service.flushAll();
    await started.promise;
    service.update(doc.id, 1, 'newer than failed write');
    release.resolve();
    await vi.runAllTimersAsync();
    await flush;
    expect(docs.get(doc.id)?.content).toBe('newer than failed write');
    expect(docs.get(doc.id)?.revision).toBe(2);
  });

  it('исчерпанные повторы отклоняют flush; повторная попытка сохраняет актуальные данные', async () => {
    vi.useFakeTimers();
    const { store, docs } = memoryStore();
    const original = store.save;
    store.save = async () => { throw new Error('storage unavailable'); };
    const service = createDocumentService({ store });
    const doc = create(service);
    const rejected = expect(service.flushAll()).rejects.toThrow('storage unavailable');
    await vi.runAllTimersAsync();
    await rejected;
    expect(service.get(doc.id)?.content).toBe('first');
    expect(service.getSaveState(doc.id)?.status).toBe('error');
    store.save = original;
    await service.flushAll();
    expect(docs.get(doc.id)?.content).toBe('first');
  });

  it('конфликт не разрешает обновление даже после завершения фоновой обработки', async () => {
    const { store, docs } = memoryStore();
    const service = createDocumentService({ store });
    const doc = create(service);
    docs.set(doc.id, { ...doc, revision: 5, content: 'other window' });
    await expect(service.flushAll()).rejects.toBeInstanceOf(DocumentConflictError);
    await expect(service.flushAll()).rejects.toThrow('конфликт');
    expect(service.get(doc.id)?.content).toBe('other window');
  });

  it('ждёт выполняющееся удаление', async () => {
    const { store, docs } = memoryStore();
    const service = createDocumentService({ store });
    const doc = create(service);
    await service.flushAll();
    const release = deferred();
    const original = store.delete;
    store.delete = async (id) => { await release.promise; await original(id); };
    const deletion = service.delete(doc.id);
    let completed = false;
    const flush = service.flushAll().then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    release.resolve();
    await deletion;
    await flush;
    expect(docs.has(doc.id)).toBe(false);
  });

  it('удаление не обгоняет начатый put и документ не воскресает', async () => {
    const { store, docs } = memoryStore();
    const release = deferred();
    const started = deferred();
    const original = store.save;
    store.save = async (doc, expected) => {
      started.resolve();
      await release.promise;
      await original(doc, expected);
    };
    const service = createDocumentService({ store, saveDelayMs: 0 });
    const doc = create(service);
    await started.promise;
    const deletion = service.delete(doc.id);
    release.resolve();
    await deletion;
    await service.flushAll();
    expect(docs.has(doc.id)).toBe(false);
  });

  it('ошибка удаления блокирует flush до успешного повтора операции', async () => {
    const { store } = memoryStore();
    const service = createDocumentService({ store });
    const doc = create(service);
    await service.flushAll();
    const original = store.delete;
    store.delete = async () => { throw new Error('delete failed'); };
    await expect(service.delete(doc.id)).rejects.toThrow('delete failed');
    await expect(service.flushAll()).rejects.toThrow('delete failed');
    store.delete = original;
    await service.delete(doc.id);
    await service.flushAll();
  });

  it('без долговременного store не выдаёт ложное подтверждение сохранения', async () => {
    const service = createDocumentService();
    create(service);
    await expect(service.flushAll()).rejects.toThrow('не подключено');
  });

  it('ошибка перечитывания конфликта остаётся ошибкой записи, а не ложным saved', async () => {
    const { store, docs } = memoryStore();
    const service = createDocumentService({ store });
    const doc = create(service);
    docs.set(doc.id, { ...doc, revision: 5 });
    store.get = async () => { throw new Error('read failed'); };
    await expect(service.flushAll()).rejects.toThrow('read failed');
    expect(service.getSaveState(doc.id)?.status).toBe('error');
    expect(service.get(doc.id)?.content).toBe('first');
    expect(docs.get(doc.id)?.revision).toBe(5);
  });

  it('не принимает новую правку документа во время его удаления', async () => {
    const { store } = memoryStore();
    const service = createDocumentService({ store });
    const doc = create(service);
    await service.flushAll();
    const release = deferred();
    const original = store.delete;
    store.delete = async (id) => { await release.promise; await original(id); };
    const deletion = service.delete(doc.id);
    expect(() => service.update(doc.id, doc.revision, 'too late')).toThrow('удаляется');
    release.resolve();
    await deletion;
  });
});
