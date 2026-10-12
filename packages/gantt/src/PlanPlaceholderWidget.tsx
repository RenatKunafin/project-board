import { useEffect, useState } from 'react';
import type { WidgetProps } from '@project-board/widget-sdk';
import { parsePlanContent, planTitle, type PlanIssue } from './plan-document';

export default function PlanPlaceholderWidget({
  widgetInstanceId,
  documentId,
  documentService,
}: WidgetProps) {
  const [rawContent, setRawContent] = useState<unknown>(undefined);

  useEffect(() => {
    if (!documentId || !documentService) {
      return;
    }
    const document = documentService.get(documentId);
    if (document) {
      setRawContent(document.content);
    }
    const unsubscribe = documentService.subscribe(documentId, (updated) => {
      setRawContent(updated.content);
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

  if (rawContent === undefined) {
    return (
      <section className="plan-placeholder" data-widget-instance={widgetInstanceId}>
        <p className="plan-placeholder__hint">Загрузка плана…</p>
      </section>
    );
  }

  const validation = parsePlanContent(rawContent);
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
    <section className="plan-placeholder" data-widget-instance={widgetInstanceId} data-plan-title={planTitle(plan)}>
      <h3 className="plan-placeholder__title">{planTitle(plan)}</h3>
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
