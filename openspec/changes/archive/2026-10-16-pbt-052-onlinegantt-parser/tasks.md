# Tasks — PBT-052 Парсер OnlineGantt `.gantt`

## 1. Каркас парсера и фатальная диагностика

- [x] 1.1 Создать `packages/gantt/src/onlinegantt-parser.ts`: типы результата (`OnlineGanttIssue`, `OnlineGanttImportReport`, варианты `ok`/отказ по design D1) и функцию `parseOnlineGanttFile` с фатальными проверками (не-JSON `invalid-json`; верхний уровень/`data`/`resources` — `invalid-structure`); юнит-тесты на каждый фатальный случай и на неизменность входа
- [x] 1.2 Реализовать конвертацию дат по D2 (IANA `sv-SE` → `timezoneOffset` → UTC + `unknown-timezone`) и сборку календаря по D6 (`workWeek` → рабочие дни, праздники диапазоном, сводка неперенесённых настроек); тесты: `2026-08-31T05:00Z`→`2026-08-31`, `2026-11-03T21:00Z`→`2026-11-04`, отсутствие пояса — UTC + предупреждение, `workTime` в отчёте

## 2. Записи, группы, ресурсы, назначения

- [x] 2.1 Преобразовать записи в задачи по D3–D4, D7: даты (`duration-mismatch` по сверке с `workingDaysBetween`, `invalid-task-date`, `inverted-interval`, `unsupported-duration-unit` — пропуск записи или предупреждение), `t-<TaskID>`, дубли ID, `assigneeIds` + `assigneeUnits`, `notes` (мини-извлекатель HTML); тесты на каждый вид предупреждения и на инвариант «результат проходит `parsePlanContent`»
- [x] 2.2 Реализовать рекурсивный обход `subtasks` по D10: контейнер → группа `g-<TaskID>` (даты/`Duration` не читаются, предупреждения `group-assignments-dropped`/`group-predecessor-dropped`), лист → задача с `groupId`; дубли ID на любых уровнях — пропуск поддерева с `duplicate-task-id`; тесты: вложенность 3 уровней, `subtasks: []` → задача, контейнер с назначениями
- [x] 2.3 Преобразовать справочник ресурсов (`resourceId`, дубли с предупреждением); тест: назначения ссылаются только на вошедшие ресурсы, `unknown-reference` от `parsePlanContent` невозможен (назначение на пропущенный ресурс отбрасывается с предупреждением)

## 3. Зависимости

- [x] 3.1 Реализовать разбор `Predecessor` по D5: разделители `,`/`;`, `15FS` → лаг 0, `+N day(s)` → N, пропуски с кодами `unsupported-dependency-type` / `invalid-dependency-lag` / `unknown-predecessor` / `duplicate-dependency-pair` / самоссылка; тесты: нулевой и ненулевой лаг, несколько предшественников (две зависимости), все коды пропуска

## 4. Эталоны рабочих файлов и сборка

- [x] 4.1 Добавить `tests/fixtures/gantt/onlinegantt-parser.test.ts`: эталон 1 (`diagramm.reference.gantt`) — 47 задач, 9 ресурсов, групп нет, 16 задач без назначений (остались задачами), лаги 0/14/1, праздник `2026-11-04`, `unit` в `assigneeUnits`, `notes` двух записей текстом; эталон 2 (копия `Online Gantt 20261016.gantt` → `onlinegantt-20261016.reference.gantt`) — 2 группы («Отпуск» ×16, «ОКАД» ×16), 47 задач, 9 ресурсов, зависимость через границу контейнеров (`БЧ-АНЛ-ANDR` → `17FS+25 days`, 17 внутри «ОКАД»), даты контейнеров в план не попали; сверка дат выборочных записей с ручным разбором примеров
- [x] 4.2 Прогнать полный набор: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` + `test:browser` на чистой среде (чистый preview, порт 4173 свободен), `openspec validate pbt-052-onlinegantt-parser --strict` и `openspec validate --all --strict`; результаты зафиксировать для PR
- [x] 4.3 Контрольная сверка с оригиналом (метод владельца): открыть оба эталонных файла на `onlinegantt.com/#/gantt` и сверить интерпретацию оригинала с разобранным планом — группы/контейнеры, даты (включительный конец), зависимости с лагами, ресурсы; расхождения — либо фикс парсера, либо явное решение в design (скриншот референса уже в `change/screenshots/`)

## 5. Реестр и PR

- [x] 5.1 После одобрения артефактов: коммит change в ветку, статус `In progress` в реестре `.context/tasks/README.md`
- [x] 5.2 Открыть PR в `develop` с результатами проверок и скриншотами/выводами тестов; после одобрения — архивация change с sync specs в `openspec/specs/plan-transfer/` заключительным коммитом перед merge, статус `Done` после merge
