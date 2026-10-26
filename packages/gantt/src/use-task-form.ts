import { useCallback, useRef } from 'react';
import type {
  DocumentService,
  ManagedDocument,
} from '@project-board/widget-sdk';
import { type PlanContent } from './plan-document';
import { deleteTask, type PlanCommandResult } from './plan-commands';
import { createUnavailability } from './plan-assignments';
import type { TaskFormIssue } from './task-editor';
import { writeTaskSession } from './task-form-session';
import { prepareTaskForm, type TaskEditorSubmit, type TaskFormSession } from './task-form-draft';
import type { AbsenceConvertInput } from './AbsenceConvertDialog';

export type TaskEditorState =
  | { readonly mode: 'create' }
  | { readonly mode: 'edit'; readonly taskId: string };

interface UseTaskFormArgs {
  readonly documentId?: string;
  readonly documentService?: DocumentService;
  readonly document?: ManagedDocument;
  readonly onClose: () => void;
}

/**
 * Общая форма задачи для обоих видов: запись снимка без ретрая;
 * независимые операции групп сохраняют прежний commitPlan.
 */
export function useTaskForm({
  documentId,
  documentService,
  document,
  onClose,
}: UseTaskFormArgs) {
  const documentRef = useRef(document);
  documentRef.current = document;

  const closeEditor = useCallback(() => {
    onClose();
  }, [onClose]);

  // Прежняя запись независимых команд редактора групп с повтором
  // по актуальной редакции. Форма задачи этим путём не пользуется.
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

  // Форма пишет ровно один раз по снимку открытия; общий commitPlan
  // остаётся прежним для независимых операций редактора групп.
  const writeSession = useCallback((session: TaskFormSession, mutate: (base: PlanContent) => PlanCommandResult) =>
    writeTaskSession(documentService, documentId, session, mutate), [documentId, documentService]);

  const submitTaskForm = useCallback((submit: TaskEditorSubmit, session: TaskFormSession): TaskFormIssue | undefined => {
    let issue: TaskFormIssue | undefined;
    const failure = writeSession(session, () => {
      const prepared = prepareTaskForm(session, submit);
      if (!prepared.ok) {
        issue = prepared.issue;
        return { ok: false, error: { code: 'unknown-task', message: prepared.issue.message } };
      }
      return prepared;
    });
    if (issue) return issue;
    if (failure) return { field: 'document', message: failure };
    closeEditor();
    return undefined;
  }, [writeSession, closeEditor]);

  const deleteCurrentTask = useCallback((session: TaskFormSession): string | undefined => {
    if (!session.taskId) return 'Задача не выбрана.';
    const taskId = session.taskId;
    const failure = writeSession(session, base => deleteTask(base, taskId));
    if (!failure) closeEditor();
    return failure;
  }, [writeSession, closeEditor]);

  const convertCurrentTaskToAbsence = useCallback((input: AbsenceConvertInput, session: TaskFormSession): string | undefined => {
    if (!session.taskId) return 'Задача не выбрана.';
    const taskId = session.taskId;
    const failure = writeSession(session, base => {
      const removed = deleteTask(base, taskId);
      return removed.ok ? createUnavailability(removed.plan, input) : removed;
    });
    if (!failure) closeEditor();
    return failure;
  }, [writeSession, closeEditor]);

  return { commitPlan, submitTaskForm, deleteCurrentTask, convertCurrentTaskToAbsence, closeEditor };
}
