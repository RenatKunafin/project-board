import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { generatePlan, type FixturePlan } from '../fixtures/gantt/generate-plan';
import { parsePlanContent, type PlanContent } from '../../packages/gantt/src/plan-document';

export async function benchmarkData() {
  const golden = JSON.parse(await readFile('tests/fixtures/gantt/plan-500.json', 'utf8')) as FixturePlan;
  return [golden, ...Array.from({ length: 10 }, (_, i) => generatePlan({ seed: 42 + i, taskCount: 50 }))]
    .map((fixture, i) => {
      const content: PlanContent = {
        calendar: { ...fixture.meta.calendar, workingExceptions: [], workingDays: [1, 2, 3, 4, 5] },
        workTypes: fixture.workTypes.map(({ parallel, ...type }) => ({ ...type, allowsParallel: parallel })),
        resources: fixture.resources.map(resource => ({ id: resource.id, title: resource.name })),
        groups: fixture.groups,
        tasks: fixture.tasks,
        dependencies: fixture.dependencies.map((dependency, index) => ({ id: `dep-${index}`, ...dependency })),
        unavailability: fixture.unavailability,
      };
      const validation = parsePlanContent(content);
      if (!validation.ok) throw new Error(JSON.stringify(validation.issues));
      const title = i === 0 ? 'Benchmark A 500' : `Benchmark B ${i}`;
      const json = JSON.stringify({ format: 'project-board-plan', formatVersion: 1, title, schemaVersion: 1, content });
      return { title, content, json, sha256: createHash('sha256').update(json).digest('hex'), seed: i === 0 ? 42 : 41 + i };
    });
}
