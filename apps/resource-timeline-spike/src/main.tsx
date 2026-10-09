import ReactDOM from 'react-dom/client';
import ResourceSpike from './ResourceSpike';
import type {
  SpikeDependency,
  SpikePlan,
  SpikeResource,
  SpikeTask,
  SpikeUnavailability,
  Weekday,
} from './plan';
import fixtures from '../../../tests/fixtures/gantt/small-plan.json';
import 'react-calendar-timeline/dist/style.css';
import './spike.css';

interface FixtureJson {
  meta: { title: string; calendar: { workingDays: number[]; holidays: string[] } };
  resources: { id: string; name: string }[];
  tasks: {
    id: string;
    title: string;
    groupId?: string;
    start: string;
    end: string;
    assigneeIds: string[];
    workTypeIds: string[];
  }[];
  dependencies: { fromTaskId: string; toTaskId: string; lagDays: number }[];
  unavailability: { id: string; resourceId: string; start: string; end: string; title?: string }[];
}

const data = fixtures as FixtureJson;
const plan: SpikePlan = {
  title: data.meta.title,
  calendar: {
    workingDays: data.meta.calendar.workingDays.map((d): Weekday => d as Weekday),
    holidays: data.meta.calendar.holidays,
  },
  resources: data.resources.map(
    (r): SpikeResource => ({ id: r.id, name: r.name }),
  ),
  tasks: data.tasks.map(
    (t): SpikeTask => ({
      id: t.id,
      title: t.title,
      start: t.start,
      end: t.end,
      assigneeIds: t.assigneeIds,
      workTypeIds: t.workTypeIds,
    }),
  ),
  dependencies: data.dependencies.map(
    (d): SpikeDependency => ({ fromTaskId: d.fromTaskId, toTaskId: d.toTaskId, lagDays: d.lagDays }),
  ),
  unavailability: data.unavailability.map(
    (u): SpikeUnavailability => ({ id: u.id, resourceId: u.resourceId, start: u.start, end: u.end, title: u.title }),
  ),
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <ResourceSpike initialPlan={plan} periodStart="2026-10-11" periodEnd="2026-10-29" />,
);
