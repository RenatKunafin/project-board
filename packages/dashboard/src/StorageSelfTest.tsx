import { useEffect, useState } from 'react';
import {
  DocumentConflictError,
  type ManagedDocument,
} from '@project-board/widget-sdk';
import { createIndexedDbDocumentStore } from './document-store';

type StepStatus = 'pending' | 'running' | 'ok' | 'failed';

interface Step {
  readonly label: string;
  readonly status: StepStatus;
  readonly detail?: string;
}

const STEPS = [
  'Сохранение нового документа (revision 0)',
  'Чтение сохранённого документа',
  'Закрытие и повторное открытие БД',
  'Чтение после повторного открытия',
  'Конкурентная запись с исходной редакцией 0 отклоняется',
  'Удаление документа',
];

export function StorageSelfTest() {
  const [steps, setSteps] = useState<Step[]>(
    STEPS.map((label) => ({ label, status: 'pending' })),
  );

  useEffect(() => {
    let cancelled = false;

    const setStep = (index: number, update: Partial<Step>) => {
      if (!cancelled) {
        setSteps((previous) =>
          previous.map((step, i) => (i === index ? { ...step, ...update } : i < index ? { ...step, status: 'ok' } : step)),
        );
      }
    };

    (async () => {
      const name = `selftest-${crypto.randomUUID()}`;
      const document: ManagedDocument = {
        id: 'selftest-doc',
        moduleId: 'selftest',
        documentType: 'probe',
        title: 'Самопроверка хранилища',
        schemaVersion: 1,
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        content: { probe: true },
      };

      try {
        setStep(0, { status: 'running' });
        const store = createIndexedDbDocumentStore(name);
        await store.save(document, 0);
        setStep(0, { status: 'ok' });

        setStep(1, { status: 'running' });
        const loaded = await store.get(document.id);
        if (!loaded || loaded.revision !== 1) {
          throw new Error('документ не совпал после записи');
        }
        setStep(1, { status: 'ok' });

        setStep(2, { status: 'running' });
        store.close();
        const reopened = createIndexedDbDocumentStore(name);
        setStep(2, { status: 'ok' });

        setStep(3, { status: 'running' });
        const reloaded = await reopened.get(document.id);
        if (reloaded !== undefined && reloaded.revision !== 1) {
          throw new Error('документ изменился после повторного открытия');
        }
        setStep(3, { status: reloaded ? 'ok' : 'failed', detail: reloaded ? undefined : 'документ не найден' });

        setStep(4, { status: 'running' });
        let conflictCaught = false;
        try {
          await reopened.save(document, 0);
        } catch (error) {
          conflictCaught = error instanceof DocumentConflictError;
        }
        if (!conflictCaught) {
          throw new Error('конкурентная запись не отклонена');
        }
        setStep(4, { status: 'ok' });

        setStep(5, { status: 'running' });
        await reopened.delete(document.id);
        setStep(5, { status: 'ok' });

        reopened.close();
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSteps((previous) => {
          const index = previous.findIndex((step) => step.status === 'running');
          return index >= 0
            ? previous.map((step, i) =>
                i === index
                  ? {
                      ...step,
                      status: 'failed',
                      detail: error instanceof Error ? error.message : String(error),
                    }
                  : step,
              )
            : previous;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const failed = steps.some((step) => step.status === 'failed');
  const done = steps.every((step) => step.status === 'ok' || step.status === 'failed');

  return (
    <main className="shell selftest">
      <h1 className="shell__title">Самопроверка хранилища (IndexedDB)</h1>
      <p className={`selftest__result ${done ? (failed ? 'is-failed' : 'is-ok') : ''}`}>
        {done ? (failed ? 'FAILED' : 'OK') : 'RUNNING…'}
      </p>
      <ul className="selftest__steps">
        {steps.map((step) => (
          <li key={step.label} className={`is-${step.status}`}>
            {step.label}
            {step.status === 'ok' ? ' — OK' : ''}
            {step.status === 'failed' ? ` — ПРОВАЛ: ${step.detail ?? ''}` : ''}
          </li>
        ))}
      </ul>
    </main>
  );
}
