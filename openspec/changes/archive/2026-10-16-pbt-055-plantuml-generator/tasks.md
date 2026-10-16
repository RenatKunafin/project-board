# Tasks — PBT-055 Генератор PlantUML

## 1. Генератор и тесты

- [x] 1.1 Создать `packages/gantt/src/plantuml-export.ts` по design D1–D5 в стиле целевого примера: `language ru`, алиасы задач/отпусков, `requires N days` + `starts`, палитра этапов по маркерам (D3), праздники `is closed` + рабочие исключения `is open`, раздел `-- Отпуска --`, FS-стрелки по алиасам, выходные `lightgray` диапазонами, `printscale daily zoom 1`, кодирование названий (D4), отчёт (D5); экспорт из `index.ts`
- [x] 1.2 Unit-тесты `plantuml-export.test.ts`: эталонный текст контрольного плана (группы, лаг, праздник, исключение, отпуск, маркеры этапов, выходные-диапазоны); кириллица и скобки; дубли названий + связи по алиасам; края на нерабочих днях → отчёт; пустой план; детерминированность (двойной вызов)

## 2. Рендер-верификация

- [x] 2.1 Живая проверка контрольного текста на закреплённой версии PlantUML (1.2026.9beta4, метод спайка): 200/без Syntax Error, подписи и даты в SVG; скриншот в `change/screenshots/`

## 3. Проверки и PR

- [x] 3.1 Полный набор: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `test:browser` на чистой среде, `openspec validate pbt-055-plantuml-generator --strict` и `--all --strict`; результаты в PR
- [x] 3.2 Реестр: `In progress` → PR → `In review`; после одобрения — архивация с sync specs (новая capability `plantuml-export`) заключительным коммитом перед merge, `Done` после merge
