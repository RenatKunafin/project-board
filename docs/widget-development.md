# Создание нового виджета

Руководство проверяется на примере [счётчика](../examples/counter-widget). Он хранится вне npm-workspaces продукта и не появляется в штатном каталоге. Для подключения меняются только пакет модуля и composition root приложения; dashboard и widget-sdk не редактируются.

## 1. Запуск и проверка примера

Из чистого checkout нужен Node.js22, npm и Chromium Playwright:

```bash
npm ci
npx playwright install chromium
npm run verify:widget-example
```

Команда создаёт временный detached worktree **текущего HEAD**, копирует пример в packages/counter-widget, подключает его к приложению, обновляет lockfile, выполняет npm ci, lint/typecheck/unit/build и browser-сценарий. Результаты, diff подключения и скриншот — test-results/widget-example-report/. Временный worktree удаляется после проверки; оригинальная комплектация не меняется. Незакоммиченные исходники в HEAD не входят.

Для ручного подключения:

```bash
cp -R examples/counter-widget packages/counter-widget
npm install '@project-board/counter-widget@*' --workspace apps/project-board
```

В apps/project-board/src/widgets.ts добавить:

```ts
import { createCounterModule } from '@project-board/counter-widget';
// В widgetTypes рядом с остальными модулями:
...createCounterModule().widgetTypes,
```

После установки зависимостей перезапустить dev: `npm run dev`. В каталоге «Виджеты» появится «Счётчик (пример)». Создать «Общий счётчик», затем открыть этот же документ вторым окном через каталог. «Увеличить» меняет число в обоих окнах; «Компактный вид» меняет только выбранное окно. После перезагрузки сохраняются и число, и отдельные настройки.

## 2. Пакет и регистрация

Пакет — обычный npm workspace в packages/, с private:true, type:module и exports на src/index.ts, как в [package.json примера](../examples/counter-widget/package.json). Предметный модуль импортирует публичный [widget-sdk](../packages/widget-sdk/src/index.ts); платформу, IndexedDB и модели соседних модулей он не импортирует. React в примере — peer dependency, разрешаемая сборкой приложения.

[createCounterModule](../examples/counter-widget/src/index.ts) возвращает widgetTypes с defineWidgetType:

| Поле WidgetTypeDefinition | Назначение |
| --- | --- |
| id | Уникальный стабильный идентификатор типа |
| title, description, icon | Каталог/рамка; icon — строковый ключ, например lucide:list-todo |
| component | React-компонент с WidgetProps |
| startSettings | Начальные настройки нового экземпляра |
| sizeConstraints | minWidth/minHeight и необязательные maxWidth/maxHeight |
| documentSupport | Создание и миграции документов; отсутствие означает бездокументный виджет |

Ограничения размеров заданы в **единицах раскладки**, не пикселях: сетка использует колонки/строки, каскад преобразует ограничения по правилам платформы. Окно с minWidth:2/minHeight:2 — пример, а не универсальный минимум. Реальные пиксели содержимого приходят через onResize; не рассчитывайте их из размеров внешней рамки.

Регистрация типов и миграций выполняется приложением: widgets.ts собирает модули, main.tsx вызывает collectDocumentMigrations(widgetTypes). Менять main.tsx для нового нормально именованного документа не нужно: штатный каталог задаёт title. Таблица старых title-fixup относится только к наследию уже существовавших модулей.

## 3. Документ и две независимые панели

Идентификаторы moduleId/documentType обозначают формат данных, widgetInstanceId — окно, documentId — общий документ. Несколько типов представления могут разделять один moduleId/documentType; их поддержка миграций должна совпадать. Окна не должны записывать данные в startSettings или использовать documentId как ключ настроек экземпляра.

[DocumentService](../packages/widget-sdk/src/documents.ts) предоставляет:

- create({moduleId,documentType,schemaVersion,title,content}) — создание оболочки документа; штатный каталог делает это через documentSupport.createContent.
- get(documentId) — текущий снимок; subscribe(documentId,handler) — новые снимки и функция отписки.
- update(documentId,expectedRevision,nextContent) — запись следующего неизменяемого содержимого.
- rename(documentId,expectedRevision,title) и асинхронный delete(documentId) — явные операции оболочки.

