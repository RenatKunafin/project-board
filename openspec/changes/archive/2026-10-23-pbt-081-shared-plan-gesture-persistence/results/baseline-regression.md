# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: shared-plan-gestures.spec.ts >> 2 общих видов: drag, одна запись и стабильные даты (Сетка)
- Location: tests/e2e/shared-plan-gestures.spec.ts:87:3

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 3
+ Received  + 3

@@ -16,11 +16,11 @@
      "resources": Array [],
      "tasks": Array [
        Object {
          "end": "2026-10-20",
          "id": "target",
-         "start": "2026-10-14",
+         "start": "2026-10-12",
          "title": "Целевая задача",
        },
        Object {
          "end": "2026-10-23",
          "id": "other",
@@ -34,10 +34,10 @@
    },
    "createdAt": "2026-10-23T18:59:12.174Z",
    "documentType": "plan",
    "id": "f3d99a22-d158-4504-874e-84985d21b6b7",
    "moduleId": "gantt",
-   "revision": 3,
+   "revision": 4,
    "schemaVersion": 1,
    "title": "Общий жест",
-   "updatedAt": "2026-10-23T18:59:16.961Z",
+   "updatedAt": "2026-10-23T18:59:19.394Z",
  }
```

# Page snapshot

```yaml
- main [ref=e3]:
  - generic [ref=e4]:
    - heading "Project Board" [level=1] [ref=e11]
    - generic [ref=e12]:
      - status "Готовность к офлайн-работе" [ref=e13]: Готово к работе офлайн
      - status "Состояние сохранения" [ref=e14]: Сохранено
  - generic [ref=e15]:
    - tablist "Вкладки рабочего пространства" [ref=e16]:
      - tab "Чек-листы Переместить Чек-листы влево Переместить Чек-листы вправо Закрыть Чек-листы" [selected] [ref=e17] [cursor=pointer]:
        - generic [ref=e18]: Чек-листы
        - button "Переместить Чек-листы влево" [disabled] [ref=e19]: ←
        - button "Переместить Чек-листы вправо" [disabled] [ref=e20]: →
        - button "Закрыть Чек-листы" [disabled] [ref=e21]: ×
      - button "Новая вкладка" [ref=e22] [cursor=pointer]: +
    - generic [ref=e23]:
      - group "Режим размещения" [ref=e24]:
        - button "Каскад" [ref=e25] [cursor=pointer]
        - button "Сетка" [pressed] [ref=e30] [cursor=pointer]
      - button "Каталог документов" [ref=e37] [cursor=pointer]: Документы
      - button "Виджеты" [ref=e42] [cursor=pointer]
  - 'tabpanel "Пространство: Чек-листы" [ref=e43]':
    - group "План · Общий жест" [ref=e53]:
      - generic [ref=e54]:
        - generic [ref=e66]: План · Общий жест
        - generic [ref=e67]:
          - button "Свернуть План · Общий жест" [expanded] [ref=e68] [cursor=pointer]
          - button "Вернуть прежний размер План · Общий жест" [expanded] [ref=e71] [cursor=pointer]
          - button "Закрыть План · Общий жест" [ref=e77] [cursor=pointer]
      - generic [ref=e84]:
        - generic [ref=e85]:
          - generic [ref=e86]:
            - button "Задача" [ref=e87] [cursor=pointer]
            - button "Группа" [ref=e89] [cursor=pointer]
            - button "Импорт плана" [ref=e93] [cursor=pointer]: Импорт
            - button "Экспорт плана" [ref=e97] [cursor=pointer]: Экспорт
            - button "Экспорт PlantUML" [ref=e101] [cursor=pointer]: PlantUML
            - button "Настройки плана" [ref=e104] [cursor=pointer]
            - button "Проблемы (0)" [ref=e108] [cursor=pointer]
          - generic [ref=e111]:
            - searchbox "Поиск задач" [active] [ref=e113]
            - combobox "Фильтр по ресурсу" [ref=e114]:
              - option "Все ресурсы" [selected]
            - group "Масштаб шкалы" [ref=e115]:
              - button "Дни" [pressed] [ref=e116] [cursor=pointer]
              - button "Недели" [ref=e117] [cursor=pointer]
            - generic [ref=e118]: "Задач: 2"
        - button "Файл плана для импорта" [ref=e119]
        - generic [ref=e126]:
          - grid [ref=e130]:
            - generic [ref=e131]:
              - rowgroup [ref=e133]:
                - row [ref=e134]:
                  - columnheader "Задача Resize column" [ref=e135]:
                    - generic [ref=e136]: Задача
                    - generic "Resize column"
                  - columnheader "Начало Resize column" [ref=e137]:
                    - generic [ref=e138]: Начало
                    - generic "Resize column"
                  - columnheader "Окончание Resize column" [ref=e139]:
                    - generic [ref=e140]: Окончание
                    - generic "Resize column"
                  - columnheader "Рабочих дней Resize column" [ref=e141]:
                    - generic [ref=e142]: Рабочих дней
                    - generic "Resize column"
                  - columnheader "Исполнители" [ref=e143]
              - generic [ref=e146]:
                - row [ref=e147]:
                  - gridcell "Целевая задача" [ref=e148]
                  - gridcell "12.10" [ref=e151]
                  - gridcell "20.10" [ref=e152]
                  - gridcell "7" [ref=e153]
                  - gridcell "—" [ref=e154]
                - row [ref=e155]:
                  - gridcell "Другая задача" [ref=e156]
                  - gridcell "19.10" [ref=e159]
                  - gridcell "23.10" [ref=e160]
                  - gridcell "5" [ref=e161]
                  - gridcell "—" [ref=e162]
          - generic [ref=e163]:
            - generic:
              - generic [ref=e164]: 
              - generic [ref=e166]: 
          - generic [ref=e169]:
            - generic [ref=e170]:
              - generic [ref=e171]:
                - generic [ref=e172]: октябрь 2026 г.
                - generic [ref=e174]: ноябрь 2026 г.
              - generic [ref=e176]:
                - generic [ref=e177]: "09.10"
                - generic [ref=e179]: "10.10"
                - generic [ref=e181]: "11.10"
                - generic [ref=e183]: "12.10"
                - generic [ref=e185]: "13.10"
                - generic [ref=e187]: "14.10"
                - generic [ref=e189]: "15.10"
                - generic [ref=e191]: "16.10"
                - generic [ref=e193]: "17.10"
                - generic [ref=e195]: "18.10"
                - generic [ref=e197]: "19.10"
                - generic [ref=e199]: "20.10"
                - generic [ref=e201]: "21.10"
                - generic [ref=e203]: "22.10"
                - generic [ref=e205]: "23.10"
                - generic [ref=e207]: "24.10"
                - generic [ref=e209]: "25.10"
                - generic [ref=e211]: "26.10"
                - generic [ref=e213]: "27.10"
                - generic [ref=e215]: "28.10"
                - generic [ref=e217]: "29.10"
                - generic [ref=e219]: "30.10"
                - generic [ref=e221]: "31.10"
                - generic [ref=e223]: "01.11"
                - generic [ref=e225]: "02.11"
                - generic [ref=e227]: "03.11"
                - generic [ref=e229]: "04.11"
            - generic [ref=e242]:
              - generic [ref=e244] [cursor=pointer]:
                - generic [ref=e246]: "0"
                - generic [ref=e247]: Целевая задача
              - generic [ref=e249] [cursor=pointer]:
                - generic [ref=e251]: "0"
                - generic [ref=e252]: Другая задача
        - generic [ref=e254]:
          - generic [ref=e255]: Общий жест
          - status
