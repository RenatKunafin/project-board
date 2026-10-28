export * from './draft';
export * from './model';
export * from './operations';
export * from './service';

import { defineWidgetType } from '@project-board/widget-sdk';
import NotesWidget from './NotesWidget';
import { createEmptyNotesContent } from './model';

export { NotesWidget };

export function createNotesModule() {
  return { widgetTypes: [defineWidgetType({
    id: 'notes', title: 'Заметки', description: 'Блокноты с текстовыми заметками',
    icon: 'lucide:book-open', component: NotesWidget, startSettings: {},
    sizeConstraints: { minWidth: 3, minHeight: 3 },
    documentSupport: { moduleId: 'notes', documentType: 'notes', schemaVersion: 1, createContent: createEmptyNotesContent },
  })] };
}
