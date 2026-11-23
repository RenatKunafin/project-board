# Tasks — PBT-143

## 1. Реализация

- [x] 1.1 Заменить в `dateMarkFill` смешение с `var(--surface)` на смешение с `#000` (прецедент PBT-084); обновить комментарий плотности.
- [x] 1.2 Обновить фиксацию формулы в unit-тесте и добавить регрессию против возврата `var(--surface)`.

## 2. Тесты

- [x] 2.1 e2e: в дневном масштабе метка «тыква» — вычисленный оттенок заливки ячейки в тёплом диапазоне 15–70°.
- [ ] 2.2 Прогон затронутых наборов, затем полный набор по testing.md: verify:repository, lint, typecheck, test, build, test:browser, openspec validate --all --strict.

## 3. Спецификация и проверки

- [x] 3.1 Delta spec `project-gantt` (MODIFIED «Отображение цветовых меток дат»); `openspec validate pbt-143-date-mark-hue --strict`.
- [ ] 3.2 Живой осмотр владельца (палитра и шкала); PR в develop; реестр и карточка DoD.
