## 1. Корень монорепо

- [x] 1.1 Создать корневой `package.json` (npm workspaces: `apps/*`, `packages/*`, `private: true`, engines node >=22) и `tsconfig.base.json` (strict, ES2022); проверить: `npm install` создаёт `package-lock.json` и `node_modules` без ошибок
- [x] 1.2 Добавить корневые скрипты: `dev` (запуск app), `build`, `preview`, `typecheck` (tsc --noEmit по всем конфигам); проверить: `npm run typecheck` проходит на пустом каркасе

## 2. Пакеты-заглушки

- [x] 2.1 Создать `packages/widget-sdk` (private, ESM, без зависимостей, `src/index.ts` с маркером-экспортом и `tsconfig.json` от базы); проверить: `npm run typecheck -w packages/widget-sdk` успешен
- [x] 2.2 Создать `packages/dashboard` (зависимости: react, react-dom; devDeps: @types/*) по той же схеме; проверить typecheck пакета
- [x] 2.3 Создать `packages/gantt` и `packages/checklist` (зависимость от `widget-sdk` через `workspace:*`); проверить: `npm install` слинковал workspace, `npm ls widget-sdk` показывает связь; typecheck обоих пакетов успешен
- [x] 2.4 Проверить границы ADR-3: `dashboard` не содержит импортов из `gantt`/`checklist`; `widget-sdk` не импортирует пакеты проекта; проверка — grep по src-каталогам

## 3. Приложение

- [x] 3.1 Создать `apps/project-board`: Vite + React + TS, `App` с оболочкой-заглушкой («Project Board», текст-заглушка), один CSS-файл; `src/widgets.ts` — точка регистрации типов виджетов (пустой список, типы из `widget-sdk` не подключаются до PBT-006); проверить: `npm run dev` открывает страницу с оболочкой
- [x] 3.2 Проверить `npm run build` — собирает статические ресурсы в `apps/project-board/dist`; `npm run preview` отдаёт страницу; проверка — curl/открытие страницы

## 4. Документация и завершение

- [x] 4.1 Обновить README: команды install/dev/build/preview/typecheck, структура пакетов, версии Node/npm/Vite/React; синхронизировать `.context/openspec-setup.md` (версии); проверить: чистая установка с нуля (`rm -rf node_modules && npm ci`) и полный цикл typecheck/build/preview воспроизводимы
- [x] 4.2 Обновить карточку PBT-004 (DoD) и реестр; прогнать `openspec validate pbt-004-project-scaffold --strict --no-interactive`; открыть PR в `develop` до архивации