Перед записью читать свежий документ и использовать его revision. Не изменять content на месте. Конфликт редакций и будущая версия схемы дают ошибки SDK; показывайте их пользователю вместо сброса данных. В примере кнопка повторно читает значение перед увеличением, а парсер отвергает нецелые значения/переполнение.

Оболочку id/revision/timestamps/schemaVersion сохраняет платформа, содержание проверяет модуль. Подписка не обязана немедленно вызывать handler, поэтому компонент сначала вызывает get, затем subscribe:

```tsx
useEffect(() => {
  if (!documentId || !documentService) return;
  setDocument(documentService.get(documentId));
  return documentService.subscribe(documentId, setDocument);
}, [documentId, documentService]);
```

Закрытие окна вызывает cleanup подписки, а документ остаётся в каталоге. Виджету не нужно вызывать delete при размонтировании. Платформа сохраняет документы автоматически; метод flushAll не входит в публичный DocumentService SDK.

## 4. WidgetProps и состояние представления

| Свойство | Как использовать |
| --- | --- |
| widgetInstanceId | Идентичность экземпляра; не путать с documentId |
| documentId?, documentService? | Проверять наличие; документ может ещё загружаться |
| settings | Начальный снимок настроек панели |
| updateSettings?(patch) | Слить и сохранить настройки окна; при reload они вернутся в settings |
| visible | false у скрытой вкладки, свёрнутого окна и скрытых соседей максимизированного окна |
| onResize?(listener) | Подписка на пиксельный размер содержимого; вернуть её unsubscribe из useEffect |
| switchDocument?(id) | Перепривязать своё окно к документу того же поддерживаемого типа |

Для интерактивной настройки нужен локальный state, инициализированный из settings; затем одновременно setState и updateSettings. SDK не обещает обновлять settings prop в уже смонтированном компоненте. Старые getViewSettings/setViewSettings не заменяют persisted updateSettings окна.

Скрытие не означает размонтирование. Подписка на документ остаётся, а тяжёлые вычисления/анимации/измерения приостанавливаются по visible и возобновляются при true. У учебного счётчика нет тяжёлого рендера или таймеров. Пример подписывается на onResize с cleanup; ресурсоёмкие listeners, observers и timers также должны освобождаться.

Не включать типы/детали UI-библиотеки в публичный контракт модуля. Стили используют семантические токены приложения; не добавлять внешние шрифты/CDN, необходимые для первого offline-запуска.

## 5. Версии и миграции

В примере актуальная schemaVersion:2, содержимое `{count:number}`. [Чистая миграция](../examples/counter-widget/src/model.ts) переводит v1 `{value:number}` в v2. Шаги перечисляются в documentSupport.migrations как {from,to,migrate}; цепочка должна вести к актуальной версии. Содержимое не содержит дублирующей версии оболочки.

Не менять смысл старой версии без миграции. Будущую версию не перезаписывать: платформа её защищает, пример показывает сообщение об обновлении приложения. Ошибка миграции/парсинга должна оставлять исходные данные доступными для диагностики. Проверки примера охватывают чистоту/ошибки миграции; platform unit-набор проверяет восстановление старых и защиту будущих версий.

## 6. Проверка своего модуля

После подключения: lint, typecheck, unit модели, production build и browser-сценарий. Проверить новый документ, два окна одного документа, независимые настройки, reload, скрытие/возврат и закрытие без роста подписок. Для виджета с графикой проверить ресайз и hidden/resume; для новой версии — миграцию и будущую схему.

Готовый browser-сценарий — [tests/widget-example/counter.spec.ts](../tests/widget-example/counter.spec.ts), запуск — `npm run verify:widget-example`. Проверка делает diff подключения, где нет изменений packages/dashboard и packages/widget-sdk. В базовом приложении учебный тип отсутствует, поэтому он не увеличивает продуктовый каталог и precache.
