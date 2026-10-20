# Tasks — PBT-071

1. [x] `WidgetWindow.tsx`: пропсы `maximized`/`onToggleMaximize`, кнопка Maximize2/Minimize2 (D5), эффект DOM-переноса (D1).
2. [x] `App.tsx`: состояние `maximizedByTab` (D2), сбросы (закрытие/сворачивание), прокидывание в `TabSurface`, `tabSurfaceAreEqual` + поле; `hiddenByMaximize` соседей и `visible` виджетов (D3).
3. [x] `index.css`: `.widget-maximize-layer`, `.tab-surface { position: relative }`, `.tab-surface--maximized`, `.widget-window--maximize-hidden`.
4. [x] Скролл: запоминание/восстановление, класс на вкладку (D4) — элемент прокрутки по живой проверке.
5. [x] Живая проверка (MCP/dev): оба режима, drag/resize после возврата, сворачивание, закрытие развёрнутого; скриншоты до/после; 1024×778 и широкий экран.
6. [x] e2e `widget-maximize.spec.ts` (D6); полный набор: `lint` → `typecheck` → `test` → `build` → чистая среда → `test:browser` → `openspec validate --all --strict`.
7. [x] Реестр: `In review` + PR.
