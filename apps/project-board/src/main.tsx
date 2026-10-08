import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  createDocumentService,
  createIndexedDbDocumentStore,
  createWidgetRegistry,
  StorageSelfTest,
} from '@project-board/dashboard';
import App from './App';
import { widgetTypes } from './widgets';
import './index.css';

// Технический маршрут самопроверки локального хранилища (не продуктовый UI):
// открывается только по явному #storage-selftest, используется e2e и вручную.
if (window.location.hash === '#storage-selftest') {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <StorageSelfTest />
    </React.StrictMode>,
  );
} else {
  bootstrap();
}

async function bootstrap(): Promise<void> {
  const store = createIndexedDbDocumentStore('project-board');
  const documentService = createDocumentService({ store });
  const restored = await documentService.restoreAll();

  // Вертикальный срез PBT-011: гарантировать два документа чек-листа.
  // Сортировка стабильна между перезагрузками (порядок IDB не гарантирован).
  const byCreation = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;
  const checklistIds = restored
    .filter(
      (document) =>
        document.moduleId === 'checklist' && document.documentType === 'list',
    )
    .sort(byCreation)
    .map((document) => document.id);
  while (checklistIds.length < 2) {
    checklistIds.push(
      documentService.create({
        moduleId: 'checklist',
        documentType: 'list',
        schemaVersion: 1,
        content: { items: [] },
      }).id,
    );
  }
  const [list1Id, list2Id] = checklistIds;

  const widgetRegistry = createWidgetRegistry(widgetTypes);

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App
        widgetRegistry={widgetRegistry}
        documentService={documentService}
        list1Id={list1Id}
        list2Id={list2Id}
      />
    </React.StrictMode>,
  );
}
