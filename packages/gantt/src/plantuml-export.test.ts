import { describe, expect, it } from 'vitest';
import { createPlanContent, type PlanContent } from './plan-document';
import {
  encodePlantUmlTitle,
  serializePlanToPlantUml,
  type PlantUmlExportNote,
} from './plantuml-export';

/** Контрольный план: все переносимые разделы + данные для отчёта. */
function controlPlan(): PlanContent {
  return {
    ...createPlanContent('План «ОКАД»'),
    calendar: {
      workingDays: [1, 2, 3, 4, 5],
      holidays: ['2026-11-04', '2027-03-08'],
      workingExceptions: ['2026-10-17'],
    },
    workTypes: [{ id: 'dev', title: 'Разработка', allowsParallel: false }],
    resources: [
      { id: 'r-qa', title: 'QA' },
      { id: 'r-efs', title: 'ЕФС-разработчик' },
    ],
    groups: [
      { id: 'g-okad', title: 'ОКАД' },
      { id: 'g-okad-ios', title: 'iOS', parentId: 'g-okad' },
      { id: 'g-empty', title: 'Будущее' },
    ],
    tasks: [
      {
        id: 't-1',
        title: 'АНЛ-ЕФС (ОКАД)',
        groupId: 'g-okad',
        start: '2026-10-12',
        end: '2026-10-16',
        assigneeIds: ['r-efs'],
      },
      {
        id: 't-2',
        title: 'DEV-ЕФС (ОКАД)',
        groupId: 'g-okad',
        start: '2026-10-19',
        end: '2026-10-30',
      },
      {
        id: 't-3',
        title: 'ИФТ-iOS (ОКАД)',
        groupId: 'g-okad-ios',
        start: '2026-11-05',
        end: '2026-11-11',
        assigneeIds: ['r-qa'],
        // unit — доп. поле импорта (passthrough PBT-050/052)
        ...({ assigneeUnits: { 'r-qa': 100 } } as object),
      },
      {
        id: 't-4',
        title: 'Выходная задача',
        start: '2026-10-17',
        end: '2026-10-18',
      },
      {
        id: 't-5',
        title: 'Сб-вс пауза',
        start: '2026-10-24',
        end: '2026-10-25',
      },
    ],
    dependencies: [
      { id: 'd-1', fromTaskId: 't-1', toTaskId: 't-2', lagDays: 0 },
      { id: 'd-2', fromTaskId: 't-2', toTaskId: 't-3', lagDays: 3 },
    ],
    unavailability: [
      { id: 'u-1', resourceId: 'r-qa', start: '2026-10-26', end: '2026-10-27' },
    ],
  };
}

function topics(report: readonly PlantUmlExportNote[]): string[] {
  return report.map((note) => note.topic);
}

describe('serializePlanToPlantUml — контрольный план', () => {
  const result = serializePlanToPlantUml(controlPlan());
  const text = result.text;

  it('шапка: title, language ru, старт проекта, закрытые дни и праздники в горизонте', () => {
    expect(text).toContain('@startgantt');
    expect(text).toContain('title План «ОКАД»');
    expect(text).toContain('language ru');
    // Горизонт: 17.10–18.10 (мин) … 18.10 пауза? min = 2026-10-12, max = 2026-11-11.
    expect(text).toContain('Project starts 2026/10/12');
    expect(text).toContain('saturday are closed');
    expect(text).toContain('sunday are closed');
    // Праздник в горизонте; вне горизонта (2027-03-08) — отсечён.
    expect(text).toContain('2026/11/04 is closed');
    expect(text).not.toContain('2027/03/08');
    // Рабочее исключение переносимо (is open, скилл-референс).
    expect(text).toContain('2026/10/17 is open');
  });

  it('группы полным путём, включая пустую; задачи без ручного цвета — без явного цвета', () => {
    expect(text).toContain('-- ОКАД --');
    expect(text).toContain('-- ОКАД / iOS --');
    expect(text).toContain('-- Будущее --');
    expect(text).toContain('-- Отпуска --');
    expect(text).toContain('[АНЛ-ЕФС (ОКАД)] as [T1] requires 5 days');
    expect(text).toContain('[T1] starts 2026/10/12');
    // PBT-084: эвристика этапов удалена — публикация красит только ручным цветом.
    expect(text).not.toContain('is colored in LightSkyBlue');
    expect(text).toContain('[DEV-ЕФС (ОКАД)] as [T2] requires 10 days');
    expect(text).not.toContain('is colored in MediumPurple');
    expect(text).toContain('[ИФТ-iOS (ОКАД)] as [T3] requires 5 days');
    expect(text).not.toContain('is colored in Orange');
  });

  it('отпуск — тёмно-зелёная задача раздела отпусков', () => {
    expect(text).toContain('[Отпуск — QA] as [U1] requires 2 days');
    expect(text).toContain('[U1] is colored in DarkGreen/DarkGreen');
  });

  it('A6: интервал без рабочих дней — веха happens', () => {
    // 17–18.10: сб-вс, но 17.10 — рабочее исключение → 1 раб. день (t-4).
    // t-5: 24–25.10 сб-вс без исключений → 0 раб. дней.
    expect(text).toContain('[Сб-вс пауза] as [T5] happens 2026/10/24');
    expect(text).not.toContain('[T5] requires');
    expect(text).not.toContain('[T5] starts');
  });

  it('связи по алиасам; выходные — серые диапазоны; финал printscale', () => {
    expect(text).toContain('[T1] -> [T2]');
    expect(text).toContain('[T2] -> [T3]');
    expect(text).toContain('2026/10/24 to 2026/10/25 are colored in lightgray');
    expect(text).toContain('printscale daily zoom 1');
    expect(text.trimEnd().endsWith('@endgantt')).toBe(true);
  });

  it('отчёт: лаг, сводная полоса, типы работ, unit; без конфликта-заметок лишних', () => {
    const list = topics(result.report);
    expect(list).toContain('lag');
    expect(list).toContain('summary-bar');
    expect(list).toContain('work-types');
    expect(list).toContain('unit');
    // Праздник вне горизонта не попал, пустой план не пуст — заметки быть не должно.
    expect(list).not.toContain('empty-plan');
  });

  it('ручной цвет публикуется hex, без ручного цвета — без явного цвета (PBT-084)', () => {
    const plan = controlPlan();
    const manual = serializePlanToPlantUml({
      ...plan,
      tasks: plan.tasks.map((task, index) =>
        index === 0 ? { ...task, color: 'sapphire' } : task,
      ),
    });
    expect(manual.text).toContain('[T1] is colored in #3186e9/#3186e9');
    // Прочие задачи (с прежними маркерами этапов в названиях) — без цвета.
    expect(manual.text).not.toContain('[T2] is colored in');
    expect(manual.text).not.toContain('[T3] is colored in');
  });
});

