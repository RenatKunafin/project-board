# Tasks — PBT-068 Компактная плотность Гантта

## 1. Реализация и живая проверка

- [x] 1.1 Передать `cellWidth={33}` и `rowHeight={36}` в `Gantt` (`PlanGanttWidget.tsx`); build → preview → MCP: замер DOM (день ≤ 40px, строка ≤ 36px), читаемость шкалы/полос/подсветки, скриншот до/после в `change/screenshots/`
- [x] 1.2 Аудит `gantt.css` на жёсткие пиксельные привязки к масштабу; мелкие правки по результату живой проверки (только токены)

## 2. Проверки и PR

- [x] 2.1 Полный набор: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `test:browser` на чистой среде, `openspec validate pbt-068-compact-gantt-density --strict` и `--all --strict`
- [ ] 2.2 Реестр: `In progress` → PR → `In review`; после одобрения — архивация с sync specs, `Done` после merge
