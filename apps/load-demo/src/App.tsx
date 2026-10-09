import { useCallback, useMemo, useRef, useState } from 'react';
import GanttPanel from './svar/GanttPanel';
import ResourcePanel from './resource/ResourcePanel';
import { initMetrics, metrics, fpsRun, type LoadMetrics } from './metrics';
import { savePlanMeasured, planBytes } from './idb';
import plan500 from '../../../tests/fixtures/gantt/plan-500.json';
import { generatePlan, type FixturePlan } from '../../../tests/fixtures/gantt/generate-plan';
import type { SpikePlan, Weekday } from './plan-core';

/** FixturePlan (generate-plan, plan-500.json) -> модель панелей. */
function toSpikePlan(f: FixturePlan): SpikePlan {
  return {
    title: f.meta.title,
    calendar: {
      workingDays: f.meta.calendar.workingDays.map((d): Weekday => d as Weekday),
      holidays: [...f.meta.calendar.holidays],
    },
    groups: f.groups.map((g) => ({ id: g.id, title: g.title })),
    resources: f.resources.map((r) => ({ id: r.id, name: r.name })),
    tasks: f.tasks.map((t) => ({ ...t })),
    dependencies: f.dependencies.map((d) => ({ ...d })),
    unavailability: f.unavailability.map((u) => ({ ...u })),
  };
}

const PLAN_500: SpikePlan = toSpikePlan(plan500 as FixturePlan);

function buildScenarioB(): SpikePlan[] {
  return Array.from({ length: 10 }, (_, i) =>
    toSpikePlan(generatePlan({ seed: 42 + i, taskCount: 50 })),
  );
}

