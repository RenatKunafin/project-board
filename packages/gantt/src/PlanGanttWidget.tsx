import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gantt, Willow } from '@svar-ui/react-gantt';
import type { IApi, IColumnConfig } from '@svar-ui/react-gantt';
import '@svar-ui/react-gantt/style.css';
import type { ManagedDocument, WidgetProps } from '@project-board/widget-sdk';
import { parsePlanContent, type PlanContent, type PlanIssue } from './plan-document';
import { createWorkingCalendar } from './working-calendar';
import {
  ganttDate,
  ganttDayIso,
  nonWorkingDayKind,
  planToGanttLinks,
  planToGanttTasks,
} from './svar-adapter';
import { createTask, deleteTask, moveTask, setTaskDates, updateTask } from './plan-commands';
import type { PlanCommandError, PlanCommandResult } from './plan-commands';
import {
  createResource,
  createWorkType,
  deleteResource,
  deleteWorkType,
  updateResource,
  updateWorkType,
} from './plan-catalogs';
import {
  createUnavailability,
  deleteUnavailability,
  updateUnavailability,
} from './plan-assignments';
import { createGroup, deleteGroup, updateGroup } from './plan-hierarchy';
import { addCalendarDays } from './working-calendar';
import { buildTaskDates, validateTaskForm, type TaskFormIssue } from './task-editor';
import type { GroupFormIssue } from './group-editor';
import TaskEditorDialog, { type TaskEditorSubmit } from './TaskEditorDialog';
import GroupEditorDialog, { type GroupEditorSubmit } from './GroupEditorDialog';
import ResourceCatalogDialog, { type CatalogCommand } from './ResourceCatalogDialog';
import './gantt.css';

type EditorState =
  | { readonly mode: 'create' }
  | { readonly mode: 'edit'; readonly taskId: string };

