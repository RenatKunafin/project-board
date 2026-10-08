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
  await documentService.restoreAll();

  const existing = (await store.listAll()).find(
    (document) => document.moduleId === 'checklist' && document.documentType === 'list',
  );
  const checklistDocument =
    existing ??
    documentService.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      content: { items: [] },
    });

  const widgetRegistry = createWidgetRegistry(widgetTypes);

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App
        widgetRegistry={widgetRegistry}
        documentService={documentService}
        documentId={checklistDocument.id}
      />
    </React.StrictMode>,
  );
}
