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
import {
  createTask,
  deleteTask,
  setTaskDates,
  updateTask,
} from './plan-commands';
import { buildTaskDates, validateTaskForm } from './task-editor';
import TaskEditorDialog, { type TaskEditorSubmit } from './TaskEditorDialog';
import './gantt.css';

type EditorState =
  | { readonly mode: 'create' }
  | { readonly mode: 'edit'; readonly taskId: string };

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
  const documentRef = useRef(document);
  documentRef.current = document;

  // Форма задачи (PBT-038): перерисовка чарта после записи происходит
  // по revision (remount key) — состояние формы хранить в документе не нужно.
  const [editor, setEditor] = useState<EditorState | undefined>(undefined);
  const focusAnchorRef = useRef<HTMLElement | null>(null);

  const openEditor = useCallback((next: EditorState) => {
    focusAnchorRef.current =
      window.document.activeElement instanceof HTMLElement
        ? window.document.activeElement
        : null;
    setEditor(next);
  }, []);

  const closeEditor = useCallback(() => {
    setEditor(undefined);
    focusAnchorRef.current?.focus();
    focusAnchorRef.current = null;
  }, []);

  // Запись в документ: команды применяются к плану, одна запись на
  // подтверждение формы. Конфликт ревизии (параллельная запись второго
  // экземпляра) — перечитываем документ и повторяем; команды чистые.
  const commitPlan = useCallback(
    (mutate: (latest: ManagedDocument) => unknown) => {
      const currentDocument = documentRef.current;
      if (!documentId || !documentService || currentDocument === undefined) {
        return;
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const latest = documentService.get(documentId) ?? currentDocument;
        try {
          const nextContent = mutate(latest);
          if (nextContent !== undefined) {
            documentService.update(
              documentId,
              latest.revision,
              nextContent as typeof latest.content,
            );
          }
          return;
        } catch (error) {
          if (attempt === 2) {
            throw error;
          }
        }
      }
    },
    [documentId, documentService],
  );

  const submitTaskForm = useCallback(
    (submit: TaskEditorSubmit) => {
      const current = planRef.current;
      if (current === undefined) {
        return;
      }
      const input = {
        title: submit.title,
        ...(submit.groupId === undefined ? {} : { groupId: submit.groupId }),
        start: submit.start,
        durationDays: submit.durationDays,
      };
      const issue = validateTaskForm(input, current);
      if (issue !== undefined) {
        return;
      }
      const dates = buildTaskDates(input, current);
      const currentTask =
        editor?.mode === 'edit'
          ? current.tasks.find((task) => task.id === editor.taskId)
          : undefined;
      commitPlan((latest) => {
        const validationNow = parsePlanContent(latest.content);
        if (!validationNow.ok) {
          return undefined;
        }
        const base = validationNow.plan;
        if (currentTask === undefined) {
          const created = createTask(base, {
            title: input.title,
            start: dates.start,
            end: dates.end,
            ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
          });
          return created.ok ? created.plan : undefined;
        }
        const updated = updateTask(base, currentTask.id, {
          title: input.title,
          ...(input.groupId === undefined
            ? { groupId: undefined }
            : { groupId: input.groupId }),
        });
        if (!updated.ok) {
          return undefined;
        }
        const dated = setTaskDates(updated.plan, currentTask.id, {
          start: dates.start,
          end: dates.end,
        });
        return dated.ok ? dated.plan : undefined;
      });
      closeEditor();
    },
    [editor, commitPlan, closeEditor],
  );

  const deleteCurrentTask = useCallback(() => {
    if (editor?.mode !== 'edit') {
      return;
    }
    const taskId = editor.taskId;
    commitPlan((latest) => {
      const validationNow = parsePlanContent(latest.content);
      if (!validationNow.ok) {
        return undefined;
      }
      const removed = deleteTask(validationNow.plan, taskId);
      return removed.ok ? removed.plan : undefined;
    });
    closeEditor();
  }, [editor, commitPlan, closeEditor]);

  // Read-only жестов сохраняется до PBT-039; правка задач — через форму.
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
    if (blockedApis.has(instance)) {
      return;
    }
    blockedApis.add(instance);
    instance.intercept('drag-task', () => false);
  }, []);

  // Двойной клик по строке задачи открывает форму редактирования.
  // SVAR помечает строки data-id с префиксом «:» (:t-… задачи, :g-… группы).
  const onChartDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-id]',
      );
      const rowId = row?.dataset.id?.slice(1);
      if (rowId === undefined || planRef.current === undefined) {
        return;
      }
      if (planRef.current.tasks.some((task) => task.id === rowId)) {
        openEditor({ mode: 'edit', taskId: rowId });
      }
    },
    [openEditor],
  );

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

  const editingTask =
    editor?.mode === 'edit'
      ? plan?.tasks.find((task) => task.id === editor.taskId)
      : undefined;

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
        <div className="plan-gantt__inner">
          <div className="plan-gantt__toolbar">
            <button
              type="button"
              className="plan-gantt__add-button"
              data-add-task
              onClick={() => openEditor({ mode: 'create' })}
            >
              + Задача
            </button>
            <span className="plan-gantt__count" data-task-count>
              Задач: {plan?.tasks.length ?? 0}
            </span>
          </div>
          <div className="plan-gantt__chart" onDoubleClick={onChartDoubleClick}>
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
          {editor !== undefined && plan !== undefined && (
            <TaskEditorDialog
              plan={plan}
              mode={editor.mode}
              task={editingTask}
              onSubmit={submitTaskForm}
              onDelete={deleteCurrentTask}
              onClose={closeEditor}
            />
          )}
        </div>
      )}
    </section>
  );
}
