# Проверки PBT-060

База develop73f48c9; реализация руководства/примера проверена в чистом detached worktree коммита0965e7640f8a8a11b2eaff5376f3e572162d75ce. После этого изменены только отчёты/отметки выполнения. Node22.12.0, npm11.2.0, macOS arm64.

## Результаты

| Проверка | Результат |
| --- | --- |
| npm ci --no-audit --no-fund | PASS,591 пакет; версии сохранённых зависимостей не менялись |
| npm run verify:repository | PASS,74 локальные Markdown-ссылки, включая архив;6 общих скиллов/Claude-симлинков; нет изображений/записи тестов в OpenSpec |
| npm run lint / npm run typecheck | PASS, включая пример вне workspaces |
| npm test |510/510,39 файлов |
| npm run build | PASS,85 precache-записей; учебного типа нет в продуктовой сборке |
| npm run test:browser |155/155, production preview; включая storage-selftest, подписки, сохранение, Гантт и переход к конфликту |
| npm run test:pwa-updates |8/8, включая старую PBT-028, сбои/таймаут/повтор и offline |
| openspec validate --all --strict |19/19; tooling change без продуктовых дельт |
| verify:widget-example | Чистый worktree/npm ci/lint/typecheck/unit513/513/build/browser2/2; после проверки удалён только временный worktree |
| Вспомогательные наборы --list | planning8, PWA8, performance3; пути/фикстуры доступны после удаления load-demo |
| quick_validate.py (skill-creator) |6/6; PyYAML установлен только в /tmp, не в проект |
| Живой MCP-браузер на5173 | Каталог показывает только Чек-лист/План/Ресурсы, счётчика нет; __projectBoard доступен, __ganttApiRegistry отсутствует;0 ошибок/предупреждений |

Пример проверяет два различных ID окна, общее число, независимый compact, hidden-обновление, reload и сохранение настроек, отписки2→1→0 без удаления документа, миграцию v1→v2 и read-only v99. Консоль первого browser-сценария без ошибок. Скриншот двух окон просмотрен; локально test-results/widget-example-report/browser/two-views.png. Diff подключения — example-integration.patch; в нём только новый пакет, composition root и lockfile, без dashboard/widget-sdk.

## Интеграции агентов

Общие rules явно подключены через AGENTS, CLAUDE imports и opencode.json; шесть Claude-симлинков разрешаются в .agents/skills. Проверены реальные файлы/метаданные и штатный валидатор Codex. Источники механизмов загрузки приведены в docs/agents.md. Диагностическая справка установленного OpenCode не предоставляет списка навыков; запуск моделей Codex/Claude/OpenCode/Cursor/Antigravity для подтверждения автозагрузки не выполнялся. Статическую совместимость не объявляем проверкой поведения всех версий редакторов.

## Уборка и ограничения

Удаления142 файлов проверены по размеру и SHA256 из базового git:125 изображений,16 файлов load-demo и __shot.cjs, всего9726601 байт текущего дерева. Git-история не переписывалась. ADR, текстовый архив, численные raw/профили/trace, fixtures, PWA-иконки/шрифты/vendor сохранены. Реестр __ganttApiRegistry не имел tracked-потребителей; рабочие __projectBoard/storage-selftest сохранены. Полный перечень — removal-manifest.json. Исправлены17 старых архивных ссылок и ссылка фикстуры на ADR; один отсутствовавший в базе снимок честно отмечен текстом в PBT-016.

Установщик выдаёт предсуществующее engine-предупреждение eslint-visitor-keys (локальный Node22.12 против22.13+); проверки прошли. Unit сохраняет прежние предупреждения React act/Dexie, build — предупреждение размера bundle; пороги и поведение не ослаблялись. PWA-сервер потребовал разрешение sandbox на listen4184; затем набор прошёл. Полный performance-benchmark и повторная матрица planning не запускались: их код/фикстуры/бюджеты не менялись, выполнен discovery. Итоговый принятый benchmark PBT-058 остаётся в архиве.

Dev восстановлен на http://127.0.0.1:5173/. Change не архивируется до принятия PR владельцем.
