# PBT-080: исходные замеры и CPU-профиль

Дата: 2026-10-24 Europe/Moscow. Production-код develop d673454. На момент baseline реализация оптимизации ещё не начата.

## Данные и окружение

Фикстура PBT-012 plan-500: 500 задач, 100 групп, 425 связей, 9 ресурсов; native-преобразование, UI-импорт и каталог без прямой записи плана в IDB. Состав A: 6 проектных + 4 ресурсных вида одного документа в сетке на одной вкладке. Все смонтированы и получают данные; часть окон ниже viewport, как в исходной методике PBT-058.

Chrome 155.0.8059.86, headed, 1400×1000, активная страница, без заданного throttling, DevTools закрыты. Калибровка focus/visibility/rAF и хеш фикстуры — baseline-A.json. CPU/RAM/Node/Darwin/хеш lockfile — baseline-environment.json. Хеш production JS и точная команда сборки — build.json. Sourcemaps нужны только для расшифровки профиля, .map не входит в precache.

Инструментарий взят из ветки PBT-058, commit a2fc9b252871eeae6fa93e9e8f549ab91e1bd4d1, tests/performance и playwright.performance.config.ts. В локальной диагностической копии изменены только пути конфигурации/результатов и обнаружение файлов в игнорируемом каталоге; состав, сигналы готовности, разогрев и число повторов сценария A сохранены. Код приложения и package-lock не менялись. Методика — proposal/design и отчёт PBT-058 в её ветке/PR#61.

## Baseline без CPU/Tracing

Один разогрев + пять измерений. Сравнение — медиана; p95 nearest-rank при n=5 равен максимуму. Submit подготовленной формы → обновлённые счётчики/готовые чарты всех десяти видов + два rAF, без подготовки полей и RPC Playwright. Контрольная задача удаляется через UI перед следующим повтором, исходные 500 не накапливаются.

| Метрика | Медиана, мс | p95, мс | Бюджет, мс |
| --- | --- | --- | --- |
| Mount A | 845,8 | 903,0 | 1000 |
| Добавление | **960,5** | **965,2** | **400 — не выполнен** |
| Транзакция IDB | 389,7 | 428,1 | 700 |
| B→A (10 общих видов) | 449,9 | 487,1 | 500 |
| A→B (10 независимых видов) | 144,2 | 164,3 | 500 |

Сырые добавления: 962,3 / 958,1 / 956,0 / 960,5 / 965,2 мс. Файлы baseline-A.json и baseline-environment.json имеют общий runId. baseline-run.txt — журнал запуска; exit0 означает выполнение выбранного сценария, не прохождение общего budget checker. Полный benchmark B/A-interactions в этой диагностике не выполнялся, FPS повторно не измерен. PBT-058 остаётся Blocked.

## Отдельный профиль

CDP Profiler + Tracing сняты на том же production-коде, отдельно от baseline. Один UI-разогрев, затем профилируемое добавление. Это диагностический проход с другим разогревом, не парная выборка для расчёта улучшения. Его 717,5 мс не используются как новый результат бюджета.

CPU-профиль длится 1117,3 мс с учётом подготовки инструмента. Для summary.json выделено только окно от trace-метки PBT080-submit до готовности + двух rAF (717,5 мс, 715,5 мс сэмплов). Так исключены работа до Submit и команды stop/передачи профиля после готовности. Исходный workingDaysBetween ~110 мс находится вне окна и не приписывается добавлению.

В измеряемом окне: nonWorkingDayKind ~245,7 мс self; весь svar-adapter ~248,2 мс, ResourceTimelineWidget ~61,8 мс, react-dom ~55,8 мс, валидация ~6,7 мс, resourceConflicts ~12,6 мс. 123,4 мс program не атрибутированы конкретному модулю. Проценты в summary относятся ко всем выбранным сэмплам, inclusive-значения разных модулей могут пересекаться. Trace Layout ~37,9 мс и UpdateLayoutTree ~42,6 мс не складываются с JS как независимые части общего времени.

Файлы: add-task.cpuprofile (открывается в Chrome Performance/JavaScript profiler), add-task.trace.json.gz (распаковать для Chrome trace), metadata.json, summary.json. profile.bench.ts.txt — исходный диагностический сценарий (копия локального tests/performance/profile.bench.ts), analyse.cjs — преобразование координат через sourcemap и выделение временного окна. trace и profile используют общую монотонную шкалу времени; метка связывает их с записью measure.

## Повтор в текущем workspace

Диагностическая копия находится в .context/diagnostics/pbt-080 (не является частью приложения/коммитов). tests/performance взят из указанного tooling commit; tests/fixtures, tests/planning и packages в диагностическом дереве ссылаются на соответствующие текущие каталоги репозитория. testDir относителен этому config; webServer.cwd — корень репозитория. Изменён только каталог вывода результатов. Перед замерами остановить dev/preview и активные MCP-страницы; измерять в активном Chrome.

```sh
npm run build -w apps/project-board -- --sourcemap
node .context/diagnostics/pbt-080/tests/performance/run.mjs --grep 'A —'
node node_modules/@playwright/test/cli.js test --config=.context/diagnostics/pbt-080/playwright.performance.config.ts --grep CPU-profile
node .context/diagnostics/pbt-080/analyse.cjs
```

Для декодирования CPU-профиля нужен sourcemap именно записанного baseline JS: восстановить sourceCommit из build.json и собрать его указанной командой; analyse.cjs проверяет хеш перед декодированием при наличии build.json в диагностическом results/profile.

Для чистого checkout сначала восстановить диагностическое дерево из названного commit и profile.bench.ts.txt, поправив пути, описанные выше; наличие локального каталога не является продуктовым требованием. После реализации до/после сравниваются только запуски A без Profiler/Tracing по одной методике; полная итоговая приёмка — PBT-058 после merge оптимизации.

Снимки diff в этапах сохранены как `source.diff.gz` (gzip без изменения исходных байтов); helper — `calendar-view.ts.txt`.
