## Why

Продуктовая ветка (PBT-006+) начнёт приносить код и тесты доменных правил; без общих команд lint/unit/browser-checks и CI каждый PR будет проверяться вручную и непоследовательно. Границы зависимостей ADR-3 сейчас контролируются только grep'ом на ревью — нужна автоматическая проверка. Шаблон PR приведёт описания к единому виду с PBT-ID, change и DoD (сейчас они пишутся свободным текстом).

## What Changes

- Настроить **ESLint** (flat config): typescript-eslint для всех пакетов, `eslint-plugin-react-hooks` для приложения; корневая команда `lint`.
- Настроить проверку **запрещённых направлений импорта** (ADR-3) через `no-restricted-imports` с overrides по каталогам: `dashboard` ↔ модули, `widget-sdk` → пакеты проекта.
- Настроить **unit-тесты**: Vitest как раннер (тесно связан с Vite-стеком); тесты доменных правил добавляются задачами возможностей, не здесь.
- Настроить **browser-checks**: Playwright как инструмент UI-проверок с командой запуска; в CI первой версии не выполняется (браузеры устанавливаются локально).
- Добавить **GitHub Actions CI** (`.github/workflows/ci.yml`): на PR в `develop` — `npm ci`, lint, typecheck, unit, build, `openspec validate --all --strict`.
- Добавить **шаблон PR** (`.github/pull_request_template.md`): PBT-ID, change, scope, DoD, команды проверок, визуальное подтверждение UI.
- Контрольно воспроизвести несрабатывающие-иначе ошибки: нарушение границы и ошибка типов должны реально ронять проверки (без сохранения сломанного кода).

## Capabilities

### New Capabilities

<!-- нет: инфраструктура без продуктового поведения -->

### Modified Capabilities

<!-- нет: change объявляет skip_specs: true -->

- Отсутствуют: change объявляет `skip_specs: true` — настраиваются инструменты проверки, поведение продукта не меняется.

## Impact

- Новые файлы: `eslint.config.js`, `.github/workflows/ci.yml`, `.github/pull_request_template.md`, vitest-конфиг; правки корневого `package.json` (скрипты lint/test/browser, devDeps), `package-lock.json`.
- Обновление README (команды) и `.context/openspec-setup.md` (версии инструментов).
- Вход для всех продуктовых задач: тесты доменных правил пойдут в PR самих возможностей (PBT-006+).
