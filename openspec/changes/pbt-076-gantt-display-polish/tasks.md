# Tasks — PBT-076 Гантт: доводка отображения (тулбар, зум-семантика, каскад)

## 1. Живые проверки до кода (уточнение цифр/рисков design)

- [x] 1.1 Дев-стенд: week-юнит SVAR — дефолт Вс-старт подтверждён («4–10 окт», `_weekStart: 0`); проп `_weekStart` игнорируется (init берёт локаль), проп `i18n` ждёт Context; решение — `context.i18n.Provider` с `locale({calendar:{weekStart:1}})` (адаптер `svar-locale.ts`); результат в design D2.3
- [x] 1.2 `WEEK_CELL_WIDTH = 112` (16px/день): длиннейшая подпись «28 сент – 4 окт» = 111px в клетке 112px; ~10 недель в чарт 1200px; зафиксировано в design D2.2

## 2. Строка 2 тулбара (D1)

- [x] 2.1 `gantt.css`: снят `max-width` поиска; правило `.plan-gantt__count` (12px, muted, nowrap)
- [x] 2.2 Скриншот «до» — `screenshots/before-toolbar.png`

## 3. Недельная семантика зума (D2)

- [x] 3.1 `zoom-utils.ts`: `ZOOM_SCALE`/`zoomPxPerDay`, `formatWeekRangeLabel`, `convertZoomScrollLeft` на px/день
- [x] 3.2 `PlanGanttWidget.tsx`: scales week-режима (`unit:'week'`, форматтер диапазона), `cellWidth` из `ZOOM_SCALE`, Provider понедельничной локали
- [x] 3.3 Слой подсветки нерабочих дней недельного режима: инжект блоков в `.wx-gantt-holidays` (внутри скролл-контента — без трекинга), x/ширина из `scales.start`/`lengthUnitWidth`, сверено с полосами задач
- [x] 3.4 Unit: `zoom-utils.test.ts` — 12 тестов (форматтер таблично, конверсия 48↔16, `next === undefined`)
- [x] 3.5 E2e `gantt-zoom.spec.ts`: недельные колонки+диапазоны, дневная точность подсветки (32px/16px), конверсия позиции при смене, reload; существующие обновлены
- [x] 3.6 Скриншоты «после»: `after-week-zoom-1920/1024.png`, `after-days-zoom-1920.png` (прод-сборка)

## 4. Каскад: клампинг (D3)

- [x] 4.1 Корни подтверждены живой проверкой (сжатие вьюпорта: окна за краем оставались за краем до фикса; design D3.1)
- [x] 4.2 `cascade-layout.ts`: `clampCascadeArea` + 7 unit-тестов (позиция/размер/минимум больше канваса/максимум типа)
- [x] 4.3 `CascadeLayout.tsx`: `ResizeObserver` канваса, клампинг на отображение, клампинг в `onDragStop`/`onResizeStop`
- [x] 4.4 E2e `cascade-layout.spec.ts`: resize за край клампится; сжатие канваса + reload — окно достижимо; 7/7 каскадных зелёные
- [x] 4.5 Скриншоты: живая проверка вписывания (все окна fits=true на 1024) + `after-cascade-1024.png`

## 5. Контрольная сверка (D4)

- [x] 5.1 Текстовая сверка маски уголка с `WidgetFrame.tsx` прототипа: совпадение 1-в-1 (путь/stroke/размер/отступ, PBT-075); правки не требуются — заметка в design D4

## 6. Проверки и PR

- [x] 6.1 `lint` → `typecheck` → `test` (468, +10) → `build` → чистая среда → `test:browser` 121 passed / 1 предсуществующий (dependencies:54, бисект-факт PBT-069) → `openspec validate --all --strict`
- [x] 6.2 Живые проверки MCP: недельная шкала Пн–Вс, полосы дневной точности, подсветка 32/16px, клампинг окон, консоль без ошибок
- [ ] 6.3 PR в `develop`; после одобрения — архивация change с sync specs перед merge
