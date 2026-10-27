import { describe, expect, it } from 'vitest';
import type { ManagedDocument } from '@project-board/widget-sdk';
import {
  deserializeWorkspaceBackup,
  serializeWorkspaceBackup,
  type WorkspaceBackupPayload,
} from './workspace-backup';
import type { WorkspaceSnapshot } from './workspace-store';

const doc = (id: string, moduleId = 'checklist'): ManagedDocument => ({
  id,
  moduleId,
  documentType: moduleId === 'gantt' ? 'plan' : 'list',
  title: id,
  schemaVersion: 1,
  revision: 3,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T11:00:00.000Z',
  content: { id, nested: [{ active: true }] },
});

const workspace: WorkspaceSnapshot = {
  tabs: [
    { id: 'tab-1', title: 'Первая', position: 0, mode: 'grid', cascadeOrder: [], active: 1 },
    { id: 'tab-2', title: 'Вторая', position: 1, mode: 'cascade', cascadeOrder: ['window-2'], active: 0 },
  ],
  instances: [
    { id: 'window-1', tabId: 'tab-1', typeId: 'checklist', documentId: 'list-1', collapsed: 0, gridArea: { x: 0, y: 0, w: 6, h: 4 }, cascadeArea: null },
    { id: 'window-2', tabId: 'tab-2', typeId: 'plan', documentId: 'plan-1', collapsed: 1, gridArea: null, cascadeArea: { x: 10.5, y: 24, width: 600, height: 400 } },
  ],
  activeTabId: 'tab-1',
};

const payload: WorkspaceBackupPayload = {
  documents: [doc('list-1'), doc('plan-1', 'gantt'), doc('unused')],
  workspace,
  viewSettings: { 'window-1': { hideDone: true, nested: { ids: ['a', 'b'] } } },
};

const createdAt = '2026-10-27T12:30:00.000Z';
const compatibility = {
  widgetTypeIds: ['checklist', 'plan'],
  documentTypes: [
    { moduleId: 'checklist', documentType: 'list', schemaVersion: 1 },
    { moduleId: 'gantt', documentType: 'plan', schemaVersion: 1 },
  ],
};

function serialize(value = payload): string {
  const result = serializeWorkspaceBackup(value, createdAt);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.json;
}

describe('workspace-backup format v1', () => {
  it('round-trips documents, unused docs, tabs, layouts and independent view settings', () => {
    const result = deserializeWorkspaceBackup(serialize(), compatibility);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ ...payload, createdAt });
    expect(result.issues).toEqual([]);
  });

  it('keeps a deleted-document reference and reports it as a warning', () => {
    const snapshot = {
      ...payload,
      documents: payload.documents.slice(1),
      workspace: {
        ...workspace,
        instances: workspace.instances.map((instance) =>
          instance.id === 'window-1' ? { ...instance, documentId: 'gone' } : instance,
        ),
      },
    };
    const result = deserializeWorkspaceBackup(serialize(snapshot), compatibility);
    expect(result.ok).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: 'warning', code: 'document-missing', path: 'workspace.instances[0].documentId',
    }));
  });

  it('reports unknown widgets and document modules without dropping their content', () => {
    const result = deserializeWorkspaceBackup(serialize(), { widgetTypeIds: [], documentTypes: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documents).toEqual(payload.documents);
    expect(result.value.workspace.instances).toEqual(payload.workspace.instances);
    expect(result.issues.filter((issue) => issue.severity === 'warning')).toHaveLength(5);
  });

  it('preserves future document versions as a warning', () => {
    const future = { ...payload, documents: [doc('list-1', 'checklist')] };
    const changed = { ...future.documents[0], schemaVersion: 2 };
    const result = deserializeWorkspaceBackup(serialize({ ...future, documents: [changed] }), compatibility);
    expect(result.ok).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'future-document-version' }));
  });

  it('warns for outdated documents and validates cascade references and geometry', () => {
    const oldCompatibility = { ...compatibility, documentTypes: [{ moduleId: 'checklist', documentType: 'list', schemaVersion: 3 }, ...compatibility.documentTypes.slice(1)] };
    const oldResult = deserializeWorkspaceBackup(serialize(), oldCompatibility);
    expect(oldResult.ok && oldResult.issues).toContainEqual(expect.objectContaining({ code: 'outdated-document-version' }));
    const brokenCascade = { ...payload, workspace: { ...workspace, tabs: workspace.tabs.map((tab) => tab.id === 'tab-2' ? { ...tab, cascadeOrder: ['window-1'] } : tab) } };
    expect(serializeWorkspaceBackup(brokenCascade, createdAt)).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ code: 'invalid-reference' })]) });
    const brokenGeometry = { ...payload, workspace: { ...workspace, instances: workspace.instances.map((instance) => instance.id === 'window-1' ? { ...instance, gridArea: { x: 0, y: 0, w: 0, h: 4 } } : instance) } };
    expect(serializeWorkspaceBackup(brokenGeometry, createdAt)).toMatchObject({ ok: false });
  });

  it('rejects foreign and future format versions before returning a snapshot', () => {
    const foreign = JSON.parse(serialize()) as Record<string, unknown>;
    foreign.format = 'project-board-plan';
    expect(deserializeWorkspaceBackup(JSON.stringify(foreign))).toMatchObject({ ok: false });
    const future = JSON.parse(serialize()) as Record<string, unknown>;
    future.formatVersion = 2;
    expect(deserializeWorkspaceBackup(JSON.stringify(future))).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'unsupported-format-version' })]),
    });
  });

  it('rejects broken references, duplicate IDs and unknown platform fields', () => {
    const broken: WorkspaceBackupPayload = {
      ...payload,
      workspace: {
        ...workspace,
        instances: [{ ...workspace.instances[0], tabId: 'missing' }, workspace.instances[1]],
      },
    };
    expect(serializeWorkspaceBackup(broken, createdAt)).toMatchObject({ ok: false });
    const duplicate: WorkspaceBackupPayload = { ...payload, documents: [doc('same'), doc('same')] };
    expect(serializeWorkspaceBackup(duplicate, createdAt)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'duplicate-id' })]),
    });
    const extra = JSON.parse(serialize()) as Record<string, unknown>;
    extra.extra = true;
    expect(deserializeWorkspaceBackup(JSON.stringify(extra))).toMatchObject({ ok: false });
  });

  it('rejects cycles and undefined instead of silently dropping fields', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const cyclic = { ...payload, documents: [{ ...doc('cycle'), content: cycle }] };
    expect(serializeWorkspaceBackup(cyclic, createdAt)).toMatchObject({ ok: false });
    const withUndefined = { ...payload, viewSettings: { 'window-1': { key: undefined } } };
    expect(serializeWorkspaceBackup(withUndefined, createdAt)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'non-json-value' })]),
    });
  });

  it('does not mutate inputs or share mutable objects with parsed output', () => {
    const source = structuredClone(payload);
    const json = serialize(source);
    const result = deserializeWorkspaceBackup(json);
    expect(source).toEqual(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    (result.value.documents[0].content as { nested: { active: boolean }[] }).nested[0].active = false;
    expect((source.documents[0].content as { nested: { active: boolean }[] }).nested[0].active).toBe(true);
  });

  it('safely preserves prototype-like content keys', () => {
    const content = JSON.parse('{"__proto__":{"polluted":true},"constructor":"kept"}') as Record<string, unknown>;
    const data = { ...payload, documents: [{ ...doc('keys'), content }] };
    const result = deserializeWorkspaceBackup(serialize(data));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = result.value.documents[0].content as Record<string, unknown>;
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
    expect(parsed.constructor).toBe('kept');
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });
});
