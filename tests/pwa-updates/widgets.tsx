import { useEffect, useState } from 'react';
import { defineWidgetType, type WidgetProps } from '@project-board/widget-sdk';
import { widgetTypes as productionTypes } from '../../apps/project-board/src/widgets';

declare const __PBT_TEST_VERSION__: 'A' | 'B';
const version = __PBT_TEST_VERSION__;

function MigrationWidget({ documentId, documentService }: WidgetProps) {
  const [doc, setDoc] = useState(() => documentService?.get(documentId!));
  useEffect(() => documentService?.subscribe(documentId!, setDoc), [documentId, documentService]);
  return <div>
    <p>Сборка {version}</p>
    <output data-migration-content>{JSON.stringify(doc?.content)}</output>
  </div>;
}

export const widgetTypes = [...productionTypes, defineWidgetType({
  id: 'update-fixture', title: 'Контроль обновления', component: MigrationWidget,
  startSettings: {}, sizeConstraints: { minWidth: 4, minHeight: 3 },
  documentSupport: {
    moduleId: 'update-fixture', documentType: 'migration', schemaVersion: version === 'A' ? 1 : 2,
    createContent: () => ({ value: 'Старый документ' }),
    migrations: version === 'B' ? [{
      from: 1, to: 2,
      migrate: (content) => ({ ...(content as Record<string, unknown>), migrated: true }),
    }] : [],
  },
})];