```

# Test source

```ts
  1   | import { expect, test, type Locator, type Page } from '@playwright/test';
  2   |
  3   | const title = 'Общий жест';
  4   | const content = {
  5   |   title,
  6   |   calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
  7   |   groups: [], resources: [], workTypes: [], dependencies: [], unavailability: [],
  8   |   tasks: [
  9   |     { id: 'target', title: 'Целевая задача', start: '2026-10-12', end: '2026-10-16' },
  10  |     { id: 'other', title: 'Другая задача', start: '2026-10-19', end: '2026-10-23' },
  11  |   ],
  12  | };
  13  |
  14  | type Snapshot = { revision: number; content: typeof content };
  15  | async function snapshot(page: Page, id: string): Promise<Snapshot> {
  16  |   return page.evaluate((id) => window.__projectBoard!.readDocument(id) as Snapshot, id);
  17  | }
  18  |
  19  | async function setup(page: Page, count: number, mode = 'Сетка', maximize = true) {
  20  |   await page.setViewportSize({ width: 1920, height: 1080 });
  21  |   await page.goto('/');
  22  |   await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  23  |   // Убираем стартовые окна через UI, оставляя только общий план.
  24  |   for (const name of ['Экземпляр 1 · Список 1', 'Экземпляр 2 · Список 1', 'Экземпляр 3 · Список 1']) {
  25  |     const close = page.getByRole('button', { name: `Закрыть ${name}`, exact: true });
  26  |     if (await close.count()) await close.click();
  27  |   }
  28  |   let id = '';
  29  |   for (let index = 0; index < count; index += 1) {
  30  |     await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  31  |     const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  32  |     await catalog.getByRole('button', { name: 'План', exact: true }).click();
  33  |     if (index === 0) {
  34  |       await catalog.getByLabel('Название нового документа').fill(title);
  35  |       await catalog.getByRole('button', { name: 'Создать', exact: true }).click();
  36  |       id = (await page.locator('.plan-gantt').first().evaluate(el => el.closest('[data-document-id]')!.getAttribute('data-document-id'))) as string;
  37  |       await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id, content });
  38  |     } else {
  39  |       await catalog.getByRole('button', { name: title, exact: true }).click();
  40  |     }
  41  |   }
  42  |   const panes = page.locator('.widget-window').filter({ has: page.locator('.plan-gantt') });
  43  |   await expect(panes).toHaveCount(count);
  44  |   if (mode !== 'Сетка') await page.getByRole('button', { name: mode, exact: true }).click();
  45  |   const instanceId = await panes.last().locator('.plan-gantt').getAttribute('data-widget-instance');
  46  |   const pane = panes.filter({ has: page.locator(`.plan-gantt[data-widget-instance="${instanceId}"]`) });
  47  |   if (maximize) await pane.getByRole('button', { name: /Развернуть на весь дашборд/ }).click();
  48  |   await pane.getByRole('button', { name: 'Дни', exact: true }).click();
  49  |   // Дожидаемся окна восстановления прокрутки PBT-073 и старых сверок baseline.
  50  |   await page.waitForTimeout(2200);
  51  |   return { id, pane, panes };
  52  | }
  53  |
  54  | async function gesture(page: Page, pane: Locator, kind: 'drag' | 'left' | 'right', outside = false) {
  55  |   const bar = pane.locator('.wx-bar[data-id=":target"]');
  56  |   await expect(bar).toBeVisible();
  57  |   // Полоса после 30-дневного запаса шкалы: прокручиваем реальный чарт.
  58  |   await bar.evaluate(el => {
  59  |     const chart = el.closest('.wx-chart')!;
  60  |     chart.scrollLeft += el.getBoundingClientRect().left - chart.getBoundingClientRect().left - 80;
  61  |   });
  62  |   const box = (await bar.boundingBox())!;
  63  |   const x = kind === 'left' ? box.x + 7 : kind === 'right' ? box.x + box.width - 7 : box.x + box.width / 2;
  64  |   const y = box.y + box.height / 2;
  65  |   expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.wx-bar')?.getAttribute('data-id'), { x, y })).toBe(':target');
  66  |   await page.mouse.move(x, y);
  67  |   // Даём SVAR применить hover-режим края до mousedown.
  68  |   await page.waitForTimeout(100);
  69  |   await page.mouse.down();
  70  |   for (let step = 1; step <= 6; step += 1) {
  71  |     await page.mouse.move(x + 96 * step / 6, y);
  72  |     await page.waitForTimeout(60);
  73  |   }
  74  |   if (outside) {
  75  |     const bounds = (await pane.locator('.wx-chart').boundingBox())!;
  76  |     await page.mouse.move(x + 96, bounds.y - 10, { steps: 4 });
  77  |   }
  78  |   await page.waitForTimeout(300);
  79  |   await page.mouse.up();
  80  | }
  81  |
  82  | for (const scenario of [
  83  |   { count: 2, kind: 'drag' as const, start: '2026-10-14', end: '2026-10-20', mode: 'Сетка' },
  84  |   { count: 6, kind: 'right' as const, start: '2026-10-12', end: '2026-10-18', mode: 'Каскад' },
  85  |   { count: 2, kind: 'left' as const, start: '2026-10-14', end: '2026-10-16', mode: 'Сетка' },
  86  | ]) {
  87  |   test(`${scenario.count} общих видов: ${scenario.kind}, одна запись и стабильные даты (${scenario.mode})`, async ({ page }) => {
  88  |     const { id, pane, panes } = await setup(page, scenario.count, scenario.mode);
  89  |     const before = await snapshot(page, id);
  90  |     await gesture(page, pane, scenario.kind);
  91  |     await page.waitForTimeout(2400);
  92  |     const after = await snapshot(page, id);
  93  |     expect(after.content.tasks[0]).toMatchObject({ start: scenario.start, end: scenario.end });
  94  |     expect(after.revision).toBe(before.revision + 1);
  95  |     expect(after.content.tasks[1]).toEqual(before.content.tasks[1]);
  96  |     // Клик до возврата соседей: их скрытые экземпляры ещё держат старые API.
  97  |     await pane.getByRole('searchbox', { name: 'Поиск задач' }).click();
  98  |     await page.waitForTimeout(2200);
> 99  |     expect(await snapshot(page, id)).toEqual(after);
      |                                      ^ Error: expect(received).toEqual(expected) // deep equality
  100 |     // После возврата соседей все виды должны отображать результат.
  101 |     await pane.getByRole('button', { name: /Вернуть прежний размер/ }).click();
  102 |     await expect(panes.locator('.wx-row[data-id=":target"]')).toHaveCount(scenario.count);
  103 |     await page.waitForTimeout(2200);
  104 |     expect(await snapshot(page, id)).toEqual(after);
  105 |     await page.reload();
  106 |     await expect(page.locator('.plan-gantt')).toHaveCount(scenario.count);
  107 |     expect(await snapshot(page, id)).toEqual(after);
  108 |   });
  109 | }
  110 |
```
