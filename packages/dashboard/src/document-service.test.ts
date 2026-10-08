import { describe, expect, it, vi } from 'vitest';
import {
  DocumentConflictError,
  type ManagedDocument,
} from '@project-board/widget-sdk';
import { createDocumentService } from './document-service.js';

const service = createDocumentService();

function createSample(content: unknown): ManagedDocument {
  return service.create({
    moduleId: 'checklist',
    documentType: 'list',
    schemaVersion: 1,
    content,
  });
}

describe('document service — создание и чтение', () => {
  it('создаёт документ с редакцией 1 и метками времени', () => {
    const doc = createSample({ items: [] });

    expect(doc.revision).toBe(1);
    expect(doc.moduleId).toBe('checklist');
    expect(doc.documentType).toBe('list');
    expect(doc.schemaVersion).toBe(1);
    expect(doc.createdAt).toBe(doc.updatedAt);
    expect(service.get(doc.id)?.content).toEqual({ items: [] });
  });

  it('содержимое непрозрачно: разные модули через один интерфейс', () => {
    const checklistDoc = createSample({ items: ['a'] });
    const ganttDoc = service.create({
      moduleId: 'gantt',
      documentType: 'plan',
      schemaVersion: 1,
      content: { tasks: [] },
    });

    expect(service.get(checklistDoc.id)?.content).toEqual({ items: ['a'] });
    expect(service.get(ganttDoc.id)?.content).toEqual({ tasks: [] });
    expect(service.get(ganttDoc.id)?.moduleId).toBe('gantt');
  });
});

describe('document service — обновление с проверкой редакции', () => {
  it('последовательные обновления увеличивают редакцию 1→2→3', () => {
    const doc = createSample('v1');

    const afterFirst = service.update(doc.id, 1, 'v2');
    const afterSecond = service.update(doc.id, 2, 'v3');

    expect(afterFirst.revision).toBe(2);
    expect(afterSecond.revision).toBe(3);
    expect(service.get(doc.id)?.content).toBe('v3');
  });

  it('устаревшая редакция отклоняется конфликтом, документ не меняется', () => {
    const doc = createSample('v1');
    service.update(doc.id, 1, 'v2');
    service.update(doc.id, 2, 'v3');

    expect(() => service.update(doc.id, 2, 'stale')).toThrowError(
      DocumentConflictError,
    );
    try {
      service.update(doc.id, 2, 'stale');
    } catch (error) {
      const conflict = error as DocumentConflictError;
      expect(conflict.actualRevision).toBe(3);
      expect(conflict.expectedRevision).toBe(2);
    }
    expect(service.get(doc.id)).toMatchObject({ revision: 3, content: 'v3' });
  });
});

describe('document service — подписки', () => {
  it('два подписчика получают одну и ту же новую редакцию', () => {
    const doc = createSample('v1');
    const first = vi.fn();
    const second = vi.fn();
    service.subscribe(doc.id, first);
    service.subscribe(doc.id, second);

    const updated = service.update(doc.id, 1, 'v2');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(updated);
    expect(second).toHaveBeenCalledWith(updated);
    expect(first.mock.calls[0][0]).toMatchObject({ revision: 2, content: 'v2' });
  });

  it('отписка освобождает подписку, документ остаётся', () => {
    const doc = createSample('v1');
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = service.subscribe(doc.id, first);
    service.subscribe(doc.id, second);

    unsubscribeFirst();
    service.update(doc.id, 1, 'v2');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(service.get(doc.id)).toMatchObject({ revision: 2 });
  });

  it('подписка на несуществующий документ не уведомляет', () => {
    const handler = vi.fn();
    const unsubscribe = service.subscribe('missing-id', handler);

    expect(() => unsubscribe()).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('document service — независимость документов', () => {
  it('обновление одного документа не затрагивает другой', () => {
    const first = createSample('doc-1');
    const second = createSample('doc-2');
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    service.subscribe(first.id, firstHandler);
    service.subscribe(second.id, secondHandler);

    service.update(first.id, 1, 'doc-1-updated');

    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).not.toHaveBeenCalled();
    expect(service.get(second.id)).toMatchObject({ revision: 1, content: 'doc-2' });
  });
});

describe('document service — состояние представления', () => {
  it('настройки представления не меняют документ и не уведомляют', () => {
    const doc = createSample('v1');
    const handler = vi.fn();
    service.subscribe(doc.id, handler);
    service.update(doc.id, 1, 'v2');

    service.setViewSettings('w-1', { collapsedGroups: ['g1'] });

    expect(service.getViewSettings('w-1')).toEqual({ collapsedGroups: ['g1'] });
    expect(handler).toHaveBeenCalledTimes(1); // только от update выше
    expect(service.get(doc.id)?.revision).toBe(2);
  });

  it('настройки изолированы по ключу экземпляра', () => {
    service.setViewSettings('w-a', { zoom: 2 });
    service.setViewSettings('w-b', { zoom: 5 });

    expect(service.getViewSettings('w-a')).toEqual({ zoom: 2 });
    expect(service.getViewSettings('w-b')).toEqual({ zoom: 5 });
    expect(service.getViewSettings('w-missing')).toBeUndefined();
  });
});
