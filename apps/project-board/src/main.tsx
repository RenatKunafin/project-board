import React from 'react';
import ReactDOM from 'react-dom/client';
import { createWidgetRegistry } from '@project-board/dashboard';
import App from './App';
import { widgetTypes } from './widgets';
import './index.css';

const widgetRegistry = createWidgetRegistry(widgetTypes);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App widgetRegistry={widgetRegistry} />
  </React.StrictMode>,
);
