# Tasks — PBT-069

1. [x] `apps/project-board/src/tokens.css`: набор токенов по design D2 (включая переопределение спец. токенов Гантта/RT по D3), импорт первой строкой в `index.css`.
2. [x] Перевести `index.css` на новые имена (D3), ликвидировать все литеральные цвета (D7: selftest, save-state и др.).
3. [x] Установить `@fontsource/ibm-plex-sans@5.3.0`, `@fontsource/jetbrains-mono@5.3.0` (точные пины); подключить веса/подмножества в `main.tsx`; `body` → `var(--font-sans)`.
4. [x] Установить `lucide-react@0.575.0` (в `packages/dashboard` — правильная граница зависимости); место-образец — кнопки рамки окна (`WidgetWindow.tsx`) по D5, поведение/aria не менять.
5. [x] `.canvas-grid` по D6 на область каскада.
6. [x] Css пакетов `packages/gantt` (gantt, resource-timeline, task-editor, absence-convert, onlinegantt-import, plantuml-export-dialog) — новые имена токенов, grep литеральных цветов (D7).
7. [x] Проверить `tests/` на цветовые зависимости (grep — нет ассертаций на цвет); `lint` → `typecheck` → `test` (447) → `build` → чистая среда → `test:browser` (101 passed / 3 failed — предсуществующие, воспроизведены бисектом на develop без правок) → `openspec validate --all --strict` (17).
8. [x] Скриншоты до/после в `change/screenshots/`; ручная проверка 1024×778 и широкого экрана; Network-проверка шрифтов (D9) — шрифты локальны; попутная находка: SVAR тянет иконки с cdn.svar.dev → PBT-073 (design Risks).
9. [x] Обновить реестр: `In review` + PR#47.
