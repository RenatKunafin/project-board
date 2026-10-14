import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gantt, Willow } from '@svar-ui/react-gantt';
import type { IApi, IColumnConfig } from '@svar-ui/react-gantt';
import '@svar-ui/react-gantt/style.css';
import type { ManagedDocument, WidgetProps } from '@project-board/widget-sdk';
import { parsePlanContent, type PlanIssue } from './plan-document';
import { createWorkingCalendar } from './working-calendar';
import {
  ganttDayIso,
  nonWorkingDayKind,
  planToGanttLinks,
  planToGanttTasks,
} from './svar-adapter';
import './gantt.css';

/**
 * Перехватчики вешаются один раз на экземпляр api: React StrictMode
 * дважды вызывает init, а повторный intercept ломает обработку
 * (спайк PBT-014, ADR-5).
 */
const blockedApis = new WeakSet<IApi>();

export default function PlanGanttWidget({
  widgetInstanceId,
  documentId,
  documentService,
  visible,
}: WidgetProps) {
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
    // Подписка сохраняется при hidden: возврат показывает актуальный документ.
    const unsubscribe = documentService.subscribe(documentId, (updated) => {
      setDocument(updated);
    });
    return unsubscribe;
  }, [documentId, documentService]);

  const validation = useMemo(
    () => (document ? parsePlanContent(document.content) : undefined),
    [document],
  );
  const plan = validation?.ok ? validation.plan : undefined;
  const planRef = useRef(plan);
  planRef.current = plan;

  // Read-only (DoD-5): до задач редактирования (PBT-038/039) жесты
  // перетаскивания блокируются целиком — стор SVAR не расходится
  // с документом. Сверка стора ADR-5 приходит с PBT-039.
  // Специфика обёртки SVAR (прод-сборка, PBT-037): при первом эффекте
  // вызывается пользовательский init (наш перехватчик) ВМЕСТО внутреннего
  // заливания props в стор; заливка (P.init) происходит при повторном
  // запуске эффекта, а его deps стабильны — в prod второй запуск не
  // наступает и таблица остаётся пустой (в dev его даёт StrictMode).
  // Поэтому после монтирования форсируется второй рендер: tasks/links
  // передаются новыми массивами, deps эффекта меняются, внутренний init
  // заливает данные.
  const [, forceRerenderAfterMount] = useState(0);
  useEffect(() => {
    forceRerenderAfterMount((tick) => tick + 1);
  }, []);
  const initApi = useCallback((instance: IApi) => {
    console.log('[PBT-037 debug] initApi вызван'); // временная диагностика
    if (blockedApis.has(instance)) {
      console.log('[PBT-037 debug] instance уже заблокирован');
      return;
    }
    blockedApis.add(instance);
    instance.intercept('drag-task', () => false);
  }, []);

  const tasks = useMemo(
    () => (plan ? planToGanttTasks(plan) : []),
    [plan],
  );
  const links = useMemo(
    () => (plan ? planToGanttLinks(plan) : []),
    [plan],
  );

  // Колонки: окончание показывается включительно (inclusiveEnd),
  // «Раб. дни» — своя длительность из ядра вместо календарной SVAR.
  const columns = useMemo<IColumnConfig[]>(() => {
    const workingDaysCell = (rowId: string) => {
      const current = planRef.current;
      if (!current) {
        return null;
      }
      const calendar = createWorkingCalendar(current.calendar);
      const group = current.groups.find((entry) => entry.id === rowId);
      if (group !== undefined) {
        const children = current.tasks.filter(
          (task) => task.groupId === rowId,
        );
        if (children.length === 0) {
          return null;
        }
        const start = children.reduce(
          (min, task) => (task.start < min ? task.start : min),
          children[0].start,
        );
        const end = children.reduce(
          (max, task) => (task.end > max ? task.end : max),
          children[0].end,
        );
        return calendar.workingDaysBetween(start, end);
      }
      const task = current.tasks.find((entry) => entry.id === rowId);
      if (task === undefined) {
        return null;
      }
      return calendar.workingDaysBetween(task.start, task.end);
    };
    return [
      { id: 'text', header: 'Задача', flexgrow: 1 },
      { id: 'start', header: 'Начало', width: 100 },
      { id: 'end', header: 'Окончание', width: 100 },
      {
        id: 'work-days',
        header: 'Раб. дни',
        width: 80,
        cell: ({ row }) => workingDaysCell(String(row.id)),
      },
    ];
  }, [plan]);

  const highlightTime = useCallback(
    (date: Date, unit: 'day' | 'hour') => {
      if (unit !== 'day' || plan === undefined) {
        return '';
      }
      const kind = nonWorkingDayKind(plan, ganttDayIso(date));
      if (kind === 'holiday') {
        return 'gantt-holiday';
      }
      return kind === 'weekend' ? 'gantt-weekend' : '';
    },
    [plan],
  );

  if (!documentId || !documentService) {
    return (
      <section className="plan-gantt" data-widget-instance={widgetInstanceId}>
        <p className="plan-gantt__hint">План: документ не выбран.</p>
      </section>
    );
  }

  if (document === undefined) {
    return (
      <section className="plan-gantt" data-widget-instance={widgetInstanceId}>
        <p className="plan-gantt__hint">Загрузка плана…</p>
      </section>
    );
  }

  if (validation !== undefined && !validation.ok) {
    return (
      <section
        className="plan-gantt plan-gantt--error"
        data-widget-instance={widgetInstanceId}
      >
        <p className="plan-gantt__hint">
          Документ плана повреждён, отображение недоступно:
        </p>
        <ul className="plan-gantt__issues">
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

  return (
    <section
      className="plan-gantt"
      data-widget-instance={widgetInstanceId}
      data-plan-title={document.title}
    >
      {visible === false ? (
        <p className="plan-gantt__hint">
          Просмотр приостановлен: окно скрыто, документ обновляется в фоне.
        </p>
      ) : (
        <div className="plan-gantt__chart">
          <Willow>
            {/* Ключ по редакции: SVAR не синхронизирует стор с новыми
                props после init (спайк PBT-014) — внешние изменения
                документа применяются пересозданием представления.
                При PBT-039 заменяется точечными update-task (ADR-5). */}
            <Gantt
              key={document.revision}
              tasks={[...tasks]}
              links={[...links]}
              columns={columns}
              inclusiveEnd={true}
              init={initApi}
              highlightTime={highlightTime}
            />
          </Willow>
        </div>
      )}
    </section>
  );
}