export default function App() {
  const [scenario, setScenario] = useState<'A' | 'B'>('A');
  const [savesLog, setSavesLog] = useState<string[]>([]);
  const appT0 = useRef<number>(performance.now());
  const mountedRef = useRef<Set<string>>(new Set());
  const [loadSummary, setLoadSummary] = useState<string>('монтирование…');

  // Метрики инициализируются один раз за загрузку страницы.
  if (!window.__loadMetrics) initMetrics();

  const onMounted = useCallback((panelId: string) => {
    const set = mountedRef.current;
    set.add(panelId);
    metrics().mounted[panelId] = Math.round(performance.now() - appT0.current);
    if (set.size === 10) {
      const values = Object.values(metrics().mounted);
      const total = Math.round(performance.now() - appT0.current);
      setLoadSummary(`10/10 панелей готовы за ${total} мс (макс. панель ${Math.max(...values)} мс)`);
    }
  }, []);

  const onGesture = useCallback((panelId: string, ms: number) => {
    metrics().gestures.push({ panel: panelId, ms: Math.round(ms) });
  }, []);

  const onPlanChanged = useCallback(
    (panelId: string, plan: SpikePlan) => {
      const key = `plan:${panelId}`;
      void savePlanMeasured(key, plan).then((ms) => {
        metrics().saves.push({ key, ms: Math.round(ms), bytes: planBytes(plan) });
        setSavesLog((prev) =>
          [`${key}: ${Math.round(ms)} мс (${Math.round(planBytes(plan) / 1024)} КБ)`, ...prev].slice(0, 8),
        );
      });
    },
    [],
  );

  const onAddTaskMs = useCallback((panelId: string, ms: number) => {
    metrics().gestures.push({ panel: `${panelId}:add-task`, ms: Math.round(ms) });
  }, []);

  const ganttPanelsA = useMemo(
    () => Array.from({ length: 6 }, (_, i) => ({ id: `A-gantt-${i + 1}`, title: `Гантт ${i + 1} · план-500` })),
    [],
  );
  const resourcePanelsA = useMemo(
    () => Array.from({ length: 4 }, (_, i) => ({ id: `A-res-${i + 1}`, title: `Дорожки ${i + 1} · план-500` })),
    [],
  );
  const plansB = useMemo(buildScenarioB, []);

  const runFps = useCallback(
    (panelId: string) => {
      const panel = document.querySelector(`[data-panel="${panelId}"]`);
      // Первый фактически скроллящийся контейнер внутри панели.
      const el = [...(panel?.querySelectorAll('*') ?? [])].find(
        (e) => e.scrollHeight > e.clientHeight + 4 || e.scrollWidth > e.clientWidth + 4,
      );
      if (!el) return;
      void (async () => {
        for (const dir of [1, -1]) {
          for (let i = 0; i < 6; i++) {
            el.scrollLeft += dir * 400;
            await new Promise((r) => setTimeout(r, 60));
          }
        }
        await fpsRun(1500, panelId);
      })();
    },
    [],
  );

  const saveAll = useCallback(() => {
    const entries: Array<[string, SpikePlan]> = [['plan-500', PLAN_500]];
    plansB.forEach((p, i) => entries.push([`plan-50-${i + 1}`, p]));
    for (const [key, plan] of entries) {
      void savePlanMeasured(key, plan).then((ms) => {
        metrics().saves.push({ key, ms: Math.round(ms), bytes: planBytes(plan) });
        setSavesLog((prev) =>
          [`${key}: ${Math.round(ms)} мс (${Math.round(planBytes(plan) / 1024)} КБ)`, ...prev].slice(0, 8),
        );
      });
    }
  }, [plansB]);

  const dumpMetrics = useCallback(() => {
    const m: LoadMetrics = window.__loadMetrics ?? { mounted: {}, gestures: [], saves: [], fps: [] };
    const text = JSON.stringify({ loadSummary, ...m, savesLog }, null, 2);
    // Пишем в window для bench-скрипта и показываем в консоли.
    (window as unknown as Record<string, unknown>).__loadMetricsDump = text;
    console.log('[load-demo] метрики:', text);
    setSavesLog((prev) => ['метрики выгружены в window.__loadMetricsDump', ...prev].slice(0, 8));
  }, [loadSummary, savesLog]);

  return (
    <div className="ld">
      <header className="ld-toolbar">
        <strong>PBT-016 · нагрузочная демонстрация</strong>
        <button type="button" onClick={() => setScenario('A')} style={scenario === 'A' ? { fontWeight: 700 } : undefined}>
          Сценарий A (план-500, 10 виджетов)
        </button>
        <button type="button" onClick={() => setScenario('B')} style={scenario === 'B' ? { fontWeight: 700 } : undefined}>
          Сценарий B (10 планов × 50 задач)
        </button>
        <button type="button" onClick={saveAll}>
          Сохранить все планы в IDB
        </button>
        <button type="button" onClick={() => runFps(scenario === 'A' ? 'A-res-1' : 'B-gantt-1')}>
          FPS прокрутки (первая дорожка)
        </button>
        <button type="button" onClick={dumpMetrics}>
          Выгрузить метрики
        </button>
        <span className="ld-status">{loadSummary}</span>
      </header>

      {scenario === 'A' ? (
        <main className="ld-grid">
          {ganttPanelsA.map((p) => (
            <GanttPanel
              key={p.id}
              panelId={p.id}
              title={p.title}
              initialPlan={PLAN_500}
              onPlanChanged={onPlanChanged}
              onGestureMs={onGesture}
              onAddTaskMs={onAddTaskMs}
              onMounted={onMounted}
            />
          ))}
          {resourcePanelsA.map((p) => (
            <ResourcePanel
              key={p.id}
              panelId={p.id}
              title={p.title}
              initialPlan={PLAN_500}
              onPlanChanged={onPlanChanged}
              onGestureMs={onGesture}
              onMounted={onMounted}
            />
          ))}
        </main>
      ) : (
        <main className="ld-grid">
          {plansB.map((plan, i) => (
            <GanttPanel
              key={`B-gantt-${i + 1}`}
              panelId={`B-gantt-${i + 1}`}
              title={`План ${i + 1} · 50 задач (seed ${42 + i})`}
              initialPlan={plan}
              onPlanChanged={onPlanChanged}
              onGestureMs={onGesture}
              onAddTaskMs={onAddTaskMs}
              onMounted={onMounted}
            />
          ))}
        </main>
      )}

      <aside className="ld-saves">
        <strong>Записи IDB / метрики</strong>
        <ul>
          {savesLog.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
