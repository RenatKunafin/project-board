import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createDocumentService } from './document-service';
import { IndexedDbDocumentStore } from './document-store';
import { WorkspaceStore } from './workspace-store';
import { WorkspaceBackupStore } from './workspace-backup-store';

describe('состав снимка после подтверждённых записей', () => {
  it('включает открытые и закрытые документы, окно и его настройки без записи в ручную историю', async () => {
    const name = `recovery-capture-${crypto.randomUUID()}`;
    const persisted = vi.fn();
    const documentStore = new IndexedDbDocumentStore(name);
    const service = createDocumentService({ store: documentStore, onPersistedChange: persisted });
    const workspace = new WorkspaceStore(name, persisted);
    const backups = new WorkspaceBackupStore(name);
    await service.restoreAll();
    const open = service.create({ moduleId: 'checklist', documentType: 'list', schemaVersion: 1, title: 'Открыт', content: { items: [] } });
    const closed = service.create({ moduleId: 'checklist', documentType: 'list', schemaVersion: 1, title: 'Закрыт', content: { items: [] } });
    await service.flushAll();
    await workspace.save({
      tabs: [{ id: 'tab', title: 'План', position: 0, mode: 'grid', cascadeOrder: [], active: 1 }],
      instances: [{ id: 'window', tabId: 'tab', typeId: 'checklist', documentId: open.id, collapsed: 0 }],
      activeTabId: 'tab',
    });
    await workspace.saveViewSetting('window', { hideDone: true });
    const capture = await backups.readCapture();
    expect(capture.payload.documents.map((document) => document.id).sort()).toEqual([open.id, closed.id].sort());
    expect(capture.payload.workspace.instances).toMatchObject([{ id: 'window', documentId: open.id }]);
    expect(capture.payload.viewSettings).toEqual({ window: { hideDone: true } });
    expect(persisted).toHaveBeenCalledTimes(4);
    expect(await backups.list()).toEqual([]);
    backups.close(); workspace.close(); documentStore.close();
  });
});
