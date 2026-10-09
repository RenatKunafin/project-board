import { useCallback, useMemo, useRef, useState } from 'react';
import type { IApi } from '@svar-ui/react-gantt';
import { Gantt, Willow, Editor } from '@svar-ui/react-gantt';
import { toSvarLinks, toSvarTasks } from './adapter';
import {
  addCalendarDaysIso,
  createWorkingCalendar,
  dragTaskTo,
  formatIso,
  isoToDate,
  resizeTaskEnd,
  toggleHoliday,
  workingDuration,
  type SpikePlan,
} from './plan';

const HOLIDAY_DATE = '2026-10-14';

interface Props {
  initialPlan: SpikePlan;
}

export default function SpikeApp({ initialPlan }: Props) {
  const [plan, setPlan] = useState<SpikePlan>(initialPlan);
  const [inclusiveEnd, setInclusiveEnd] = useState(true);
  const [api, setApi] = useState<IApi | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const planRef = useRef(plan);
  planRef.current = plan;
  const appendLog = (line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 40));
  };

  const tasks = useMemo(() => toSvarTasks(plan), [plan]);
  const links = useMemo(() => toSvarLinks(plan), [plan]);

  const initApi = (instance: IApi) => {
    // Обновление задачи: различаем drag (пришло начало) и resize (пришёл
    // конец). Даты SVAR исключительные: входящий end уменьшаем на день,
    // исходящий увеличиваем (следствие A1).
    instance.intercept('update-task', (ev: { id: string | number; task: Record<string, unknown> }) => {
      const task = ev.task as { start?: Date; end?: Date; text?: string; duration?: number };
      const dump = {
        id: String(ev.id),
        start: task.start instanceof Date ? formatIso(task.start) : task.start,
        endInc: task.end instanceof Date ? prevDay(formatIso(task.end)) : task.end,
        duration: task.duration,
        keys: Object.keys(ev.task ?? {}),
      };
      appendLog(`update-task payload: ${JSON.stringify(dump)}`);
      const current = planRef.current.tasks.find((t) => t.id === String(ev.id));
      if (!current) return true;
      if (task.start instanceof Date) {
        const startIso = formatIso(task.start);
        if (startIso !== current.start) {
          const next = dragTaskTo(planRef.current, String(ev.id), startIso);
          setPlan(next);
          const updated = next.tasks.find((t) => t.id === String(ev.id));
          appendLog(
            `drag ${String(ev.id)}: ${current.start}..${current.end} -> ${updated?.start}..${updated?.end} (A2)`,
          );
          if (updated) {
            ev.task = {
              ...ev.task,
              start: isoToDate(updated.start),
              end: isoToDate(addCalendarDaysIso(updated.end, 1)),
            };
          }
          return true;
        }
      }
      if (task.end instanceof Date) {
        const endInc = prevDay(formatIso(task.end));
        const next = resizeTaskEnd(planRef.current, String(ev.id), endInc);
        setPlan(next);
        const updated = next.tasks.find((t) => t.id === String(ev.id));
        appendLog(
          `resize ${String(ev.id)}: end ${current.end} -> ${updated?.end} (A3)`,
        );
        if (updated) {
          ev.task = {
            ...ev.task,
            end: isoToDate(addCalendarDaysIso(updated.end, 1)),
          };
        }
        return true;
      }
      if (typeof task.text === 'string') {
        appendLog(`rename ${String(ev.id)}: "${task.text}" (наблюдение)`);
        return true;
      }
      appendLog(`update-task ${String(ev.id)}: без дат — пропущено: ${JSON.stringify(task)}`);
      return true;
    });

    instance.intercept('select-task', (ev: { id?: string | number }) => {
      appendLog(`select-task: ${String(ev.id)}`);
      return true;
    });

    instance.intercept('drag-task', (ev: { id: string | number; inProgress?: boolean; left?: number; width?: number }) => {
      if (!ev.inProgress) {
        appendLog(
          `drag-task ${String(ev.id)}: завершение, left=${ev.left} width=${ev.width}`,
        );
      }
      return true;
    });

    instance.intercept('add-link', (ev: { link: { source?: unknown; target?: unknown; type?: string } }) => {
      appendLog(
        `add-link: ${String(ev.link.source)} -> ${String(ev.link.target)} (${ev.link.type ?? '?'})`,
      );
      return true;
    });

    instance.intercept('schedule-tasks', (ev: unknown) => {
      appendLog(`schedule-tasks: НЕ ОЖИДАНО в open-редакции: ${JSON.stringify(ev)}`);
      return true;
    });

    setApi(instance);
    // Отладочный хук для проверок спайка (не для продуктовой интеграции).
    (window as unknown as Record<string, unknown>).__spikeApi = instance;
    appendLog('api инициализирован, перехватчики установлены');
  };

  const calendar = useMemo(
    () => createWorkingCalendar(plan.calendar),
    [plan.calendar],
  );

  // Подсветка нерабочих дней (выходные, праздники) в открытом масштабе.
  const highlightTime = useCallback(
    (date: Date) => (calendar.isWorkingDay(formatIso(date)) ? '' : 'svar-holiday'),
    [calendar],
  );

  const checkB = () => {
    if (!api) return;
    try {
      const b = api.getTask('t-b') as { start?: Date; end?: Date };
      const start = b.start instanceof Date ? formatIso(b.start) : String(b.start);
      const end = b.end instanceof Date ? formatIso(b.end) : String(b.end);
      appendLog(`проверка автопереноса: t-b start=${start} end=${end} (ожидание 2026-10-19..2026-10-20)`);
    } catch (error) {
      appendLog(`проверка автопереноса: getTask('t-b') ошибка: ${String(error)}`);
    }
  };

  const holidayActive =
    plan.calendar.holidays.includes(HOLIDAY_DATE) ||
    !(plan.calendar.workingExceptions ?? []).includes(HOLIDAY_DATE);

  return (
    <div className="spike">
      <header className="spike-toolbar">
        <strong>PBT-014 · спайк SVAR Gantt</strong>
        <button type="button" onClick={() => setInclusiveEnd((v) => !v)}>
          inclusiveEnd: {inclusiveEnd ? 'вкл' : 'выкл'}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlan((p) => toggleHoliday(p, HOLIDAY_DATE));
            appendLog(`календарь: ${holidayActive ? '14.10 -> рабочее исключение' : '14.10 -> праздник'} (A5)`);
          }}
        >
          14.10: {holidayActive ? 'праздник' : 'рабочий'} (переключить)
        </button>
        <button type="button" onClick={checkB}>
          Проверить t-b (автоперенос?)
        </button>
      </header>

      <div className="spike-summary">
        <table>
          <thead>
            <tr>
              <th>Задача</th>
              <th>Начало</th>
              <th>Окончание</th>
              <th>Рабочая длительность</th>
            </tr>
          </thead>
          <tbody>
            {plan.tasks.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.id} · {t.title}
                </td>
                <td>{t.start}</td>
                <td>{t.end}</td>
                <td>{workingDuration(plan, t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="spike-gantt">
        <Willow>
          <Gantt
            tasks={tasks}
            links={links}
            inclusiveEnd={inclusiveEnd}
            init={initApi}
            highlightTime={highlightTime}
          />
          {api && <Editor api={api} />}
        </Willow>
      </div>

      <aside className="spike-log">
        <strong>Лог перехвата</strong>
        <ul>
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function prevDay(iso: string): string {
  const d = isoToDate(iso);
  d.setDate(d.getDate() - 1);
  return formatIso(d);
}
