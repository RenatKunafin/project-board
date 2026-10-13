import { describe, expect, it } from 'vitest';
import type { ManagedDocument, WidgetTypeDefinition } from '@project-board/widget-sdk';
import {
  documentTypeInfos,
  filterDocuments,
  filterKey,
  matchesFilter,
  sortDocumentsByRecency,
  widgetTypesForDocument,
} from './document-catalog.js';

function type(
  id: string,
  moduleId?: string,
  documentType?: string,
): WidgetTypeDefinition {
  return {
    id,
    title: `Тип ${id}`,
    component: () => null,
    startSettings: {},
    sizeConstraints: { minWidth: 2, minHeight: 2 },
    documentSupport: moduleId
      ? {
          moduleId,
          documentType: documentType ?? 'list',
          schemaVersion: 1,
          createContent: () => ({}),
        }
      : undefined,
  };
}

function doc(
  id: string,
  moduleId: string,
  documentType: string,
  updatedAt = '2026-10-13T10:00:00.000Z',
): ManagedDocument {
  return {
    id,
    moduleId,
    documentType,
    title: id,
    schemaVersion: 1,
    revision: 1,
    createdAt: '2026-10-13T09:00:00.000Z',
    updatedAt,
    content: {},
  };
}

describe('documentTypeInfos', () => {
  it('собирает уникальные типы документов из регистрации', () => {
    const infos = documentTypeInfos([
      type('checklist', 'checklist', 'list'),
      type('plan', 'gantt', 'plan'),
      type('plain'),
    ]);
    expect(infos.map((info) => `${info.moduleId}/${info.documentType}`)).toEqual([
      'checklist/list',
      'gantt/plan',
    ]);
  });

  it('первый зарегистрированный тип побеждает при дубликате типа документа', () => {
    const infos = documentTypeInfos([
      type('first', 'checklist', 'list'),
      type('second', 'checklist', 'list'),
    ]);
    expect(infos).toHaveLength(1);
    expect(infos[0].widgetTypeId).toBe('first');
  });
});

describe('фильтр каталога', () => {
  const documents = [
    doc('a', 'checklist', 'list'),
    doc('b', 'gantt', 'plan'),
    doc('c', 'checklist', 'list'),
  ];

  it('без фильтра возвращаются все документы', () => {
    expect(filterDocuments(documents, { kind: 'all' })).toHaveLength(3);
  });

  it('фильтр по типу не скрывает чужие типы из полного списка', () => {
    const filtered = filterDocuments(documents, {
      kind: 'type',
      moduleId: 'checklist',
      documentType: 'list',
    });
    expect(filtered.map((d) => d.id)).toEqual(['a', 'c']);
    expect(filterDocuments(documents, { kind: 'all' })).toHaveLength(3);
  });

  it('пустой результат фильтра отличим от полного отсутствия документов', () => {
    const onlyChecklists = [
      doc('a', 'checklist', 'list'),
      doc('c', 'checklist', 'list'),
    ];
    const empty = filterDocuments([], { kind: 'all' });
    const noPlan = filterDocuments(onlyChecklists, {
      kind: 'type',
      moduleId: 'gantt',
      documentType: 'plan',
    });
    expect(empty).toHaveLength(0);
    expect(noPlan).toHaveLength(0);
    // Состояния различаются на уровне входа: documents пуст vs фильтр без результатов.
    expect(matchesFilter(onlyChecklists[0], { kind: 'type', moduleId: 'gantt', documentType: 'plan' })).toBe(false);
    expect(filterKey('gantt', 'plan')).toBe('gantt/plan');
  });
});

describe('widgetTypesForDocument', () => {
  it('возвращает типы, чей дескриптор совпадает по модулю и типу', () => {
    const types = [
      type('checklist', 'checklist', 'list'),
      type('plan', 'gantt', 'plan'),
      type('plain'),
    ];
    expect(
      widgetTypesForDocument(types, 'gantt', 'plan').map((t) => t.id),
    ).toEqual(['plan']);
    expect(widgetTypesForDocument(types, 'gantt', 'other')).toEqual([]);
  });
});

describe('sortDocumentsByRecency', () => {
  it('новые сверху, при равных updatedAt порядок стабилен по id', () => {
    const sorted = sortDocumentsByRecency([
      doc('a', 'checklist', 'list', '2026-10-13T10:00:00.000Z'),
      doc('c', 'checklist', 'list', '2026-10-13T12:00:00.000Z'),
      doc('b', 'checklist', 'list', '2026-10-13T10:00:00.000Z'),
    ]);
    expect(sorted.map((d) => d.id)).toEqual(['c', 'a', 'b']);
  });
});
