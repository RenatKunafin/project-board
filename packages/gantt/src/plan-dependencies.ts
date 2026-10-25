import type {
  PlanContent,
  PlanDependency,
  PlanTask,
} from './plan-document';
import type {
  PlanCommandError,
  PlanCommandResult,
} from './plan-commands';
import { createWorkingCalendar } from './working-calendar';

export interface DependencyCreateInput {
  readonly fromTaskId: string;
  readonly toTaskId: string;
  readonly lagDays: number;
}

export interface DependencyUpdatePatch {
  readonly lagDays?: number;
}

export interface DependencyViolation {
  readonly dependencyId: string;
  readonly fromTaskId: string;
  readonly toTaskId: string;
  readonly expectedStart: string;
  readonly actualStart: string;
  readonly message: string;
}

type DependencyErrorCode =
  | 'unknown-task'
  | 'unknown-dependency'
  | 'invalid-lag'
  | 'circular-dependency'
  | 'duplicate-dependency';

function fail(
  code: DependencyErrorCode,
  message: string,
): PlanCommandResult {
  const error: PlanCommandError = { code, message };
  return { ok: false, error };
}

function findDependency(
  plan: PlanContent,
  dependencyId: string,
): PlanDependency | undefined {
  return plan.dependencies.find((entry) => entry.id === dependencyId);
}

function resolveLagDays(lagDays: number): number | PlanCommandResult {
  if (!Number.isInteger(lagDays) || lagDays < 0) {
    return fail(
      'invalid-lag',
      `Лаг зависимости — целое число рабочих дней не меньше нуля: ${lagDays}.`,
    );
  }
  return lagDays;
}

function findTask(
  plan: PlanContent,
  taskId: string,
): PlanTask | PlanCommandResult {
  const task = plan.tasks.find((entry) => entry.id === taskId);
  if (task === undefined) {
    return fail('unknown-task', `Задача «${taskId}» не существует.`);
  }
  return task;
}

/** Путь по рёбрам from → to: достижим ли targetId из startId (design D1). */
function reachable(plan: PlanContent, startId: string, targetId: string): boolean {
  if (startId === targetId) {
    return true;
  }
  const queue: string[] = [startId];
  const seen = new Set<string>([startId]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dependency of plan.dependencies) {
      if (dependency.fromTaskId === current && !seen.has(dependency.toTaskId)) {
        if (dependency.toTaskId === targetId) {
          return true;
        }
        seen.add(dependency.toTaskId);
        queue.push(dependency.toTaskId);
      }
    }
  }
  return false;
}

export function createDependency(
  plan: PlanContent,
  input: DependencyCreateInput,
): PlanCommandResult {
  const fromResult = findTask(plan, input.fromTaskId);
  if ('ok' in fromResult) {
    return fromResult;
  }
  const toResult = findTask(plan, input.toTaskId);
  if ('ok' in toResult) {
    return toResult;
  }
  const lag = resolveLagDays(input.lagDays);
  if (typeof lag !== 'number') {
    return lag;
  }
  if (input.fromTaskId === input.toTaskId) {
    return fail(
      'circular-dependency',
      `Задача «${input.fromTaskId}» не может зависеть от самой себя.`,
    );
  }
  // Косвенный цикл (C4): новый ребро from → to создаёт цикл, если from
  // достижим из to по существующим рёбрам.
  if (reachable(plan, input.toTaskId, input.fromTaskId)) {
    return fail(
      'circular-dependency',
      `Зависимость «${input.fromTaskId}» → «${input.toTaskId}» создаёт цикл.`,
    );
  }
  const existing = plan.dependencies.find(
    (dependency) =>
      dependency.fromTaskId === input.fromTaskId &&
      dependency.toTaskId === input.toTaskId,
  );
  if (existing !== undefined) {
    // Повтор точного ввода — безвредный ретрай; другой лаг — противоречивое
    // намерение (design D1).
    if (existing.lagDays === input.lagDays) {
      return { ok: true, plan };
    }
    return fail(
      'duplicate-dependency',
      `Зависимость «${input.fromTaskId}» → «${input.toTaskId}» уже существует с лагом ${existing.lagDays}; измените лаг существующей зависимости.`,
    );
  }
  const dependency: PlanDependency = {
    id: crypto.randomUUID(),
    fromTaskId: input.fromTaskId,
    toTaskId: input.toTaskId,
    lagDays: input.lagDays,
  };
  return {
    ok: true,
    plan: { ...plan, dependencies: [...plan.dependencies, dependency] },
  };
}

export function updateDependency(
  plan: PlanContent,
  dependencyId: string,
  patch: DependencyUpdatePatch,
): PlanCommandResult {
  const dependency = findDependency(plan, dependencyId);
  if (dependency === undefined) {
    return fail(
      'unknown-dependency',
      `Зависимость «${dependencyId}» не существует.`,
    );
  }
  if (!('lagDays' in patch)) {
    return { ok: true, plan };
  }
  const lag = resolveLagDays(patch.lagDays as number);
  if (typeof lag !== 'number') {
    return lag;
  }
  if (dependency.lagDays === (patch.lagDays as number)) {
    return { ok: true, plan };
  }
  return {
    ok: true,
    plan: {
      ...plan,
      dependencies: plan.dependencies.map((entry) =>
        entry.id === dependencyId ? { ...entry, lagDays: patch.lagDays as number } : entry,
      ),
    },
  };
}

export function deleteDependency(
  plan: PlanContent,
  dependencyId: string,
): PlanCommandResult {
  const dependency = findDependency(plan, dependencyId);
  if (dependency === undefined) {
    return fail(
      'unknown-dependency',
      `Зависимость «${dependencyId}» не существует.`,
    );
  }
  return {
    ok: true,
    plan: {
      ...plan,
      dependencies: plan.dependencies.filter(
        (entry) => entry.id !== dependencyId,
      ),
    },
  };
}

export function dependencyViolations(
  plan: PlanContent,
): readonly DependencyViolation[] {
  const calendar = createWorkingCalendar(plan.calendar);
  const taskById = new Map(plan.tasks.map((task) => [task.id, task]));
  const violations: DependencyViolation[] = [];
  for (const dependency of plan.dependencies) {
    const from = taskById.get(dependency.fromTaskId);
    const to = taskById.get(dependency.toTaskId);
    // Рёбра с отсутствующими задачами — ответственность валидатора чтения
    // (design D2); диагностика предназначена для валидного плана.
    if (from === undefined || to === undefined) {
      continue;
    }
    // C1: N-й рабочий день после включительного окончания, где N = лаг + 1:
    // лаг 0 — ближайший рабочий (пн после пт), лаг 1 — ещё один рабочий день
    // (вт); праздники в окне учитываются (design D3).
    const expectedStart = calendar.addWorkingDays(
      from.end,
      dependency.lagDays + 1,
    );
    if (to.start < expectedStart) {
      violations.push({
        dependencyId: dependency.id,
        fromTaskId: from.id,
        toTaskId: to.id,
        expectedStart,
        actualStart: to.start,
        message: `Задача «${to.title}» начинается ${to.start}, но по зависимости от «${from.title}» (лаг ${dependency.lagDays} раб. дн.) начало возможно не раньше ${expectedStart}.`,
      });
    }
  }
  return violations;
}
