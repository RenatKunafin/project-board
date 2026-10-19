import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gantt, Willow } from '@svar-ui/react-gantt';
import type { IApi, IColumnConfig } from '@svar-ui/react-gantt';
import '@svar-ui/react-gantt/style.css';
import type { ManagedDocument, WidgetProps } from '@project-board/widget-sdk';
import {
  createPlanContent,
  parsePlanContent,
  PLAN_DOCUMENT_TYPE,
  PLAN_MODULE_ID,
  PLAN_SCHEMA_VERSION,
  type PlanContent,
  type PlanIssue,
} from './plan-document';
import {
  deserializePlanFile,
  planFileName,
  serializePlanFile,
} from './native-plan-format';
import {
  parseOnlineGanttFile,
  type OnlineGanttPayload,
} from './onlinegantt-parser';
import OnlineGanttImportDialog from './OnlineGanttImportDialog';
import AbsenceConvertDialog, {
  type AbsenceConvertInput,
} from './AbsenceConvertDialog';
import PlantUmlExportDialog from './PlantUmlExportDialog';
import {
  plantumlFileName,
  serializePlanToPlantUml,
  type PlantUmlExportNote,
} from './plantuml-export';
import { createWorkingCalendar } from './working-calendar';
import {
  ganttDate,
  ganttDayIso,
  nonWorkingDayKind,
  planToGanttLinks,
  planToGanttTasks,
} from './svar-adapter';
import { moveTask, setTaskDates } from './plan-commands';
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
import { updateCalendar } from './plan-commands';
import { createGroup, deleteGroup, updateGroup } from './plan-hierarchy';
import { addCalendarDays } from './working-calendar';
import type { GroupFormIssue } from './group-editor';
import TaskEditorDialog from './TaskEditorDialog';
import GroupEditorDialog, { type GroupEditorSubmit } from './GroupEditorDialog';
import ResourceCatalogDialog, { type CatalogCommand } from './ResourceCatalogDialog';
import PlanIssuesDialog, { usePlanIssues } from './PlanIssuesDialog';
import { useTaskForm, type TaskEditorState } from './use-task-form';
import {
  filterPlanForView,
  planFilterActive,
  type PlanViewFilter,
} from './plan-view-filter';
import './gantt.css';

