import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Download,
  FolderPlus,
  Plus,
  Search,
  Settings2,
  Upload,
} from 'lucide-react';
import { Gantt, WillowDark } from '@svar-ui/react-gantt';
import type { IApi, IColumnConfig, IScaleConfig } from '@svar-ui/react-gantt';
import '@svar-ui/react-gantt/style.css';
// Иконки SVAR локально (PBT-073, design D2): WillowDark ниже подключается
// с fonts={false}, внешний запрос к cdn.svar.dev не выполняется (офлайн-PWA).
import './vendor/wx-icons/wx-icons.css';
import { DocumentConflictError, type ManagedDocument, type WidgetProps } from '@project-board/widget-sdk';
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
  createMondayFirstLocale,
  svarI18nContext,
} from './svar-locale';
import {
  ganttDate,
  ganttDayIso,
  nonWorkingDayKind,
  planToGanttLinks,
  planToGanttTasks,
} from './svar-adapter';
import { moveTask, setTaskDates } from './plan-commands';
import { createGroup, deleteGroup, updateGroup } from './plan-hierarchy';
import { addCalendarDays } from './working-calendar';
import type { GroupFormIssue } from './group-editor';
import TaskEditorDialog from './TaskEditorDialog';
import GroupEditorDialog, { type GroupEditorSubmit } from './GroupEditorDialog';
import ResourceCatalogDialog, { type SettingsSaveError } from './ResourceCatalogDialog';
import PlanIssuesDialog, { usePlanIssues } from './PlanIssuesDialog';
import { useTaskForm, type TaskEditorState } from './use-task-form';
import {
  filterPlanForView,
  planFilterActive,
  type PlanViewFilter,
} from './plan-view-filter';
import {
  convertZoomScrollLeft,
  formatIsoDayMonth,
  formatWeekRangeLabel,
  formatZoomDayLabel,
  normalizeGanttZoom,
  ZOOM_SCALE,
  type GanttZoom,
} from './zoom-utils';
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
  onResize,
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

  // Служебный статус последнего действия виджета (PBT-073, design D5):
  // показывается в футере представления (role="status"); в покое — пусто.
  const [footerStatus, setFooterStatus] = useState('');

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

  // Масштаб шкалы «Дни/Недели» (PBT-073, design D3): состояние экземпляра
  // через settings (ADR-6.4), документ не меняется. Дефолт — «Недели»:
  // компактная плотность PBT-068 остаётся режимом по умолчанию.
  const [ganttZoom, setGanttZoom] = useState<GanttZoom>(() =>
    normalizeGanttZoom(settings.ganttZoom),
  );
  const zoomCellWidth = ZOOM_SCALE[ganttZoom];
  // Локаль SVAR с началом недели в понедельник (PBT-076, design D2.3):
  // Gantt берёт weekStart из i18n-контекста;.Provider ниже оборачивает
  // чарт (null — деградация до дефолта библиотеки, см. svar-locale.ts).
  const mondayFirstLocale = useMemo(() => createMondayFirstLocale(), []);

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
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
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
  const [taskNavigation, setTaskNavigation] = useState<{
    documentId: string;
    taskId: string;
  } | null>(null);

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
    setFooterStatus('План экспортирован');
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
        setFooterStatus(`План «${created.title}» импортирован`);
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
      setFooterStatus(`План «${created.title}» импортирован`);
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
    setFooterStatus('Файл PlantUML скачан');
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

  // Общий черновик настроек фиксируется одной записью исходной редакции.
  const savePlanSettings = useCallback(
    (nextPlan: PlanContent, expectedRevision: number): SettingsSaveError | undefined => {
      if (!documentId || !documentService) return { kind: 'missing', message: 'Документ недоступен. Настройки не сохранены.' };
      const current = documentService.get(documentId);
      if (!current) return { kind: 'missing', message: 'Документ удалён. Настройки не сохранены.' };
      if (current.revision !== expectedRevision) return { kind: 'conflict', message: 'План изменён в другом окне. Перечитайте актуальную версию.' };
      if (!parsePlanContent(nextPlan).ok) return { kind: 'invalid', message: 'Настройки содержат некорректные данные. Исправьте ввод перед сохранением.' };
      try {
        documentService.update(documentId, expectedRevision, nextPlan);
      } catch (error) {
        return { kind: error instanceof DocumentConflictError ? 'conflict' : 'write', message: error instanceof Error ? error.message : 'Не удалось сохранить настройки.' };
      }
      return undefined;
    },
    [documentId, documentService],
  );

  // PBT-082: сначала закрыть список и обновить дерево/фильтры.
  // Выделение и прокрутка выполняются после заливки новых props в SVAR.
  const showTask = useCallback((taskId: string) => {
    const current = planRef.current;
    const id = documentIdRef.current;
    const task = current?.tasks.find(entry => entry.id === taskId);
    if (!current || !id || !task) return;
    const groups = new Map(current.groups.map(group => [group.id, group]));
    const expanded = new Set(collapsedRef.current);
    let cursor = task.groupId;
    while (cursor !== undefined) {
      expanded.delete(cursor);
      cursor = groups.get(cursor)?.parentId;
    }
    if (expanded.size !== collapsedRef.current.size) {
      setCollapsedGroups(expanded);
      persistCollapsed(expanded);
    }
    applyFilters('', '');
    setIssuesOpen(false);
    setTaskNavigation({ documentId: id, taskId });
  }, [applyFilters, persistCollapsed]);

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
    // Серия сверок принадлежит только полосе, на которой начат жест.
    // Глобальный mouseup нужен для отпускания снаружи, но сам по себе
    // не даёт соседним (в том числе скрытым) сторам права записи.
    type Gesture = {
      taskId: string;
      api: IApi;
      revision: number;
      released: boolean;
    };
    let gesture: Gesture | null = null;
    let finalizePending: (() => void) | null = null;
    const timers = new Set<number>();
    const cancel = () => {
      gesture = null;
      finalizePending = null;
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
      gestureExpectedRef.current.clear();
    };
    const begin = (event: MouseEvent | TouchEvent) => {
      if ('button' in event && event.button !== 0) return;
      if ('touches' in event && event.touches.length !== 1) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const bar = target.closest<HTMLElement>('.wx-bar[data-id]');
      if (
        bar?.closest<HTMLElement>('.plan-gantt')?.dataset.widgetInstance !==
        widgetInstanceId
      ) return;
      const rawId = bar?.dataset.id;
      const taskId = rawId?.startsWith(':') ? rawId.slice(1) : rawId;
      if (
        visibleRef.current === false || !taskId || !documentId || !documentService ||
        !planRef.current?.tasks.some((task) => task.id === taskId) ||
        apiRef.current === null
      ) return;
      // Следующий жест не должен терять уже завершённый ввод. Фиксируем
      // предыдущий факт, затем отменяем его таймеры и открываем новую серию.
      finalizePending?.();
      cancel();
      const latest = documentService.get(documentId);
      if (latest === undefined) return;
      gesture = {
        taskId,
        api: apiRef.current,
        revision: latest.revision,
        released: false,
      };
    };
    const finish = () => {
      const owner = gesture;
      if (owner === null || owner.released) return;
      owner.released = true;
      const correct = (persist: boolean) => {
        // Новая серия, пересозданный чарт или внешняя запись делают
        // отложенное наблюдение устаревшим. Своя запись выполняется
        // только последней сверкой, после неё серия завершается.
        if (gesture !== owner) return;
        if (
          apiRef.current !== owner.api ||
          !documentId ||
          documentService?.get(documentId)?.revision !== owner.revision
        ) {
          cancel();
          return;
        }
        const task = planRef.current?.tasks.find((task) => task.id === owner.taskId);
        let stored: { start?: unknown; end?: unknown } | undefined;
        try {
          stored = owner.api.getTask(owner.taskId) as typeof stored;
        } catch {
          cancel();
          return;
        }
        if (
          task === undefined || !(stored?.start instanceof Date) ||
          !(stored.end instanceof Date)
        ) {
          cancel();
          return;
        }
        const storeStart = ganttDayIso(stored.start);
        const endDate = new Date(stored.end);
        endDate.setDate(endDate.getDate() - 1);
        const storeEndInc = ganttDayIso(endDate);
        if (storeStart !== task.start || storeEndInc !== task.end) {
          applyGestureRules(owner.taskId, storeStart, storeEndInc, persist);
        }
        if (persist) {
          persistGesture(owner.taskId);
          cancel();
        }
      };
      finalizePending = () => correct(true);
      // SVAR доанимирует стор: промежуточные сверки исправляют полосу,
      // а последняя записывает одну логическую операцию (ADR-5).
      for (const delay of [250, 700, 1500]) {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          correct(delay === 1500);
        }, delay);
        timers.add(timer);
      }
    };
    window.document.addEventListener('mousedown', begin, true);
    window.document.addEventListener('touchstart', begin, true);
    window.document.addEventListener('mouseup', finish, true);
    window.document.addEventListener('touchend', finish, true);
    window.document.addEventListener('touchcancel', cancel, true);
    return () => {
      cancel();
      window.document.removeEventListener('mousedown', begin, true);
      window.document.removeEventListener('touchstart', begin, true);
      window.document.removeEventListener('mouseup', finish, true);
      window.document.removeEventListener('touchend', finish, true);
      window.document.removeEventListener('touchcancel', cancel, true);
    };
  }, [applyGestureRules, persistGesture, documentId, documentService, widgetInstanceId]);

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
    filter: PlanViewFilter;
  } | null>(null);
  const ownWrite =
    // Скрытый чарт размонтирован: для его следующего монтирования нужны
    // свежие props даже после собственной отложенной записи жеста.
    visible !== false &&
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
      svarSourceRef.current !== null && ownWrite &&
      svarSourceRef.current.collapsed === collapsedGroups &&
      svarSourceRef.current.filter === viewFilter
        ? svarSourceRef.current
        : filteredPlan !== undefined
          ? { plan: filteredPlan, collapsed: collapsedGroups, filter: viewFilter }
          : null,
    // Своя запись удерживает props только до явной смены фильтров/групп.
    // svarSourceRef намеренно вне deps: это «данные, уже залитые в стор».
    [ownWrite, filteredPlan, collapsedGroups, viewFilter],
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

  // ─── Подсветка нерабочих дней в недельном режиме (PBT-076, D2.3) ──
  // highlightTime SVAR не срабатывает для week-клеток (сторож в
  // react-gantt: только day/hour) — блоки нерабочих дней рисуем сами
  // в слой .wx-gantt-holidays: он внутри скролл-контента (позиция и
  // прокрутка наследуются) и уже растянут нашим CSS (PBT-037/053);
  // классы gantt-weekend/gantt-holiday — те же цвета, что в «Днях».
  // Дневная точность: x/ширина из пикселей дня шкалы (lengthUnitWidth),
  // границы блока — подряд идущие дни одного вида (выходные парами,
  // праздники отдельно — различимость сохраняется).
  useEffect(() => {
    if (ganttZoom !== 'weeks' || source === null) {
      return;
    }
    const root = window.document.querySelector(
      `.plan-gantt[data-widget-instance="${widgetInstanceId}"]`,
    );
    const layer = root?.querySelector<HTMLElement>('.wx-gantt-holidays');
    const scalesData = apiRef.current?.getState()._scales;
    if (layer === null || layer === undefined || scalesData === undefined) {
      return;
    }
    const pxPerDay = scalesData.lengthUnitWidth;
    const startDay = scalesData.start;
    const endDay = scalesData.end;
    const dayMs = 86400000;
    const startMs = startDay.getTime();
    const totalDays = Math.round((endDay.getTime() - startMs) / dayMs) + 1;
    const blocks: HTMLElement[] = [];
    let index = 0;
    while (index < totalDays) {
      const date = new Date(startMs + index * dayMs);
      const kind = nonWorkingDayKind(source.plan, ganttDayIso(date));
      if (kind === undefined) {
        index += 1;
        continue;
      }
      let length = 1;
      while (index + length < totalDays) {
        const next = new Date(startMs + (index + length) * dayMs);
        if (nonWorkingDayKind(source.plan, ganttDayIso(next)) !== kind) {
          break;
        }
        length += 1;
      }
      const stripe = window.document.createElement('div');
      stripe.className = kind === 'holiday' ? 'gantt-holiday' : 'gantt-weekend';
      stripe.style.left = `${Math.round(index * pxPerDay)}px`;
      stripe.style.width = `${Math.max(1, Math.round(length * pxPerDay))}px`;
      stripe.setAttribute('data-gantt-nonworking', kind);
      blocks.push(stripe);
      index += length;
    }
    layer.replaceChildren(...blocks);
  }, [ganttZoom, source, chartRange, rangeTick, widgetInstanceId]);

  // ─── Позиция прокрутки шкалы (PBT-073, design D6; техдолг D8 PBT-071) ──
  // SVAR при скачке ширины контейнера пересобирает шкалу и сбрасывает
  // прокрутку. Механизм: пассивный трекинг scrollLeft скролл-контейнеров
  // (capture-фаза: scroll не всплывает) + разовое восстановление после
  // стабилизации ширины (debounce onResize 150 мс + ограниченная серия
  // попыток 0/150/350 мс — не поллинг). Отличается от отвергнутых в D8
  // PBT-071: поллинга-удержания (гонки), перемонтирования (пустая шкала),
  // якорного старта (уход к началу плана).
  // Пассивный трекинг scrollLeft: подписка на document (capture-фаза —
  // scroll не всплывает), фильтр по классу контейнера SVAR и экземпляру
  // виджета. На host-элементе не вешается: при первом рендере чарт ещё
  // не смонтирован (ветка «Загрузка плана…»), а эффект с пустыми deps
  // повторно не выполняется — слушатель терялся (диагностика PBT-073).
  const lastScrollLeftRef = useRef(0);
  // Активное окно восстановления (design D6): пересборка шкалы SVAR
  // асинхронна и может сбросить прокрутку ПОСЛЕ стартовой серии попыток;
  // сброс — это scroll-событие, на него реагируем повторным применением.
  const pendingRestoreRef = useRef<{ left: number; until: number } | null>(
    null,
  );
  useEffect(() => {
    const onScroll = (event: Event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.classList.contains('wx-chart')
      ) {
        const root = target.closest('.plan-gantt');
        if (
          root?.getAttribute('data-widget-instance') === widgetInstanceId
        ) {
          lastScrollLeftRef.current = target.scrollLeft;
          const pending = pendingRestoreRef.current;
          if (
            pending !== null &&
            window.performance.now() < pending.until
          ) {
            if (Math.abs(target.scrollLeft - pending.left) <= 33) {
              // Позиция восстановлена — окно закрывается.
              pendingRestoreRef.current = null;
            } else if (target.scrollLeft < pending.left - 33) {
              // Сброс пересборки догнал серию попыток — вернуть позицию
              // (в rAF: не драться с пересборкой внутри обработчика).
              window.requestAnimationFrame(() => {
                applyChartScrollLeft(widgetInstanceId, pending.left);
              });
            }
          }
        }
      }
    };
    // window.document — пропс-состояние document шэдоуит глобальный
    // (начальное значение undefined роняло монтаж, диагностика PBT-073).
    window.document.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    return () =>
      window.document.removeEventListener('scroll', onScroll, {
        capture: true,
      });
  }, [widgetInstanceId]);

  // Запланированное восстановление (px): серия попыток покрывает
  // асинхронность пересборки шкалы SVAR и remount при смене зума;
  // scroll-chart {left} — штатный путь (обработчик библиотеки
  // устанавливает scrollLeft контейнера, кламп выполняет браузер).
  const scrollRetryTimersRef = useRef<number[]>([]);
  const clearScrollRetries = useCallback(() => {
    for (const timer of scrollRetryTimersRef.current) {
      window.clearTimeout(timer);
    }
    scrollRetryTimersRef.current = [];
  }, []);
  // Применение позиции: прямое присвоение scrollLeft контейнеру чарта +
  // штатный scroll-chart поверх. Только exec недостаточно: SVAR хранит
  // «последний применённый left» и после пересборки при развороте
  // игнорирует повторный тот же left (диагностика PBT-073, dist 3773).
  // Прямое присвоение диспатчит scroll — SVAR сам синхронизирует таблицу.
  const applyChartScrollLeft = useCallback(
    (instanceId: string, left: number) => {
      const chart = window.document.querySelector<HTMLElement>(
        `.plan-gantt[data-widget-instance="${instanceId}"] .wx-chart`,
      );
      if (chart !== null) {
        chart.scrollLeft = left;
      }
      apiRef.current?.exec('scroll-chart', { left });
    },
    [],
  );

  const scheduleScrollRestore = useCallback(
    (left: number) => {
      clearScrollRetries();
      // Окно восстановления (2 с): стартовая серия + реакция на сброс
      // пересборки через scroll-событие (см. трекинг выше).
      pendingRestoreRef.current = {
        left,
        until: window.performance.now() + 2000,
      };
      for (const delay of [0, 150, 350]) {
        const timer = window.setTimeout(() => {
          applyChartScrollLeft(widgetInstanceId, left);
        }, delay);
        scrollRetryTimersRef.current.push(timer);
      }
    },
    [clearScrollRetries, applyChartScrollLeft, widgetInstanceId],
  );
  useEffect(() => clearScrollRetries, [clearScrollRetries]);

  // Восстановление после изменения размеров окна (разворот/возврат,
  // resize рамки): пиксельная позиция валидна — cellWidth не меняется.
  useEffect(() => {
    if (onResize === undefined) {
      return;
    }
    let debounce = 0;
    const unsubscribe = onResize(() => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        scheduleScrollRestore(lastScrollLeftRef.current);
      }, 150);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(debounce);
    };
  }, [onResize, scheduleScrollRestore]);

  // Смена зума: пиксельная позиция невалидна (меняется cellWidth) —
  // конверсия через ширину клетки до смены состояния (design D6.5),
  // восстановление после пересборки (chartRemountKey включает зум).
  const ganttZoomRef = useRef(ganttZoom);
  ganttZoomRef.current = ganttZoom;
  const applyZoom = useCallback(
    (next: GanttZoom) => {
      const current = ganttZoomRef.current;
      if (current === next) {
        return;
      }
      const converted = convertZoomScrollLeft(
        lastScrollLeftRef.current,
        current,
        next,
      );
      setGanttZoom(next);
      updateSettingsRef.current?.({ ganttZoom: next });
      scheduleScrollRestore(converted);
    },
    [scheduleScrollRestore],
  );

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
  // Смена зума пересобирает представление (cellWidth/scales); позиция
  // взгляда восстанавливается конверсией через дни (design D6.5).
  const chartKey = `${chartRemountKey}|${ganttZoom}`;

  useEffect(() => {
    if (taskNavigation === null) return;
    if (taskNavigation.documentId !== documentId || visible === false) {
      setTaskNavigation(null);
      return;
    }
    // Явная навигация пользователя заменяет прежнюю позицию resize/zoom.
    clearScrollRetries();
    pendingRestoreRef.current = null;
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        const api = apiRef.current;
        const task = planRef.current?.tasks.find(entry => entry.id === taskNavigation.taskId);
        if (api && task && documentIdRef.current === taskNavigation.documentId) {
          api.exec('select-task', { id: task.id, show: 'xy', focus: 'chart' });
          // Геометрия SVAR уже учитывает зум и начало шкалы. Начало
          // длинной полосы должно быть видно, даже если её центр вне экрана.
          const rendered = api.getTask(task.id);
          if (rendered && Number.isFinite(rendered.$x)) {
            const left = Math.max(0, rendered.$x - 24);
            lastScrollLeftRef.current = left;
            applyChartScrollLeft(widgetInstanceId, left);
          }
        }
        setTaskNavigation(null);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [taskNavigation, documentId, visible, source, chartKey,
    clearScrollRetries, applyChartScrollLeft, widgetInstanceId]);

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
    // Даты таблицы — дд.мм моноширинно (PBT-073, design D4): источник —
    // документ (даты групп — сводные min/max детей, как в «Раб. днях»);
    // окончание показывается включительно (A1, прототип строки 9–10).
    const dateCell = (rowId: string, edge: 'start' | 'end') => {
      const current = planRef.current;
      if (!current) {
        return null;
      }
      const group = current.groups.find((entry) => entry.id === rowId);
      if (group !== undefined) {
        const children = current.tasks.filter(
          (task) => task.groupId === rowId,
        );
        if (children.length === 0) {
          return null;
        }
        const iso = children.reduce(
          (acc, task) =>
            edge === 'start'
              ? task.start < acc
                ? task.start
                : acc
              : task.end > acc
                ? task.end
                : acc,
          edge === 'start' ? children[0].start : children[0].end,
        );
        return formatIsoDayMonth(iso);
      }
      const task = current.tasks.find((entry) => entry.id === rowId);
      if (task === undefined) {
        return null;
      }
      return formatIsoDayMonth(task[edge]);
    };
    return [
      // Состав таблицы — 5 колонок (ревью PR#51): задача (главная),
      // даты дд.мм, рабочая длительность, исполнители. Ширины фикс:
      // таблица не сжимается при узком окне — правые колонки скрываются
      // под чартом (CSS в gantt.css), последней видимой остаётся «Задача».
      // Типы работ — только в форме задачи (спека MODIFIED).
      { id: 'text', header: 'Задача', width: 240 },
      {
        id: 'start',
        header: 'Начало',
        width: 76,
        cell: ({ row }) => dateCell(String(row.id), 'start'),
      },
      {
        id: 'end',
        header: 'Окончание',
        width: 96,
        cell: ({ row }) => dateCell(String(row.id), 'end'),
      },
      {
        id: 'work-days',
        header: 'Рабочих дней',
        width: 120,
        align: 'center',
        cell: ({ row }) => workingDaysCell(String(row.id)),
      },
      {
        id: 'assignees',
        header: 'Исполнители',
        width: 180,
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
    ];
    // Своя запись жеста не меняет колонки: SVAR перерисовывает ячейку
    // строки при update-task, значение читается из свежего planRef.
  }, [source]);

  // Шкала дат (PBT-073 design D3; PBT-076 D2 — недельная семантика).
  // «Дни»: месяц + день (дд.мм). «Недели»: месяц + неделя — одна
  // колонка = одна неделя, подпись-диапазон её дней «12–18 окт»
  // (format(date, next) — границы самой клетки; полосы и подсветка
  // остаются дневной точности, см. слой ниже).
  const scales = useMemo<IScaleConfig[]>(
    () => [
      {
        unit: 'month',
        step: 1,
        format: (date: Date) =>
          date.toLocaleDateString('ru-RU', {
            month: 'long',
            year: 'numeric',
          }),
      },
      ganttZoom === 'days'
        ? {
            unit: 'day',
            step: 1,
            format: (date: Date) => formatZoomDayLabel(date),
          }
        : {
            unit: 'week',
            step: 1,
            format: (date: Date, next?: Date) =>
              formatWeekRangeLabel(date, next),
          },
    ],
    [ganttZoom],
  );

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

  const dialogOwner = { id: `${widgetInstanceId}:${documentId}`, title: document.title, visible };

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
          <div
            className="plan-gantt__toolbar"
            onClickCapture={(event) => {
              if (event.target instanceof Element) event.target.closest('button')?.focus({ preventScroll: true });
            }}
          >
            <div className="plan-gantt__toolbar-row">
              <button
                type="button"
                className="plan-gantt__button plan-gantt__button--primary"
                data-add-task
                onClick={() => openEditor({ mode: 'create' })}
              >
                <Plus aria-hidden="true" />
                Задача
              </button>
              <button
                type="button"
                className="plan-gantt__button"
                data-add-group
                onClick={() => openGroupEditor({ mode: 'group-create' })}
              >
                <FolderPlus aria-hidden="true" />
                Группа
              </button>
              <span
                className="plan-gantt__toolbar-separator"
                aria-hidden="true"
              />
              <button
                type="button"
                className="plan-gantt__button"
                data-import-plan
                aria-label="Импорт плана"
                onClick={() => importInputRef.current?.click()}
              >
                <Upload aria-hidden="true" />
                Импорт
              </button>
              <button
                type="button"
                className="plan-gantt__button"
                data-export-plan
                aria-label="Экспорт плана"
                onClick={handleExportPlan}
              >
                <Download aria-hidden="true" />
                Экспорт
              </button>
              <button
                type="button"
                className="plan-gantt__button"
                data-export-plantuml
                aria-label="Экспорт PlantUML"
                onClick={openPlantumlExport}
              >
                <BarChart3 aria-hidden="true" />
                PlantUML
              </button>
              <button
                type="button"
                className="plan-gantt__button plan-gantt__button--icon"
                data-catalogs
                aria-label="Настройки плана"
                title="Настройки плана"
                onClick={openCatalog}
              >
                <Settings2 aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`plan-gantt__button plan-gantt__button--issues${
                  issues.length > 0 ? ' is-warning' : ''
                }`}
                data-issues
                onClick={() => setIssuesOpen(true)}
              >
                <AlertTriangle aria-hidden="true" />
                Проблемы ({issues.length})
              </button>
            </div>
            <div className="plan-gantt__toolbar-row plan-gantt__toolbar-row--filters">
              <span className="plan-gantt__search">
                <Search aria-hidden="true" />
                <input
                  type="search"
                  className="plan-gantt__filter-input"
                  data-gantt-filter-query
                  aria-label="Поиск задач"
                  placeholder="Поиск задач…"
                  value={filterQuery}
                  onChange={(event) =>
                    applyFilters(event.target.value, filterResourceId)
                  }
                />
              </span>
              <select
                className="plan-gantt__filter-select"
                data-gantt-filter-resource
                aria-label="Фильтр по ресурсу"
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
              {/* Масштаб шкалы (design D3): сегмент; дефолт «Недели» —
                  компактная плотность PBT-068. */}
              <div
                className="plan-gantt__zoom"
                role="group"
                aria-label="Масштаб шкалы"
              >
                <button
                  type="button"
                  data-zoom-days
                  aria-pressed={ganttZoom === 'days'}
                  onClick={() => applyZoom('days')}
                >
                  Дни
                </button>
                <button
                  type="button"
                  data-zoom-weeks
                  aria-pressed={ganttZoom === 'weeks'}
                  onClick={() => applyZoom('weeks')}
                >
                  Недели
                </button>
              </div>
              <span className="plan-gantt__count" data-task-count>
                Задач: {plan?.tasks.length ?? 0}
              </span>
            </div>
          </div>
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
            <WillowDark fonts={false}>
              {/* Ключ по ревизии: SVAR не синхронизирует стор с новыми
                  props после init (спайк PBT-014) — внешние изменения
                  документа применяются пересозданием представления.
                  Своя запись жеста подавляет remount (D7 PBT-039).
                  Компонент зума в ключе — пересборка при смене масштаба
                  (PBT-073, design D3). */}
              {/* Компактная плотность по референсу OnlineGantt (PBT-068,
                  замер 2026-10-16): строка 36px. Зум (PBT-076, design D2):
                  «Дни» — клетка дня 48px; «Недели» (дефолт) — клетка
                  недели ~100px (≈14px/день), дневная точность сохраняется. */}
              {/* Неделя шкалы с понедельника (PBT-076, design D2.3): локаль
                  i18n-контекста SVAR; недели Вс–Сб разбивали бы выходные
                  пн–пт календаря плана на две колонки. Null-значение —
                  дефолт библиотеки (см. svar-locale.ts). */}
              <svarI18nContext.Provider value={mondayFirstLocale}>
                <Gantt
                  key={chartKey}
                  tasks={tasks}
                  links={links}
                  columns={columns}
                  gridWidth={712}
                  inclusiveEnd={true}
                  cellWidth={zoomCellWidth}
                  cellHeight={36}
                  autoScale={false}
                  start={chartRange?.start}
                  end={chartRange?.end}
                  scales={scales}
                  init={initApi}
                  highlightTime={highlightTime}
                />
              </svarI18nContext.Provider>
            </WillowDark>
          </div>
          {/* Строка состояния виджета (PBT-073, design D5): название
              документа плана + служебный статус последнего действия. */}
          <footer className="plan-gantt__footer">
            <span className="plan-gantt__footer-title">{document.title}</span>
            <span
              className="plan-gantt__footer-status"
              role="status"
              data-gantt-status
            >
              {footerStatus}
            </span>
          </footer>
        </div>
      )}
      {editor !== undefined && plan !== undefined && (
        <TaskEditorDialog
          owner={dialogOwner}
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
            owner={dialogOwner}
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
          owner={dialogOwner}
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
          owner={dialogOwner}
          plan={plan}
          revision={document.revision}
          onSave={savePlanSettings}
          onClose={closeCatalog}
        />
      )}
      {issuesOpen && (
        <PlanIssuesDialog
          owner={dialogOwner}
          issues={issues}
          onShowTask={showTask}
          onClose={() => setIssuesOpen(false)}
        />
      )}
      {plantumlPreview !== undefined && (
        <PlantUmlExportDialog
          owner={dialogOwner}
          text={plantumlPreview.text}
          report={plantumlPreview.report}
          fileName={plantumlPreview.fileName}
          onDownload={downloadPlantuml}
          onClose={() => setPlantumlPreview(undefined)}
        />
      )}
      {onlineganttPreview !== undefined && (
        <OnlineGanttImportDialog
          owner={dialogOwner}
          fileName={onlineganttPreview.fileName}
          payload={onlineganttPreview.payload}
          onApply={applyOnlineGanttImport}
          onCancel={cancelOnlineGanttImport}
        />
      )}
    </section>
  );
}
