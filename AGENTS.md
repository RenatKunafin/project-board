# AGENTS.md

Project Board — PWA-дашборд для управления проектами: платформа виджетов (табы, тайлинг/каскад), виджеты Гантта и чек-листа. Сейчас проект на стадии проектирования — кода ещё нет.

## Документация

- `.context/intent.md` — исходное описание продукта.
- `.context/project-decisions.md` — согласованные решения, стек-кандидаты, глоссарий.
- `.context/tasks/README.md` — реестр задач PBT-001–PBT-065 и статусов.
- `.context/openspec-workflow.md` — процесс работы (полная версия).
- `.context/layout` — макеты проекта.
- `.docs/research` — результаты исследований (PBT-011, PBT-012, PBT-014).
- `.docs/adr` — архитектурные инварианты и соглашения.
- `openspec/` — артефакты OpenSpec (changes, specs).

## Процесс

- Единица работы: **одна задача PBT = один OpenSpec change = один PR**.
- Имя change: `pbt-006-widget-registry` (lowercase kebab-case), ID задачи — `PBT-006`.
- Перед реализацией — согласование scope и design с владельцем; технические решения — в `design.md`, не в требованиях.
- Проверки: `openspec validate <change> --strict --no-interactive`; артефакты архивировать в ветке задачи до merge.

## Конвенции

- Язык документации, **размышлений** и коммуникации — русский; служебные заголовки OpenSpec (ADDED/Requirements/Scenario, SHALL, GIVEN/WHEN/THEN) — на английском.
- Целевой стек (кандидат): React + TypeScript + Vite, монорепо `apps/` + `packages/`.
- Не выдавать предложения за согласованные решения: сверяться с `project-decisions.md`.
