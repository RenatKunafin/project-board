import type { DocumentService } from '@project-board/widget-sdk';
import { parsePlanContent, type PlanContent } from './plan-document';
import type { PlanCommandResult } from './plan-commands';
import type { TaskFormSession } from './task-form-draft';

/** Проверка актуальности и единственная запись. Никакого fallback или replay. */
export function writeTaskSession(
  service: Pick<DocumentService, 'get' | 'update'> | undefined,
  documentId: string | undefined,
  session: TaskFormSession,
  mutate: (base: PlanContent) => PlanCommandResult,
): string | undefined {
  if (!documentId || !service) return 'Документ недоступен.';
  try {
    const latest = service.get(documentId);
    if (!latest) return 'Документ удалён. Закройте форму.';
    const parsed = parsePlanContent(latest.content);
    if (!parsed.ok) return 'Документ недоступен для редактирования.';
    if (session.taskId !== undefined && !parsed.plan.tasks.some(task => task.id === session.taskId)) return 'Исходная задача удалена. Закройте форму.';
    if (latest.revision !== session.revision) return 'План изменён в другом представлении. Перечитайте план.';
    const result = mutate(session.plan);
    if (!result.ok) return result.error.message;
    if (result.plan !== session.plan) service.update(documentId, session.revision, result.plan as unknown as typeof latest.content);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : 'Не удалось сохранить документ.';
  }
}