type GroupEditorState =
  | { readonly mode: 'group-create' }
  | { readonly mode: 'group-edit'; readonly groupId: string };

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
  // Dev-реестр api экземпляров (отладка жестов и e2e, прецедент
  // writeDocumentContent): id документа → SVAR api.
  const documentIdRef = useRef(documentId);
  documentIdRef.current = documentId;
  // Своя запись жеста не пересобирает чарт: стор синхронизирован точечным
  // update-task, remount по этой ревизии подавляется (плавность, D7).
  // Внешние записи (второй экземпляр, формы) remount'ят как прежде.
  const localRevisionRef = useRef<number | null>(null);
  const remountKeyRef = useRef<string>('init');
  // Ожидаемые даты задач после применённых правил жеста (база сравнения
  // сверток): собственная коррекция стора не должна переклассифицироваться
  // следующей сверкой как новый факт (механика спайка PBT-014: стор
  // сверяется с обновлённой моделью, а не с исходным документом).
  const gestureExpectedRef = useRef<Map<string, { start: string; end: string }>>(
    new Map(),
  );

  // Форма задачи (PBT-038): перерисовка чарта после записи происходит
  // по revision (remount key) — состояние формы хранить в документе не нужно.
  const [editor, setEditor] = useState<EditorState | undefined>(undefined);
  const focusAnchorRef = useRef<HTMLElement | null>(null);

  // Форма группы (PBT-040) — тот же механизм фокуса возврата.
  const [groupEditor, setGroupEditor] = useState<GroupEditorState | undefined>(
    undefined,
  );
  // Редактор справочников (PBT-041).
  const [catalogOpen, setCatalogOpen] = useState(false);

  // Сворачивание групп — состояние экземпляра (B4): множество свёрнутых
  // id в памяти виджета, переживает remount чарта по ревизии, в документ
  // не попадает. Слушается перехватчиком open-task (design D4).
  const [collapsedGroups, setCollapsedGroups] = useState<
    ReadonlySet<string>
  >(new Set());
  const collapsedRef = useRef(collapsedGroups);
  collapsedRef.current = collapsedGroups;

  const openEditor = useCallback((next: EditorState) => {
    focusAnchorRef.current =
      window.document.activeElement instanceof HTMLElement
        ? window.document.activeElement
        : null;
    setEditor(next);
  }, []);

  const openCatalog = useCallback(() => {
    focusAnchorRef.current =
      window.document.activeElement instanceof HTMLElement
        ? window.document.activeElement
        : null;
    setCatalogOpen(true);
  }, []);

  const closeCatalog = useCallback(() => {
    setCatalogOpen(false);
    focusAnchorRef.current?.focus();
    focusAnchorRef.current = null;
  }, []);

  const openGroupEditor = useCallback((next: GroupEditorState) => {
    focusAnchorRef.current =
      window.document.activeElement instanceof HTMLElement
        ? window.document.activeElement
        : null;
    setGroupEditor(next);
  }, []);

  const closeEditor = useCallback(() => {
    setEditor(undefined);
    focusAnchorRef.current?.focus();
    focusAnchorRef.current = null;
  }, []);

  const closeGroupEditor = useCallback(() => {
    setGroupEditor(undefined);
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
    (submit: TaskEditorSubmit): TaskFormIssue | undefined => {
      const current = planRef.current;
      if (current === undefined) {
        return undefined;
      }
      const input = {
        title: submit.title,
        ...(submit.groupId === undefined ? {} : { groupId: submit.groupId }),
        start: submit.start,
        durationDays: submit.durationDays,
      };
      const issue = validateTaskForm(input, current);
      if (issue !== undefined) {
        return issue;
      }
      const dates = buildTaskDates(input, current);
      const currentTask =
        editor?.mode === 'edit'
          ? current.tasks.find((task) => task.id === editor.taskId)
          : undefined;
      let coreError: TaskFormIssue | undefined;
      commitPlan((latest) => {
        const validationNow = parsePlanContent(latest.content);
        if (!validationNow.ok) {
          return undefined;
        }
        const base = validationNow.plan;
        // Назначения (PBT-042): пустое множество снимает все (поле убирается).
        const assignments = {
          ...(submit.assigneeIds.length > 0
            ? { assigneeIds: submit.assigneeIds }
            : { assigneeIds: [] as readonly string[] }),
          ...(submit.workTypeIds.length > 0
            ? { workTypeIds: submit.workTypeIds }
            : { workTypeIds: [] as readonly string[] }),
        };
        const result = ((): PlanCommandResult => {
          if (currentTask === undefined) {
            return createTask(base, {
              title: input.title,
              start: dates.start,
              end: dates.end,
              ...(input.groupId === undefined
                ? {}
                : { groupId: input.groupId }),
              ...assignments,
            });
          }
          const updated = updateTask(base, currentTask.id, {
            title: input.title,
            ...(input.groupId === undefined
              ? { groupId: undefined }
              : { groupId: input.groupId }),
            ...assignments,
          });
          if (!updated.ok) {
            return updated;
          }
          return setTaskDates(updated.plan, currentTask.id, {
            start: dates.start,
            end: dates.end,
          });
        })();
        if (!result.ok) {
          coreError = { field: 'assignments', message: result.error.message };
          return undefined;
        }
        return result.plan;
      });
      if (coreError !== undefined) {
        return coreError;
      }
      closeEditor();
      return undefined;
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

  // Форма группы (PBT-040): createGroup/updateGroup/deleteGroup ядра.
  // Клиентскую валидацию выполняет форма; ошибка ядра (circular-group
  // и т.п.) возвращается форме — показывается под полем родителя.
  const submitGroupForm = useCallback(
    (submit: GroupEditorSubmit): GroupFormIssue | undefined => {
      const current = planRef.current;
      if (current === undefined) {
        return undefined;
      }
      const input = {
        title: submit.title,
        ...(submit.parentId === '' ? {} : { parentId: submit.parentId }),
      };
      const editingGroupId =
        groupEditor?.mode === 'group-edit' ? groupEditor.groupId : undefined;
      let coreError: GroupFormIssue | undefined;
      commitPlan((latest) => {
        const validationNow = parsePlanContent(latest.content);
        if (!validationNow.ok) {
          return undefined;
        }
        const base = validationNow.plan;
        const result =
          editingGroupId === undefined
            ? createGroup(base, input)
            : updateGroup(base, editingGroupId, {
                title: input.title,
                parentId:
                  submit.parentId === '' ? undefined : submit.parentId,
              });
        if (!result.ok) {
          coreError = { field: 'parent', message: result.error.message };
          return undefined;
        }
        return result.plan;
      });
      if (coreError !== undefined) {
        return coreError;
      }
      closeGroupEditor();
      return undefined;
    },
    [groupEditor, commitPlan, closeGroupEditor],
  );

  const deleteCurrentGroup = useCallback(() => {
    if (groupEditor?.mode !== 'group-edit') {
      return;
    }
    const groupId = groupEditor.groupId;
    commitPlan((latest) => {
      const validationNow = parsePlanContent(latest.content);
      if (!validationNow.ok) {
        return undefined;
      }
      const removed = deleteGroup(validationNow.plan, groupId);
      return removed.ok ? removed.plan : undefined;
    });
    closeGroupEditor();
  }, [groupEditor, commitPlan, closeGroupEditor]);

  // Команды справочников (PBT-041): делегирование функциям ядра
  // plan-catalogs; ошибка ядра возвращается диалогу (показ по месту).
  const applyCatalogCommand = useCallback(
    (command: CatalogCommand): PlanCommandError | undefined => {
      let error: PlanCommandError | undefined;
      commitPlan((latest) => {
        const validationNow = parsePlanContent(latest.content);
        if (!validationNow.ok) {
          return undefined;
        }
        const base = validationNow.plan;
        const result = ((): PlanCommandResult => {
          switch (command.type) {
            case 'createResource':
              return createResource(base, { title: command.title });
            case 'renameResource':
              return updateResource(base, command.resourceId, {
                title: command.title,
              });
            case 'deleteResource':
              return deleteResource(base, command.resourceId);
            case 'createWorkType':
              return createWorkType(base, {
                title: command.title,
                allowsParallel: command.allowsParallel,
              });
            case 'renameWorkType':
              return updateWorkType(base, command.workTypeId, {
                title: command.title,
              });
            case 'toggleWorkTypeParallel':
              return updateWorkType(base, command.workTypeId, {
                allowsParallel: command.allowsParallel,
              });
            case 'deleteWorkType':
              return deleteWorkType(base, command.workTypeId);
            case 'createUnavailability':
              return createUnavailability(base, {
                resourceId: command.resourceId,
                start: command.start,
                end: command.end,
              });
            case 'updateUnavailability':
              return updateUnavailability(base, command.unavailabilityId, {
                resourceId: command.resourceId,
                start: command.start,
                end: command.end,
              });
            case 'deleteUnavailability':
              return deleteUnavailability(base, command.unavailabilityId);
          }
        })();
        if (!result.ok) {
          error = result.error;
          return undefined;
        }
        return result.plan;
      });
      return error;
    },
    [commitPlan],
  );

  // Read-only сводных (B2): строки задач двигаются, сводные полосы
  // определяются дочерними задачами. Специфика обёртки SVAR
  // (прод-сборка, PBT-037): при первом эффекте вызывается пользовательский
  // init ВМЕСТО внутреннего заливания props в стор; заливка (P.init)
  // происходит при повторном запуске эффекта, а его deps стабильны — в
  // prod второй запуск не наступает и таблица остаётся пустой (в dev его
  // даёт StrictMode). Поэтому после монтирования форсируется второй
  // рендер: tasks/links передаются новыми массивами, deps эффекта
  // меняются, внутренний init заливает данные.
  const [, forceRerenderAfterMount] = useState(0);
  useEffect(() => {
    forceRerenderAfterMount((tick) => tick + 1);
  }, []);
  const apiRef = useRef<IApi | null>(null);
  const initApi = useCallback((instance: IApi) => {
    if (blockedApis.has(instance)) {
      return;
    }
    blockedApis.add(instance);
    apiRef.current = instance;
    const registry = ((window as unknown as Record<string, unknown>).__ganttApiRegistry ??
      {}) as Record<string, IApi>;
    registry[String(documentIdRef.current)] = instance;
    (window as unknown as Record<string, unknown>).__ganttApiRegistry = registry;
    // Сводные полосы не двигаются (B2, design D3): задача документа
    // перетаскивается, строка группы — нет.
    instance.intercept('drag-task', (event: unknown) => {
      const rawId = (event as { id?: unknown } | undefined)?.id;
      if (typeof rawId !== 'string') {
        return false;
      }
      const planNow = planRef.current;
      if (planNow === undefined) {
        return false;
      }
      const rowId = rawId.startsWith(':') ? rawId.slice(1) : rawId;
      if (planNow.groups.some((group) => group.id === rowId)) {
        return false;
      }
      return planNow.tasks.some((task) => task.id === rowId);
    });
    // Сворачивание/раскрытие — состояние экземпляра (B4, design D4):
    // стор применяет действие сам, наблюдатель запоминает свёрнутые
    // группы для восстановления при пересборке представления.
    instance.intercept('open-task', (event: unknown) => {
      const { id, mode } = (event as { id?: unknown; mode?: unknown }) ?? {};
      if (typeof id !== 'string') {
        return undefined;
      }
      const rowId = id.startsWith(':') ? id.slice(1) : id;
      setCollapsedGroups((previous) => {
        const next = new Set(previous);
        if (mode === false) {
          next.add(rowId);
        } else {
          next.delete(rowId);
        }
        return next;
      });
      return undefined;
    });
  }, []);

  // Двойной клик по строке открывает форму: задачи — редактирование
  // задачи (PBT-038), группы — редактирование группы (PBT-040).
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
        return;
      }
      if (planRef.current.groups.some((group) => group.id === rowId)) {
        openGroupEditor({ mode: 'group-edit', groupId: rowId });
      }
    },
    [openEditor, openGroupEditor],
  );

  // ─── Диапазон шкалы (перерендер столбцов, наблюдение владельца
  // 2026-10-14) ────────────────────────────────────────────────────────────
  // Без заданных start/end SVAR при каждом update-task пересчитывает
  // диапазон под задачи (autoScale) и пересобирает колонки календаря.
  // Диапазон задаём с запасом (−60/+365 дней) и расширяем только при
  // выходе задачи за него; собственные записи жеста его не трогают.
  const chartRangeRef = useRef<{ start: Date; end: Date; anchor: string } | null>(
    null,
  );
  const [rangeTick, setRangeTick] = useState(0);
  // Расширение диапазона, если задача вышла за него (после коррекции/записи).
  const ensureChartRangeCovers = useCallback(
    (startIso: string, endIso: string) => {
      const prev = chartRangeRef.current;
      if (prev === null) {
        return;
      }
      const padStart = addCalendarDays(startIso, -30);
      const padEnd = addCalendarDays(endIso, 30);
      if (
        ganttDayIso(prev.start) <= padStart &&
        ganttDayIso(prev.end) >= padEnd
      ) {
        return;
      }
      chartRangeRef.current = {
        start: ganttDate(
          ganttDayIso(prev.start) <= padStart
            ? ganttDayIso(prev.start)
            : padStart,
        ),
        end: ganttDate(
          ganttDayIso(prev.end) >= padEnd ? ganttDayIso(prev.end) : padEnd,
        ),
        anchor: prev.anchor,
      };
      setRangeTick((tick) => tick + 1);
    },
    [],
  );

  // ─── Жесты drag/resize (ADR-5, PBT-039; плавность — уточнение владельца
  // от 2026-10-14, design PBT-039 D7) ─────────────────────────────────────
  // Payload жестов SVAR ненадёжен: после отпускания кнопки стор сверяется
  // с документом, расхождение краёв классифицируется и применяется
  // правилами ядра (спайк PBT-014). Исправленные даты немедленно
  // возвращаются в стор точечным update-task — полоса встаёт по правилам
  // (привязка к рабочим дням) в момент жеста, а не после remount.
  const applyGestureRules = useCallback(
    (taskId: string, storeStart: string, storeEndInc: string, persist: boolean) => {
      if (!documentId || !documentService) {
        return;
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const latest = documentService.get(documentId) ?? documentRef.current;
        if (latest === undefined) {
          return;
        }
        const parsed = parsePlanContent(latest.content);
        if (!parsed.ok) {
          return;
        }
        const current = parsed.plan.tasks.find((task) => task.id === taskId);
        if (current === undefined) {
          return;
        }
        // База классификации — ожидаемые даты после предыдущих коррекций
        // этой же свертки (в начале жеста равны документу).
        const expected =
          gestureExpectedRef.current.get(taskId) ?? {
            start: current.start,
            end: current.end,
          };
        // Стор уже соответствует ожиданию (применено, отменено или
        // доанимировано до правила) — применять нечего.
        if (expected.start === storeStart && expected.end === storeEndInc) {
          return;
        }
        const daysDelta = (fromIso: string, toIso: string): number =>
          Math.round(
            (Date.parse(`${toIso}T00:00:00Z`) -
              Date.parse(`${fromIso}T00:00:00Z`)) /
              86_400_000,
          );
        const dStart = daysDelta(expected.start, storeStart);
        const dEnd = daysDelta(expected.end, storeEndInc);
        const result =
          dStart !== 0 && dStart === dEnd
            ? moveTask(parsed.plan, taskId, storeStart)
            : dStart !== 0
              ? setTaskDates(parsed.plan, taskId, {
                  start: storeStart,
                  end: expected.end,
                })
              : setTaskDates(parsed.plan, taskId, {
                  start: expected.start,
                  end: storeEndInc,
                });
        const api = apiRef.current;
        if (!result.ok) {
          // Отклонение ядром (например, перевёрнутый интервал) —
          // отмена жеста: полоса возвращается к датам документа.
          api?.exec('update-task', {
            id: taskId,
            task: {
              start: ganttDate(current.start),
              end: ganttDate(addCalendarDays(current.end, 1)),
            },
          });
          return;
        }
        const next = result.plan.tasks.find((task) => task.id === taskId);
        if (next === undefined) {
          return;
        }
        // Ожидание обновляется результатом правил: дальнейшие свертки
        // сверяются с ним, собственная коррекция не «новый факт».
        gestureExpectedRef.current.set(taskId, {
          start: next.start,
          end: next.end,
        });
        // Немедленная коррекция стора исправленными датами: правило ядра
        // (привязка начала к рабочему дню, пересчёт длительности) видно
        // сразу. Повторные свертки при доанимации стора идемпотентны.
        api?.exec('update-task', {
          id: taskId,
          task: {
            start: ganttDate(next.start),
            end: ganttDate(addCalendarDays(next.end, 1)),
          },
        });
        // Задача вышла за запас шкалы — расширяем (пересборка редкая).
        ensureChartRangeCovers(next.start, next.end);
        if (!persist) {
          // Промежуточная сверка: только визуальная коррекция, документ
          // запишет финальная сверка (одна ревизия на жест).
          return;
        }
        if (next.start === current.start && next.end === current.end) {
          // Правило вернуло те же даты — холостая ревизия исключена;
          // стор уже приведён к документу коррекцией выше.
          return;
        }
        try {
          const saved = documentService.update(
            documentId,
            latest.revision,
            result.plan,
          );
          // Своя запись жеста не пересобирает чарт: стор уже синхронен
          // документу (точечный update-task выше).
          localRevisionRef.current = saved.revision;
          return;
        } catch {
          // Конфликт ревизии (записал второй экземпляр) — перечитываем
          // документ и применяем факт заново относительно свежих данных.
        }
      }
    },
    [documentId, documentService],
  );

  // Финальная фиксация жеста: стор уже приведён правилами (сверка с
  // expected совпадает), записать результат в документ, если он отличается.
  const persistGesture = useCallback(
    (taskId: string) => {
      const expected = gestureExpectedRef.current.get(taskId);
      if (expected === undefined || !documentId || !documentService) {
        return;
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const latest = documentService.get(documentId) ?? documentRef.current;
        if (latest === undefined) {
          return;
        }
        const parsed = parsePlanContent(latest.content);
        if (!parsed.ok) {
          return;
        }
        const current = parsed.plan.tasks.find((task) => task.id === taskId);
        if (current === undefined) {
          return;
        }
        if (current.start === expected.start && current.end === expected.end) {
          return; // документ уже содержит результат жеста
        }
        const plan: PlanContent = {
          ...parsed.plan,
          tasks: parsed.plan.tasks.map((task) =>
            task.id === taskId
              ? { ...task, start: expected.start, end: expected.end }
              : task,
          ),
        };
        try {
          const saved = documentService.update(
            documentId,
            latest.revision,
            plan,
          );
          localRevisionRef.current = saved.revision;
          return;
        } catch {
          // Конфликт ревизии — перечитываем и повторяем.
        }
      }
    },
    [documentId, documentService],
  );

  useEffect(() => {
    // Стор применяет жест с нестабильной задержкой и анимацией подлёта.
    // Сверки 250/700 мс немедленно корректируют полосу правилами ядра
    // (update-task, без записи); запись документа — по последней сверке
    // (1500 мс): одна ревизия на жест, промежуточная доанимация стора
    // подхватывается следующей сверкой.
    const scheduleGestureSync = () => {
      // Новый жест: база сравнения — текущие даты документа (expected
      // заполняется правилами по мере сверок).
      gestureExpectedRef.current.clear();
      const readOnce = () => {
        const api = apiRef.current;
        const planNow = planRef.current;
        if (api === null || planNow === undefined) {
          return null;
        }
        for (const task of planNow.tasks) {
          let stored: { start?: unknown; end?: unknown };
          try {
            stored = api.getTask(task.id) as typeof stored;
          } catch {
            continue;
          }
          if (!(stored.start instanceof Date) || !(stored.end instanceof Date)) {
            continue;
          }
          const storeStart = ganttDayIso(stored.start);
          const endDate = new Date(stored.end);
          endDate.setDate(endDate.getDate() - 1);
          const storeEndInc = ganttDayIso(endDate);
          if (storeStart !== task.start || storeEndInc !== task.end) {
            return { taskId: task.id, storeStart, storeEndInc };
          }
        }
        return null;
      };
      const correct = (persist: boolean) => {
        const observed = readOnce();
        if (observed !== null) {
          applyGestureRules(
            observed.taskId,
            observed.storeStart,
            observed.storeEndInc,
            persist,
          );
        }
        if (persist && gestureExpectedRef.current.size > 0) {
          // Финальная фиксация: правила уже применены к стору промежуточными
          // сверками (или этой сверкой) — записать ожидание, если документ
          // ещё отличается (persistGesture идемпотентен, двойной записи нет).
          const [taskId] = gestureExpectedRef.current.keys();
          persistGesture(taskId);
        }
      };
      window.setTimeout(() => correct(false), 250);
      window.setTimeout(() => correct(false), 700);
      window.setTimeout(() => correct(true), 1500);
    };
    // Capture-фаза на документе без фильтра по чарту: SVAR останавливает
    // всплытие mouseup внутри чарта, а отпускание кнопки ВНЕ чарта тоже
    // обязано применять факт — иначе полоса застывает в брошенном
    // положении до следующего remount (дефект отладки 2026-10-14).
    // Свертка идемпотентна: без расхождения это только чтения.
    const captureHandler = () => scheduleGestureSync();
    window.document.addEventListener('mouseup', captureHandler, true);
    window.document.addEventListener('touchend', captureHandler, true);
    return () => {
      window.document.removeEventListener('mouseup', captureHandler, true);
      window.document.removeEventListener('touchend', captureHandler, true);
    };
  }, [applyGestureRules, persistGesture]);

  // ─── Стабилизация props SVAR (мерцание чарта, уточнение 2026-10-14) ─────
  // Обёртка SVAR при каждом изменении ссылок props перезаливает стор целиком
  // (P.init в эффекте обёртки) — полная перерисовка чарта, включая столбцы
  // календаря. При собственной записи жеста стор уже синхронен документу
  // (точечный update-task), поэтому props продолжают отдавать прежнюю версию
  // данных: перезаливки нет. Новые props — только при внешних изменениях
  // (второй экземпляр, формы) и при изменении сворачивания.
  const svarSourceRef = useRef<{
    plan: PlanContent;
    collapsed: ReadonlySet<string>;
  } | null>(null);
  const ownWrite =
    document !== undefined &&
    localRevisionRef.current !== null &&
    document.revision === localRevisionRef.current;
  // Стабильная версия данных, отданная в SVAR: при собственной записи
  // жеста возвращается прежний объект (ссылки props не меняются —
  // перезаливки нет), при внешних изменениях создаётся новый.
  const source = useMemo(
    () =>
      svarSourceRef.current !== null && ownWrite
        ? svarSourceRef.current
        : plan !== undefined
          ? { plan, collapsed: collapsedGroups }
          : null,
    // svarSourceRef намеренно вне deps: это «данные, уже залитые в стор».
    [ownWrite, plan, collapsedGroups],
  );
  useEffect(() => {
    svarSourceRef.current = source;
  }, [source]);
  const chartRange = useMemo(() => {
    if (source === null) {
      return undefined;
    }
    let min: string | undefined;
    let max: string | undefined;
    for (const task of source.plan.tasks) {
      if (min === undefined || task.start < min) {
        min = task.start;
      }
      if (max === undefined || task.end > max) {
        max = task.end;
      }
    }
    const prev = chartRangeRef.current;
    if (min === undefined || max === undefined) {
      return prev ?? undefined;
    }
    const wantStart = addCalendarDays(min, -60);
    const wantEnd = addCalendarDays(max, 365);
    if (
      prev !== null &&
      ganttDayIso(prev.start) <= wantStart &&
      ganttDayIso(prev.end) >= wantEnd
    ) {
      // Запас покрывает данные — шкала не трогается (стабильные ссылки).
      return prev;
    }
    const anchor = min;
    const next =
      prev !== null
        ? {
            start: ganttDate(
              ganttDayIso(prev.start) <= wantStart
                ? ganttDayIso(prev.start)
                : wantStart,
            ),
            end: ganttDate(
              ganttDayIso(prev.end) >= wantEnd ? ganttDayIso(prev.end) : wantEnd,
            ),
            anchor,
          }
        : { start: ganttDate(wantStart), end: ganttDate(wantEnd), anchor };
    chartRangeRef.current = next;
    return next;
    // rangeTick — принудительный пересчёт после расширения из жестов.
  }, [source, rangeTick]);
  // Прокрутка шкалы к началу плана после пересборки представления
  // (перезаливка сбрасывает позицию прокрутки). Отступ −2 дня: полоса
  // не упирается в левый край видимой области, а её центр остаётся
  // в пределах вьюпорта для жестов в обе стороны.
  useEffect(() => {
    if (source === null || chartRange === undefined) {
      return;
    }
    apiRef.current?.exec('scroll-chart', {
      date: ganttDate(addCalendarDays(chartRange.anchor, -2)),
    });
  }, [source, chartRange]);
  const tasks = useMemo(
    // Раскрытие групп — состояние экземпляра (B4): свёрнутые группы
    // передаются адаптеру (open: false), при пересборке представления
    // после записи документа раскрытие не сбрасывается.
    () => (source ? planToGanttTasks(source.plan, source.collapsed) : []),
    [source],
  );
  const links = useMemo(
    () => (source ? planToGanttLinks(source.plan) : []),
    [source],
  );
  useEffect(() => {
    svarSourceRef.current = source;
  }, [source]);
  // Ревизия своей записи жеста продолжает прежний ключ: пересборка чарта
  // на неё не нужна (стор уже синхронен документу). Внешние ревизии
  // (второй экземпляр, формы) меняют ключ и пересобирают представление.
  const chartRemountKey =
    document === undefined
      ? 'init'
      : localRevisionRef.current !== null &&
          document.revision === localRevisionRef.current
        ? remountKeyRef.current
        : String(document.revision);
  remountKeyRef.current = chartRemountKey;

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
      {
        id: 'assignees',
        header: 'Исполнители',
        width: 130,
        cell: ({ row }) => {
          const current = planRef.current;
          if (!current) {
            return null;
          }
          const rowId = String(row.id);
          const task = current.tasks.find((entry) => entry.id === rowId);
          if (task === undefined) {
            return null;
          }
          if (task.assigneeIds === undefined || task.assigneeIds.length === 0) {
            return '—';
          }
          return task.assigneeIds
            .map(
              (id) =>
                current.resources.find((entry) => entry.id === id)?.title ?? '—',
            )
            .join(', ');
        },
      },
      {
        id: 'work-types',
        header: 'Типы',
        width: 110,
        cell: ({ row }) => {
          const current = planRef.current;
          if (!current) {
            return null;
          }
          const rowId = String(row.id);
          const task = current.tasks.find((entry) => entry.id === rowId);
          if (task === undefined || task.workTypeIds === undefined) {
            return null;
          }
          if (task.workTypeIds.length === 0) {
            return '—';
          }
          return task.workTypeIds
            .map(
              (id) =>
                current.workTypes.find((entry) => entry.id === id)?.title ?? '—',
            )
            .join(', ');
        },
      },
    ];
    // Своя запись жеста не меняет колонки: SVAR перерисовывает ячейку
    // строки при update-task, значение читается из свежего planRef.
  }, [source]);

  const highlightTime = useCallback(
    (date: Date, unit: 'day' | 'hour') => {
      if (unit !== 'day' || source === null) {
        return '';
      }
      const kind = nonWorkingDayKind(source.plan, ganttDayIso(date));
      if (kind === 'holiday') {
        return 'gantt-holiday';
      }
      return kind === 'weekend' ? 'gantt-weekend' : '';
    },
    [source],
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
            <button
              type="button"
              className="plan-gantt__add-button"
              data-add-group
              onClick={() => openGroupEditor({ mode: 'group-create' })}
            >
              + Группа
            </button>
            <button
              type="button"
              className="plan-gantt__add-button"
              data-catalogs
              onClick={openCatalog}
            >
              Справочники
            </button>
            <span className="plan-gantt__count" data-task-count>
              Задач: {plan?.tasks.length ?? 0}
            </span>
          </div>
          <div className="plan-gantt__chart" onDoubleClick={onChartDoubleClick}>
            <Willow>
              {/* Ключ по ревизии: SVAR не синхронизирует стор с новыми
                  props после init (спайк PBT-014) — внешние изменения
                  документа применяются пересозданием представления.
                  Своя запись жеста подавляет remount (D7 PBT-039). */}
              <Gantt
                key={chartRemountKey}
                tasks={tasks}
                links={links}
                columns={columns}
                inclusiveEnd={true}
                autoScale={false}
                start={chartRange?.start}
                end={chartRange?.end}
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
          {groupEditor !== undefined && plan !== undefined && (
            <GroupEditorDialog
              plan={plan}
              mode={groupEditor.mode === 'group-create' ? 'create' : 'edit'}
              group={
                groupEditor.mode === 'group-edit'
                  ? plan.groups.find((group) => group.id === groupEditor.groupId)
                  : undefined
              }
              onSubmit={submitGroupForm}
              onDelete={deleteCurrentGroup}
              onClose={closeGroupEditor}
            />
          )}
          {catalogOpen && plan !== undefined && (
            <ResourceCatalogDialog
              plan={plan}
              applyCommand={applyCatalogCommand}
              onClose={closeCatalog}
            />
          )}
        </div>
      )}
    </section>
  );
}
