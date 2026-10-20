# Tasks — PBT-073 Проектный Гантт: тёмная тема, тулбар и зум

## 1. Тема и офлайн-иконки

- [x] 1.1 Вендоринг `wx-icons.css`/`wx-icons.woff`/`wx-icons.woff2` в `packages/gantt/src/vendor/wx-icons/` (хеш версии в комментарии); импорт CSS в `PlanGanttWidget.tsx`
- [x] 1.2 `Willow` → `WillowDark fonts={false}`; перенос блока `--wx-*` переопределений в `gantt.css` под скоуп `.plan-gantt .wx-willow-dark-theme` (D1); sticky-шкала — фикс PBT-053 сохранён
- [x] 1.3 Build → preview → проверка: Network без внешних запросов (снимок «до» развёрки: `cdn.svar.dev/fonts/wxi/wx-icons.css`+woff; «после»: none), глифы wxi на месте, скриншоты до/после в `change/screenshots/`

## 2. Тулбар, футер, колонки

- [x] 2.1 lucide-react@0.575.0 пином в `packages/gantt/package.json`; тулбар в две строки по D5 (строка 1: Задача/Группа/Импорт/Экспорт/PlantUML/Настройки/Проблемы; строка 2: поиск, селект ресурса, зум, счётчик) — все `data-*` и aria-labels сохранены; перенос стилей тулбара из `task-editor.css` в `gantt.css`
- [x] 2.2 Футер-статус (D5): название плана слева, `role="status"` справа (экспорт/импорт/PlantUML)
- [x] 2.3 Колонки «Начало»/«Конец» — cell-template дд.мм из документа + моно-шрифт ячеек (D4); включительность «Окончания» сверена живьём (пн–пт → 12.10/16.10, полоса покрывает пятницу)

## 3. Зум

- [x] 3.1 Сегмент «Дни/Недели» (D3): cellWidth 48/33, `scales` (месяц + дд.мм/число), состояние `settings.ganttZoom` через `updateSettings`, дефолт `weeks`; `chartRemountKey` + zoom; чистые функции в `zoom-utils.ts` (+unit ×9)
- [x] 3.2 Живая проверка: оба зума против референсов `01`/`10`; reload сохраняет зум (e2e); 1024×778 и широкое окно (скриншоты)

## 4. Прокрутка шкалы (техдолг D8 PBT-071)

- [x] 4.1 Пассивный трекинг `scrollLeft` (document-scroll-capture по `.wx-chart`, фильтр по экземпляру) + восстановление после debounce `onResize` (D6): серия попыток 0/150/350 мс + событийное окно 2 с (реакция на сброс пересборки); применение — прямой `scrollLeft` + `scroll-chart {left}` (только exec недостаточно: SVAR хранит «последний применённый left» и игнорирует повтор — диагностика в design D6)
- [x] 4.2 Конверсия позиции при смене зума через дни (чистая функция `convertZoomScrollLeft` + unit-тест)
- [x] 4.3 Живая проверка: длинный план, позиция 5000 → разворот → 5000 → возврат → 5000; fallback `{ date }` не потребовался; e2e «разворачивание окна сохраняет позицию прокрутки шкалы»

## 5. Диалоги

- [x] 5.1 Единый стиль по D7: max-width 576px у всех 7 диалогов, шапка «заголовок + описание» (общие классы `__description`), поведение/формы не тронуты

## 6. Проверки и PR

- [x] 6.1 Новые e2e: `gantt-zoom.spec.ts` (зум: ширина клетки 48/33, формат подписей, reload; прокрутка при развороте ±1 день); точечные правки существующих спек: формат дат дд-мм-гггг → дд.мм (plan-gantt/plan-calendar/task-assignments), подпись кнопки «+ Задача» → «Задача» (absence-mapping/plan-transfer), разворот окна перед dblclick нижних строк (conflicts/resource-timeline — двухстрочный тулбар уменьшил высоту чарта, скролл таблицы сдвигает строку между кликами)
- [x] 6.2 Полный набор: lint ✓, typecheck ✓, test 458 (+9 zoom-utils) ✓, build ✓, `test:browser` 114/1 (dependencies:54 — предсуществующий красный среды, бисект-факт PBT-069) на чистой среде (pkill preview, порт свободен), `openspec validate pbt-073-gantt-dark-theme --strict` ✓ и `--all --strict` ✓
- [x] 6.3 Скриншоты до/после в `change/screenshots/` (overview, zoom-days, task-dialog, 1024×778); реестр: `In progress` → PR → `In review`; после одобрения — архивация с sync specs, `Done` после merge
