import { useCallback, useRef } from 'react';
import type {
  DocumentService,
  ManagedDocument,
} from '@project-board/widget-sdk';
import { parsePlanContent, type PlanContent } from './plan-document';
import {
  createTask,
  deleteTask,
  setTaskDates,
  updateTask,
} from './plan-commands';
import type { PlanCommandError, PlanCommandResult } from './plan-commands';
import {
  createDependency,
  deleteDependency,
  updateDependency,
} from './plan-dependencies';
import { createUnavailability } from './plan-assignments';
import {
  buildTaskDates,
  validateTaskForm,
  type TaskFormIssue,
} from './task-editor';
import type {
  DependencyCommand,
  TaskEditorSubmit,
} from './TaskEditorDialog';
import type { AbsenceConvertInput } from './AbsenceConvertDialog';

export type TaskEditorState =
  | { readonly mode: 'create' }
  | { readonly mode: 'edit'; readonly taskId: string };

interface UseTaskFormArgs {
  readonly documentId?: string;
  readonly documentService?: DocumentService;
  readonly document?: ManagedDocument;
  readonly plan?: PlanContent;
  readonly editor?: TaskEditorState;
  readonly onClose: () => void;
}

function parseLatest(content: unknown): PlanContent | undefined {
  const validation = parsePlanContent(content);
  return validation.ok ? validation.plan : undefined;
}

/**
 * Общая форма задачи для обоих видов (PBT-038/048): запись документа
 * с ретраем ревизии, валидация, команды задачи и зависимостей.
 * Вынесен из PlanGanttWidget без изменения поведения.
 */
export function useTaskForm({
  documentId,
  documentService,
  document,
  plan,
  editor,
  onClose,
}: UseTaskFormArgs) {
  const documentRef = useRef(document);
  documentRef.current = document;
  const planRef = useRef(plan);
  planRef.current = plan;

  const closeEditor = useCallback(() => {
    onClose();
  }, [onClose]);

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
        const base = parseLatest(latest.content);
        if (base === undefined) {
          return undefined;
        }
        // Назначения (PBT-042): пустое множество снимает все (поле убирается).
        const assignments = {
          ...(submit.assigneeIds.length > 0
            ? { assigneeIds: submit.assigneeIds }
            : { assigneeIds: [] as readonly string[] }),
          ...(submit.workTypeIds.length > 0
            ? { workTypeIds: submit.workTypeIds }
            : { workTypeIds: [] as readonly string[] }),
        };
        const result: PlanCommandResult = (() => {
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
      const base = parseLatest(latest.content);
      if (base === undefined) {
        return undefined;
      }
      const removed = deleteTask(base, taskId);
      return removed.ok ? removed.plan : undefined;
    });
    closeEditor();
  }, [editor, commitPlan, closeEditor]);

  // Преобразование задачи в период недоступности (PBT-054, design D3):
  // композиция готовых команд ядра в одной записи документа — атомарная
  // замена (deleteTask чистит зависимости, контракт D6 PBT-031).
  // Ошибка любой команды — текст ядра в диалог, план не тронут.
  const convertCurrentTaskToAbsence = useCallback(
    (input: AbsenceConvertInput): string | undefined => {
      if (editor?.mode !== 'edit') {
        return 'Задача не выбрана.';
      }
      const taskId = editor.taskId;
      let failure: string | undefined;
      commitPlan((latest) => {
        const base = parseLatest(latest.content);
        if (base === undefined) {
          failure = 'Документ недоступен — повторите попытку.';
          return undefined;
        }
        const removed = deleteTask(base, taskId);
        if (!removed.ok) {
          failure = removed.error.message;
          return undefined;
        }
        const created = createUnavailability(removed.plan, input);
        if (!created.ok) {
          failure = created.error.message;
          return undefined;
        }
        return created.plan;
      });
      if (failure !== undefined) {
        return failure;
      }
      closeEditor();
      return undefined;
    },
    [editor, commitPlan, closeEditor],
  );

  // Команды зависимостей (PBT-045): делегирование ядру plan-dependencies.
  const applyDependencyCommand = useCallback(
    (command: DependencyCommand): PlanCommandError | undefined => {
      let error: PlanCommandError | undefined;
      commitPlan((latest) => {
        const base = parseLatest(latest.content);
        if (base === undefined) {
          return undefined;
        }
        const result = ((): PlanCommandResult => {
          switch (command.type) {
            case 'createDependency':
              return createDependency(base, {
                fromTaskId: command.fromTaskId,
                toTaskId: command.toTaskId,
                lagDays: command.lagDays,
              });
            case 'updateDependencyLag':
              return updateDependency(base, command.dependencyId, {
                lagDays: command.lagDays,
              });
            case 'deleteDependency':
              return deleteDependency(base, command.dependencyId);
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

  return {
    commitPlan,
    submitTaskForm,
    deleteCurrentTask,
    convertCurrentTaskToAbsence,
    applyDependencyCommand,
    closeEditor,
  };
}
