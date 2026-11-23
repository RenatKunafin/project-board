# Tasks — PBT-144

## 1. Реализация

- [x] 1.1 В `WorkspaceBackupDialog.download()` отложить `URL.revokeObjectURL` на 1000 мс (`window.setTimeout`) по прецеденту `PlanGanttWidget`.
- [x] 1.2 Стабилизировать poll calendar-теста против навигации после «Заменить пространство» (ошибка evaluate = «ещё не готово», assertion без изменений).

## 2. Тесты

- [x] 2.1 Регресс: calendar-тест «серия календаря переносится общей копией…» `--repeat-each=8` — зелёный (до фикса скачивания 1/8 красный, после отложенного отзыва вскрылась тестовая гонка 2/8, после стабилизации — 8/8).
- [ ] 2.2 Прогон `workspace-backups.spec.ts` и calendar-спеки целиком; затем полный набор по testing.md: verify:repository, lint, typecheck, test, build, test:browser, openspec validate --all --strict.

## 3. Спецификация и проверки

- [ ] 3.1 Delta spec `workspace-backup` (MODIFIED «Скачивание и проверка JSON-файла»); `openspec validate pbt-144-download-race --strict`.
- [ ] 3.2 PR в develop; реестр и карточка DoD; архивация после одобрения.
