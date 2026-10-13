import { useEffect, useState } from 'react';
import type { ManagedDocument, WidgetProps } from '@project-board/widget-sdk';
import { parsePlanContent, type PlanIssue } from './plan-document';

export default function PlanPlaceholderWidget({
  widgetInstanceId,
  documentId,
  documentService,
}: WidgetProps) {
  // Название плана — метаданные оболочки документа (ADR-5 PBT-002, PBT-025):
  // содержимое названия не содержит и платформой не интерпретируется.
  const [document, setDocument] = useState<ManagedDocument | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!documentId || !documentService) {
      return;
    }
    const current = documentService.get(documentId);
    if (current) {
      setDocument(current);
    }
    const unsubscribe = documentService.subscribe(documentId, (updated) => {
      setDocument(updated);
    });
    return unsubscribe;
  }, [documentId, documentService]);

  if (!documentId || !documentService) {
    return (
      <section className="plan-placeholder" data-widget-instance={widgetInstanceId}>
        <p className="plan-placeholder__hint">План: документ не выбран.</p>
      </section>
    );
  }

  if (document === undefined) {
    return (
      <section className="plan-placeholder" data-widget-instance={widgetInstanceId}>
        <p className="plan-placeholder__hint">Загрузка плана…</p>
      </section>
    );
  }

  const validation = parsePlanContent(document.content);
  if (!validation.ok) {
    return (
      <section
        className="plan-placeholder plan-placeholder--error"
        data-widget-instance={widgetInstanceId}
      >
        <p className="plan-placeholder__hint">
          Документ плана повреждён, отображение недоступно:
        </p>
        <ul className="plan-placeholder__issues">
          {validation.issues.map((issue: PlanIssue, index) => (
            <li key={`${issue.path}-${issue.code}-${index}`}>
              <span data-plan-issue-code={issue.code}>
                {issue.path ? `${issue.path}: ` : ''}
                {issue.message}
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const plan = validation.plan;
  return (
    <section className="plan-placeholder" data-widget-instance={widgetInstanceId} data-plan-title={document.title}>
      <h3 className="plan-placeholder__title">{document.title}</h3>
      <ul className="plan-placeholder__summary">
        <li>Задачи: {plan.tasks.length}</li>
        <li>Группы: {plan.groups.length}</li>
        <li>Ресурсы: {plan.resources.length}</li>
        <li>Зависимости: {plan.dependencies.length}</li>
      </ul>
      <p className="plan-placeholder__hint">
        Диаграмма Гантта появится после интеграции представления (PBT-037).
      </p>
    </section>
  );
}