describe('кодирование и края', () => {
  it('квадратные скобки и двоеточия заменяются, кавычки остаются', () => {
    expect(encodePlantUmlTitle('Задача [срочно]: «фаза 1»')).toBe(
      'Задача (срочно)— «фаза 1»',
    );
  });

  it('дубли названий не рвут связи: алиасы уникальны', () => {
    const plan: PlanContent = {
      ...createPlanContent('Дубли'),
      calendar: {
        workingDays: [1, 2, 3, 4, 5],
        holidays: [],
        workingExceptions: [],
      },
      tasks: [
        { id: 'a', title: 'Работа', start: '2026-10-12', end: '2026-10-13' },
        { id: 'b', title: 'Работа', start: '2026-10-14', end: '2026-10-15' },
      ],
      dependencies: [
        { id: 'd', fromTaskId: 'a', toTaskId: 'b', lagDays: 0 },
      ],
    };
    const result = serializePlanToPlantUml(plan);
    expect(result.text).toContain('[Работа] as [T1] requires 2 days');
    expect(result.text).toContain('[Работа] as [T2] requires 2 days');
    expect(result.text).toContain('[T1] -> [T2]');
  });

  it('край полосы на нерабочем дне — заметка non-working-edge', () => {
    const plan: PlanContent = {
      ...createPlanContent('Край'),
      calendar: {
        workingDays: [1, 2, 3, 4, 5],
        holidays: [],
        workingExceptions: [],
      },
      tasks: [
        // пт 16.10 → сб 17.10: конец на нерабочем.
        { id: 't', title: 'Крайняя', start: '2026-10-16', end: '2026-10-17' },
      ],
    };
    const result = serializePlanToPlantUml(plan);
    expect(topics(result.report)).toContain('non-working-edge');
  });
});

describe('пустой план и детерминизм', () => {
  it('пустой план — валидный скелет с якорем и заметкой', () => {
    const result = serializePlanToPlantUml(createPlanContent('Пусто'));
    expect(result.text).toContain('Project starts 2000/01/01');
    expect(topics(result.report)).toContain('empty-plan');
  });

  it('генерация детерминирована', () => {
    const first = serializePlanToPlantUml(controlPlan());
    const second = serializePlanToPlantUml(controlPlan());
    expect(second.text).toBe(first.text);
    expect(second.report).toEqual(first.report);
  });

  it('план без непереносимой семантики даёт пустой отчёт', () => {
    const plan: PlanContent = {
      ...createPlanContent('Чистый'),
      calendar: {
        workingDays: [1, 2, 3, 4, 5],
        holidays: [],
        workingExceptions: [],
      },
      tasks: [
        { id: 't', title: 'Просто задача', start: '2026-10-12', end: '2026-10-13' },
      ],
    };
    const result = serializePlanToPlantUml(plan);
    expect(result.report).toEqual([]);
  });
});
