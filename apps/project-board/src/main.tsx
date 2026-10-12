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

const store = createIndexedDbDocumentStore('project-board');
const documentService = createDocumentService({ store });

// Отложенные правки записываются при закрытии/перезагрузке страницы (PBT-010).
window.addEventListener('pagehide', () => {
  void documentService.flushAll();
});

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
  const restored = await documentService.restoreAll();

  // Вертикальный срез PBT-011: гарантировать два документа чек-листа.
  // Сопоставление панелей с документами должно быть стабильным между
  // перезагрузками: сортируем (createdAt, затем id) и ПОСЛЕ создания
  // недостающих — иначе при создании двух документов в одну миллисекунду
  // панели после перезагрузки ссылаются на другие документы.
  const byCreation = (
    a: { createdAt: string; id: string },
    b: { createdAt: string; id: string },
  ): number =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;
  let checklistDocuments = restored
    .filter(
      (document) =>
        document.moduleId === 'checklist' && document.documentType === 'list',
    )
    .sort(byCreation);
  while (checklistDocuments.length < 2) {
    const created = documentService.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      content: { items: [] },
    });
    checklistDocuments = [...checklistDocuments, created].sort(byCreation);
  }
  const [list1Id, list2Id] = checklistDocuments.map((document) => document.id);

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
