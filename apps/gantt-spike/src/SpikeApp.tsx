import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const apiRef = useRef<IApi | null>(null);
  const ganttHostRef = useRef<HTMLDivElement | null>(null);

  const appendLog = (line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 40));
  };

  // Данные передаются в SVAR один раз: источник отображения — стор компонента.
  // План спайка — производная модель, синхронизируемая после жестов (ниже).
  const initialTasks = useMemo(() => toSvarTasks(initialPlan), [initialPlan]);
  const initialLinks = useMemo(() => toSvarLinks(initialPlan), [initialPlan]);

  const applyRule = useCallback(
    (id: string, storeStart: string, storeEndInc: string) => {
      const task = planRef.current.tasks.find((t) => t.id === id);
      if (!task) return;
      if (storeStart === task.start && storeEndInc === task.end) return;
      let next: SpikePlan;
      let kind: string;
      if (storeStart !== task.start) {
        // Drag или resize за левый край: сохраняем рабочую длительность (A2),
        // начало привязывается к рабочему дню в сторону переноса.
        const direction = storeStart < task.start ? 'backward' : 'forward';
        next = dragTaskTo(planRef.current, id, storeStart, direction);
        kind = 'drag (A2)';
      } else {
        // Resize правого края: окончание сохраняем как введённое (A3/A4).
        next = resizeTaskEnd(planRef.current, id, storeEndInc);
        kind = 'resize (A3)';
      }
      const updated = next.tasks.find((t) => t.id === id);
      if (!updated) return;
      setPlan(next);
      // Исправленные даты возвращаем в стор SVAR (исключительное окончание).
      const instance = apiRef.current;
      if (instance) {
        instance.exec('update-task', {
          id,
          task: {
            start: isoToDate(updated.start),
            end: isoToDate(addCalendarDaysIso(updated.end, 1)),
          },
        });
      }
      appendLog(`${kind} ${id}: ${task.start}..${task.end} -> ${updated.start}..${updated.end}`);
    },
    [],
  );

  // Payload update-task ненадёжен, init-перехватчики переживают пересоздание
  // внутреннего bus SVAR. Поэтому после жеста (mouseup/touchend) сверяем стор с
  // планом несколько раз: стор применяет жест с нестабильной задержкой.
  const syncWithStore = useCallback(() => {
    const readOnce = () => {
      const store = apiRef.current;
      if (!store) return;
      for (const task of planRef.current.tasks) {
        let stored: { start?: Date; end?: Date };
        try {
          stored = store.getTask(task.id) as { start?: Date; end?: Date };
        } catch {
          continue;
        }
        if (!(stored.start instanceof Date) || !(stored.end instanceof Date)) continue;
        const storeStart = formatIso(stored.start);
        const endDate = new Date(stored.end);
        endDate.setDate(endDate.getDate() - 1);
        const storeEndInc = formatIso(endDate);
        if (storeStart !== task.start || storeEndInc !== task.end) {
          applyRule(task.id, storeStart, storeEndInc);
          break;
        }
      }
    };
    for (const delay of [80, 450, 1000]) {
      setTimeout(readOnce, delay);
    }
  }, [applyRule]);

  useEffect(() => {
    const host = ganttHostRef.current;
    if (!host) return;
    const handler = () => syncWithStore();
    host.addEventListener('mouseup', handler);
    host.addEventListener('touchend', handler);
    return () => {
      host.removeEventListener('mouseup', handler);
      host.removeEventListener('touchend', handler);
    };
  }, [syncWithStore]);

  const initApi = (instance: IApi) => {
    instance.intercept('schedule-tasks', (ev: unknown) => {
      appendLog(`schedule-tasks: НЕ ОЖИДАНО в open-редакции: ${JSON.stringify(ev)}`);
      return true;
    });
    apiRef.current = instance;
    (window as unknown as Record<string, unknown>).__spikeApi = instance;
    appendLog('api инициализирован');
    setApi(instance);
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

      <div className="spike-gantt" ref={ganttHostRef}>
        <Willow>
          <Gantt
            tasks={initialTasks}
            links={initialLinks}
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
