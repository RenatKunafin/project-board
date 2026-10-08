import React from 'react';
import ReactDOM from 'react-dom/client';
import { createDocumentService, createWidgetRegistry } from '@project-board/dashboard';
import App from './App';
import { widgetTypes } from './widgets';
import './index.css';

const documentService = createDocumentService();
const checklistDocument = documentService.create({
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