type EditorState = TaskEditorState;

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
  settings,
  updateSettings,
  switchDocument,
}: WidgetProps) {
  const [document, setDocument] = useState<ManagedDocument | undefined>(
    undefined,
  );

  // Перенос плана файлом (PBT-051): результат последнего импорта —
  // краткое подтверждение или перечень проблем; документ при отказе
  // не создаётся, отмена выбора файла состояние не меняет.
  // PBT-053: проблемы обоих форматов структурно совместимы —
  // собственный формат и OnlineGantt .gantt показываются одной панелью.
  const [importResult, setImportResult] = useState<
    | { readonly ok: true; readonly title: string }
    | {
        readonly ok: false;
        readonly issues: readonly {
          code: string;
          path: string;
          message: string;
          details?: readonly {
            code: string;
            path: string;
            message: string;
          }[];
        }[];
      }
    | undefined
  >(undefined);

  // Предпросмотр импорта .gantt (PBT-053): разобранный payload живёт
  // до явного применения; создание документа — только по кнопке.
  const [onlineganttPreview, setOnlineganttPreview] = useState<
    | { readonly fileName: string; readonly payload: OnlineGanttPayload }
    | undefined
  >(undefined);

  // Фильтры представления (PBT-049): тулбар-контролы; изменение —
  // React-state + updateSettings (производное, документ не меняется).
  const [filterQuery, setFilterQuery] = useState<string>(
    typeof settings.filterQuery === 'string' ? settings.filterQuery : '',
  );
  const [filterResourceId, setFilterResourceId] = useState<string>(
    typeof settings.filterResourceId === 'string'
      ? settings.filterResourceId
      : '',
  );
  const applyFilters = useCallback(
    (query: string, resourceId: string) => {
      setFilterQuery(query);
      setFilterResourceId(resourceId);
      updateSettings?.({ filterQuery: query, filterResourceId: resourceId });
    },
    [updateSettings],
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
  // Список проблем плана (PBT-046).
  const [issuesOpen, setIssuesOpen] = useState(false);

  // Сворачивание групп — состояние экземпляра (B4): множество свёрнутых
  // id переживает remount чарта по ревизии, в документ не попадает.
  // PBT-049: состояние сохраняется в настройках экземпляра (ADR-6.4)
  // и восстанавливается при монтировании после перезапуска.
  const [collapsedGroups, setCollapsedGroups] = useState<
    ReadonlySet<string>
  >(
    () =>
      new Set(
        Array.isArray(settings.collapsedGroups)
          ? (settings.collapsedGroups as readonly string[])
          : [],
      ),
  );
  const collapsedRef = useRef(collapsedGroups);
  collapsedRef.current = collapsedGroups;
  // Запись раскрытия в настройки: перехватчики и showTask (замыкания
  // без зависимостей) пишут через ref.
  const updateSettingsRef = useRef(updateSettings);
  updateSettingsRef.current = updateSettings;
  const persistCollapsed = useCallback((next: ReadonlySet<string>) => {
    updateSettingsRef.current?.({ collapsedGroups: [...next] });
  }, []);

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

  // ─── Перенос плана файлом (PBT-051) ─────────────────────────────────────
  // Экспорт: формат PBT-050, скачивание клиентскими средствами
  // (Blob + a[download]); имя файла — конвенция генерации planFileName.
  const handleExportPlan = useCallback(() => {
    const planNow = planRef.current;
    const current = documentRef.current;
    if (planNow === undefined || current === undefined) {
      return;
    }
    const serialized = serializePlanFile({
      title: current.title,
      content: planNow,
    });
    const url = URL.createObjectURL(
      new Blob([serialized.json], { type: 'application/json' }),
    );
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = planFileName(new Date());
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  // Импорт: валидация до создания документа; успех — новый независимый
  // документ (политика PBT-050) и переключение окна на него (SDK
  // switchDocument, механизм замены документа платформы); отказ —
  // перечень проблем по месту, документ не создаётся. Отмена выбора
  // файла (change не сработал) состояние не меняет.
  // PBT-053: файлы .gantt идут в парсер OnlineGantt с предпросмотром
  // до создания (design D1/D2); прочие — собственный формат (PBT-051).
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const handleImportFile = useCallback(
    (file: File | undefined) => {
      if (file === undefined || documentService === undefined) {
        return;
      }
      void file.text().then((text) => {
        if (file.name.toLowerCase().endsWith('.gantt')) {
          const parsed = parseOnlineGanttFile(text);
          if (!parsed.ok) {
            setImportResult({ ok: false, issues: parsed.issues });
            return;
          }
          setImportResult(undefined);
          setOnlineganttPreview({ fileName: file.name, payload: parsed.payload });
          return;
        }
        const result = deserializePlanFile(text);
        if (!result.ok) {
          setImportResult({ ok: false, issues: result.issues });
          return;
        }
        const created = documentService.create({
          moduleId: PLAN_MODULE_ID,
          documentType: PLAN_DOCUMENT_TYPE,
          schemaVersion: PLAN_SCHEMA_VERSION,
          title: result.payload.title,
          content: result.payload.content,
        });
        setImportResult({ ok: true, title: created.title });
        switchDocument?.(created.id);
      });
    },
    [documentService, switchDocument],
  );

  // Применение предпросмотра .gantt (design D4): новый независимый
  // документ с названием из диалога, окно переключается, предпросмотр
  // закрывается. Отмена/Esc — только сброс состояния, данные не тронуты.
  const applyOnlineGanttImport = useCallback(
    (title: string) => {
      if (documentService === undefined || onlineganttPreview === undefined) {
        return;
      }
      const created = documentService.create({
        moduleId: PLAN_MODULE_ID,
        documentType: PLAN_DOCUMENT_TYPE,
        schemaVersion: PLAN_SCHEMA_VERSION,
        title,
        content: onlineganttPreview.payload.content,
      });
      setOnlineganttPreview(undefined);
      setImportResult({ ok: true, title: created.title });
      switchDocument?.(created.id);
    },
    [documentService, onlineganttPreview, switchDocument],
  );

  const cancelOnlineGanttImport = useCallback(() => {
    setOnlineganttPreview(undefined);
  }, []);


  // Форма задачи — общий хук с ресурсным видом (PBT-048): запись
  // документа с ретраем ревизии, submit/удаление, команды зависимостей.
  const {
    commitPlan,
    submitTaskForm,
    deleteCurrentTask,
    convertCurrentTaskToAbsence,
    applyDependencyCommand,
  } = useTaskForm({
    documentId,
    documentService,
    document,
    plan,
    editor,
    onClose: closeEditor,
  });

  // Преобразование задачи в отпуск (PBT-054): диалог поверх формы;
  // применение — атомарная замена ядра (use-task-form D3), после
  // успеха закрываются оба диалога, отмена трогает только диалог.
  const [absenceConvertOpen, setAbsenceConvertOpen] = useState(false);
  const applyAbsenceConvert = useCallback(
    (input: AbsenceConvertInput): string | undefined => {
      const failure = convertCurrentTaskToAbsence(input);
      if (failure !== undefined) {
        return failure;
      }
      setAbsenceConvertOpen(false);
      return undefined;
    },
    [convertCurrentTaskToAbsence],
  );

  // Экспорт PlantUML (PBT-056): предпросмотр из полного документа —
  // фильтры представления не участвуют и не меняются (DoD-5 карточки).
  const [plantumlPreview, setPlantumlPreview] = useState<
    | {
        readonly text: string;
        readonly report: readonly PlantUmlExportNote[];
        readonly fileName: string;
      }
    | undefined
  >(undefined);

  const openPlantumlExport = useCallback(() => {
    const planNow = planRef.current;
    const current = documentRef.current;
    if (planNow === undefined || current === undefined) {
      return;
    }
    const { text, report } = serializePlanToPlantUml({
      ...planNow,
      title: planNow.title ?? current.title,
    });
    setPlantumlPreview({
      text,
      report,
      fileName: plantumlFileName(new Date()),
    });
  }, []);

  const downloadPlantuml = useCallback(() => {
    if (plantumlPreview === undefined) {
      return;
    }
    const url = URL.createObjectURL(
      new Blob([plantumlPreview.text], {
        type: 'text/plain;charset=utf-8',
      }),
    );
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = plantumlPreview.fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [plantumlPreview]);

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
            case 'updateCalendar':
              return updateCalendar(
                base,
                command.workingDays,
                command.holidays,
                command.workingExceptions,
              );
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

  // Переход к задаче из списка проблем (PBT-046): раскрыть цепочку
  // свёрнутых групп-предков, прокрутить шкалу к дате, выделить строку.
  // Фильтры сбрасываются: задача может быть скрыта фильтром (PBT-049).
  const showTask = useCallback(
    (taskId: string) => {
    const planNow = planRef.current;
    const api = apiRef.current;
    if (planNow === undefined || api === null) {
      return;
    }
    const task = planNow.tasks.find((entry) => entry.id === taskId);
    if (task === undefined) {
      return;
    }
    const groupById = new Map(
      planNow.groups.map((group) => [group.id, group] as const),
    );
    const toOpen: string[] = [];
    let cursor = task.groupId;
    while (cursor !== undefined) {
      const group = groupById.get(cursor);
      if (group === undefined) {
        break;
      }
      toOpen.push(group.id);
      cursor = group.parentId;
    }
    if (toOpen.length > 0) {
      // Стор раскрывает группы немедленно (exec); collapsedGroups
      // синхронизируется для пересборки представления при следующей заливке.
      for (const id of toOpen) {
        api.exec('open-task', { id, mode: true });
      }
      setCollapsedGroups((previous) => {
        const next = new Set(previous);
        for (const id of toOpen) {
          next.delete(id);
        }
        persistCollapsed(next);
        return next;
      });
    }
    applyFilters('', '');
    api.exec('scroll-chart', { date: ganttDate(task.start) });
    api.exec('select-task', { id: taskId });
    },
    [applyFilters, persistCollapsed],
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
        persistCollapsed(next);
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
          // Задача скрыта фильтром представления (PBT-049) — в сторе её нет.
          if (
            stored === undefined ||
            !(stored.start instanceof Date) ||
            !(stored.end instanceof Date)
          ) {
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
  // Фильтр представления (PBT-049): производное от полного плана; чарт
  // рисует отфильтрованное дерево, проблемы и счётчик — полный план.
  const viewFilter = useMemo<PlanViewFilter>(
    () => ({ query: filterQuery, resourceId: filterResourceId }),
    [filterQuery, filterResourceId],
  );
  const filteredPlan = useMemo(
    () => (plan !== undefined ? filterPlanForView(plan, viewFilter) : undefined),
    [plan, viewFilter],
  );
  const filterActive = planFilterActive(viewFilter);
  const source = useMemo(
    () =>
      svarSourceRef.current !== null && ownWrite
        ? svarSourceRef.current
        : filteredPlan !== undefined
          ? { plan: filteredPlan, collapsed: collapsedGroups }
          : null,
    // svarSourceRef намеренно вне deps: это «данные, уже залитые в стор».
    [ownWrite, filteredPlan, collapsedGroups],
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
  // Проблемы плана (PBT-046): производное документа, без записей.
  const issues = usePlanIssues(plan ?? createPlanContent());
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
              Настройки плана
            </button>
            <button
              type="button"
              className={`plan-gantt__add-button${issues.length > 0 ? ' plan-gantt__issues-button' : ''}`}
              data-issues
              onClick={() => setIssuesOpen(true)}
            >
              Проблемы ({issues.length})
            </button>
            {/* BISECT: кнопки с компактным классом */}
            <button
              type="button"
              className="plan-gantt__add-button plan-gantt__icon-button"
              data-export-plan
              aria-label="Экспорт плана"
              onClick={handleExportPlan}
            >
              📤
            </button>
            <button
              type="button"
              className="plan-gantt__add-button plan-gantt__icon-button"
              data-export-plantuml
              aria-label="Экспорт PlantUML"
              onClick={openPlantumlExport}
            >
              📊
            </button>
            <button
              type="button"
              className="plan-gantt__add-button plan-gantt__icon-button"
              data-import-plan
              aria-label="Импорт плана"
              onClick={() => importInputRef.current?.click()}
            >
              📥
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,.gantt,application/json"
              className="plan-gantt__import-input"
              data-import-plan-input
              aria-label="Файл плана для импорта"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Сброс позволяет выбрать тот же файл повторно.
                event.target.value = '';
                handleImportFile(file);
              }}
            />
            <input
              type="search"
              className="plan-gantt__filter-input"
              data-gantt-filter-query
              placeholder="Фильтр: задача"
              value={filterQuery}
              onChange={(event) =>
                applyFilters(event.target.value, filterResourceId)
              }
            />
            <select
              className="plan-gantt__filter-select"
              data-gantt-filter-resource
              value={filterResourceId}
              onChange={(event) =>
                applyFilters(filterQuery, event.target.value)
              }
            >
              <option value="">Все ресурсы</option>
              {(plan?.resources ?? []).map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.title}
                </option>
              ))}
            </select>
            <span className="plan-gantt__count" data-task-count>
              Задач: {plan?.tasks.length ?? 0}
            </span>
          </div>
          {importResult !== undefined ? (
            <div
              className={`plan-gantt__transfer-result${
                importResult.ok ? '' : ' plan-gantt__transfer-result--error'
              }`}
              role={importResult.ok ? 'status' : 'alert'}
              data-import-plan-result
            >
              {importResult.ok ? (
                `План «${importResult.title}» импортирован: создан новый независимый документ.`
              ) : (
                <>
                  {'Файл не импортирован:'}
                  <ul className="plan-gantt__transfer-issues">
                    {importResult.issues.flatMap((issue, index) => (
                      <li key={`transfer-issue-${index}`}>
                        <span>
                          {issue.code}
                          {issue.path ? ` (${issue.path})` : ''}: {issue.message}
                        </span>
                        {(issue.details ?? []).map((detail, detailIndex) => (
                          <ul
                            className="plan-gantt__transfer-issues"
                            key={`transfer-detail-${detailIndex}`}
                          >
                            <li>
                              <span>
                                {detail.code}
                                {detail.path ? ` (${detail.path})` : ''}:{' '}
                                {detail.message}
                              </span>
                            </li>
                          </ul>
                        ))}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : null}
          {filterActive && filteredPlan !== undefined && filteredPlan.tasks.length === 0 ? (
            <p className="plan-gantt__filter-empty" data-gantt-filter-empty>
              Ничего не найдено по фильтру. Задачи документа не изменены.
            </p>
          ) : null}
          <div className="plan-gantt__chart" onDoubleClick={onChartDoubleClick}>
            <Willow>
              {/* Ключ по ревизии: SVAR не синхронизирует стор с новыми
                  props после init (спайк PBT-014) — внешние изменения
                  документа применяются пересозданием представления.
                  Своя запись жеста подавляет remount (D7 PBT-039). */}
              {/* Компактная плотность по референсу OnlineGantt (PBT-068,
                  замер 2026-10-16): день ≈ 33px, строка 36px — вместо
                  дефолтов SVAR 100/38, дающих ~10 дней в окно. */}
              <Gantt
                key={chartRemountKey}
                tasks={tasks}
                links={links}
                columns={columns}
                inclusiveEnd={true}
                cellWidth={33}
                cellHeight={36}
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
              applyDependencyCommand={applyDependencyCommand}
              onDelete={deleteCurrentTask}
              onConvertToAbsence={() => setAbsenceConvertOpen(true)}
              onClose={closeEditor}
            />
          )}
          {editor?.mode === 'edit' &&
            absenceConvertOpen &&
            editingTask !== undefined &&
            plan !== undefined && (
              <AbsenceConvertDialog
                taskTitle={editingTask.title}
                taskStart={editingTask.start}
                taskEnd={editingTask.end}
                resources={plan.resources}
                onApply={applyAbsenceConvert}
                onClose={() => setAbsenceConvertOpen(false)}
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
          {issuesOpen && (
            <PlanIssuesDialog
              issues={issues}
              onShowTask={showTask}
              onClose={() => setIssuesOpen(false)}
            />
          )}
          {plantumlPreview !== undefined && (
            <PlantUmlExportDialog
              text={plantumlPreview.text}
              report={plantumlPreview.report}
              fileName={plantumlPreview.fileName}
              onDownload={downloadPlantuml}
              onClose={() => setPlantumlPreview(undefined)}
            />
          )}
          {onlineganttPreview !== undefined && (
            <OnlineGanttImportDialog
              fileName={onlineganttPreview.fileName}
              payload={onlineganttPreview.payload}
              onApply={applyOnlineGanttImport}
              onCancel={cancelOnlineGanttImport}
            />
          )}
        </div>
      )}
    </section>
  );
}
