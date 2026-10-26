import { updateResource, updateWorkType } from './plan-catalogs';
import type { PlanContent } from './plan-document';

export type SettingsSection =
  'resources' | 'workTypes' | 'absences' | 'calendar';

export interface SettingsIssue {
  readonly section: SettingsSection;
  readonly id: string;
  readonly message: string;
}

/** Строковый ввод может быть временно невалидным и не меняет валидный черновик. */
export function prepareSettingsNames(
  plan: PlanContent,
  resourceNames: ReadonlyMap<string, string>,
  workTypeNames: ReadonlyMap<string, string>,
):
  | { readonly ok: true; readonly plan: PlanContent }
  | { readonly ok: false; readonly issue: SettingsIssue } {
  let next = plan;
  for (const resource of plan.resources) {
    const title = resourceNames.get(resource.id);
    if (title === undefined || title === resource.title) continue;
    const result = updateResource(next, resource.id, { title });
    if (!result.ok)
      return {
        ok: false,
        issue: {
          section: 'resources',
          id: resource.id,
          message: result.error.message,
        },
      };
    next = result.plan;
  }
  for (const workType of plan.workTypes) {
    const title = workTypeNames.get(workType.id);
    if (title === undefined || title === workType.title) continue;
    const result = updateWorkType(next, workType.id, { title });
    if (!result.ok)
      return {
        ok: false,
        issue: {
          section: 'workTypes',
          id: workType.id,
          message: result.error.message,
        },
      };
    next = result.plan;
  }
  return { ok: true, plan: next };
}
