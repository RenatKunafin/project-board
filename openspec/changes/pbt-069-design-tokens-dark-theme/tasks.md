# Tasks — PBT-069

1. [ ] `apps/project-board/src/tokens.css`: набор токенов по design D2 (включая переопределение спец. токенов Гантта/RT по D3), импорт первой строкой в `index.css`.
2. [ ] Перевести `index.css` на новые имена (D3), ликвидировать все литеральные цвета (D7: selftest, save-state и др.).
3. [ ] Установить `@fontsource/ibm-plex-sans@5.3.0`, `@fontsource/jetbrains-mono@5.3.0` (точные пины); подключить веса/подмножества в `main.tsx`; `body` → `var(--font-sans)`.
4. [ ] Установить `lucide-react@0.575.0`; место-образец — кнопки рамки окна (`WidgetWindow.tsx`) по D5, поведение/aria не менять.
5. [ ] `.canvas-grid` по D6 на область каскада.
6. [ ] Css пакетов `packages/gantt` (gantt, resource-timeline, task-editor, absence-convert, onlinegantt-import, plantuml-export-dialog) — новые имена токенов, grep литеральных цветов (D7).
7. [ ] Проверить `tests/` на цветовые зависимости (grep); прогнать `lint` → `typecheck` → `test` → `build` → чистая среда → `test:browser` → `openspec validate --all --strict`.
8. [ ] Скриншоты до/после в `change/screenshots/`; ручная проверка 1024×778 и широкого экрана; Network-проверка шрифтов (D9).
9. [ ] Обновить реестр: `In review` + PR после открытия.
