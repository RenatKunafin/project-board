import React from 'react';
import ReactDOM from 'react-dom/client';
import SpikeApp from './SpikeApp';
import type { SpikePlan, SpikeDependency, SpikeGroup, SpikeTask, Weekday } from './plan';
import fixtures from '../../../tests/fixtures/gantt/small-plan.json';
import '@svar-ui/react-gantt/style.css';
import './spike.css';

interface FixtureJson {
  meta: { title: string; calendar: { workingDays: number[]; holidays: string[] } };
  groups: { id: string; title: string }[];
  tasks: { id: string; title: string; groupId?: string; start: string; end: string; workTypeIds: string[] }[];
  dependencies: { fromTaskId: string; toTaskId: string; lagDays: number }[];
}

const data = fixtures as FixtureJson;
const plan: SpikePlan = {
  title: data.meta.title,
  calendar: {
    workingDays: data.meta.calendar.workingDays.map((d): Weekday => d as Weekday),
    holidays: data.meta.calendar.holidays,
  },
  groups: data.groups.map((g): SpikeGroup => ({ id: g.id, title: g.title })),
  tasks: data.tasks.map(
    (t): SpikeTask => ({
      id: t.id,
      title: t.title,
      groupId: t.groupId,
      start: t.start,
      end: t.end,
      workTypeIds: t.workTypeIds,
    }),
  ),
  dependencies: data.dependencies.map(
    (d): SpikeDependency => ({ fromTaskId: d.fromTaskId, toTaskId: d.toTaskId, lagDays: d.lagDays }),
  ),
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SpikeApp initialPlan={plan} />
  </React.StrictMode>,
);
