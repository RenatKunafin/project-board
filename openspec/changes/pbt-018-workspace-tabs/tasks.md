## 1. Модель вкладок в dashboard

- [x] 1.1 Реализовать `packages/dashboard/src/workspace.ts`: `WorkspaceError`, типы `WorkspaceTab`, `WorkspaceState`, `createWorkspaceState(title)`, иммутабельные `addTab / renameTab / moveTab / removeTab / setActive`; проверить: typecheck + lint
- [x] 1.2 Unit-тесты модели: создание и активация; переименование (в т.ч. пустое); перемещение влево/вправо и на границе; удаление активной (сосед справа/слева); удаление последней → `WorkspaceError`; неизвестный id → `WorkspaceError`; проверить: `npm test`

## 2. UI панели вкладок

- [x] 2.1 `EmptyWorkspace` (dashboard) — пустое состояние с подсказкой; проверить typecheck
- [x] 2.2 Приложение: панель вкладок (role="tablist"/"tab"/aria-selected), создание «+», переименование по двойному клику, перемещение «←/→», закрытие «×» (disabled на последней); наборы экземпляров per-вкладка (срез PBT-011 в первой, пустые в новых); клавиатурная навигация стрелками; проверить: `npm run dev` — сценарий руками
- [x] 2.3 E2E: создание/переключение/переименование/порядок/удаление (активной и запрет последней), клавиатурная активация, сохранность документа после удаления вкладки; скриншот оболочки; проверить: `npm run test:browser`

## 3. Завершение

- [x] 3.1 Полный цикл: lint → typecheck → test → build → test:browser; `openspec validate pbt-018-workspace-tabs --strict --no-interactive`
- [x] 3.2 Открыть PR в `develop` (шаблон PBT); обновить карточку PBT-018 (DoD) и реестр (In review, PR)
