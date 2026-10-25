## 1. Локальные проверки

- [x] 1.1 Настроить ESLint 9 flat config (`eslint.config.js`): typescript-eslint + react-hooks; скрипт `lint`; проверить: `npm run lint` проходит на каркасе
- [x] 1.2 Добавить overrides границ ADR-3 (`no-restricted-imports`): dashboard без gantt/checklist, widget-sdk без @project-board/*; контрольное воспроизведение: временный импорт роняет lint, после отката lint проходит (вывод в PR)
- [x] 1.3 Настроить Vitest (`test`, `--passWithNoTests` в CI-фазе каркаса) и Playwright (`test:browser`, конфиг с webServer=preview); проверить: `npm run test` и `npm run test:browser` запускаются (browser: chromium установлен локально)

## 2. CI и шаблон PR

- [x] 2.1 Добавить `.github/workflows/ci.yml` (PR/push в develop): npm ci → lint → typecheck → test → build → `openspec validate --all --strict --no-interactive`; проверить: workflow проходит на ветке (вывод в PR)
- [x] 2.2 Добавить `.github/pull_request_template.md` (PBT-ID, change, scope, non-goals, DoD, команды проверок, визуальное подтверждение UI); проверить: шаблон подставляется в новый PR
- [x] 2.3 Контрольное воспроизведение ошибки типов: временная аннотация ломает typecheck, после отката — проходит (вывод в PR)

## 3. Документация и завершение

- [x] 3.1 Обновить README (команды lint/test/test:browser, раздел «Проверки») и `.context/openspec-setup.md` (версии eslint/vitest/playwright); проверить согласованность
- [x] 3.2 Обновить карточку PBT-005 (DoD) и реестр; прогнать `openspec validate pbt-005-quality-checks --strict --no-interactive`; открыть PR в `develop` до архивации
