## 1. Планирование и конфигурация

- [ ] 1.1 Зафиксировать counter id `113967203`, временное включение Вебвизора и release-only флаг; проверить proposal/design/spec strict.
- [ ] 1.2 Добавить безопасный идемпотентный загрузчик Метрики с нормализованным публичным URL, no-op при ошибке и без `dataLayer`-событий.
- [ ] 1.3 Передать флаг только в GitHub Pages release workflow; убедиться, что dev/preview/CI build его не получают.

## 2. Проверки приложения

- [ ] 2.1 Добавить unit-тесты конфигурации/загрузчика: disabled, enabled, повторный вызов и отказ сети.
- [ ] 2.2 Добавить production browser-сценарий: enabled/disabled network interception, один initial hit, переключение вкладок/окон, reload/PWA и отсутствие дублей.
- [ ] 2.3 Проверить offline и блокировку `mc.yandex.ru`, отсутствие пользовательских payload/dataLayer и корректный подпуть `/project-board/`.

## 3. Публикация и приёмка

- [ ] 3.1 Выполнить verify repository, lint, typecheck, unit, build, Pages build/checks и OpenSpec strict.
- [ ] 3.2 Подготовить PR с privacy/release checklist: Вебвизор временно включён, уведомление владельца проверено, отключение — переключением флага; отдельно отметить post-release проверки.
- [ ] 3.3 После публикации проверить сетевой запрос и тестовый визит на реальном Pages URL; затем оставить решение о выключении Вебвизора владельцу.
