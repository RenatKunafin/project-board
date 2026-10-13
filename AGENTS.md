# AGENTS.md

Project Board — PWA-дашборд для управления проектами: универсальная платформа виджетов (вкладки, каталог, тайлинг/каскад) и первые модули — чек-лист и Гантт. Стек: React 18 + TypeScript + Vite, монорепо npm workspaces (утверждено [ADR PBT-002](.docs/adr/PBT-002.md)).

> Этот файл — навигатор, а не источник статуса. Текущую стадию и статусы задач смотри в реестре `.context/tasks/README.md`.

## Стадия (обновлено 2026-10-12)

- **Готово:** процесс и каркас (PBT-001–005); платформа **полностью**: чек-лист, общие документы, IndexedDB, автосохранение, вкладки, каталог (PBT-006–011, 018–019), рамка окна (PBT-020), тайлинг (PBT-021), каскад (PBT-022), переключение режимов (PBT-023), восстановление пространства после перезапуска (PBT-024); арифметика рабочих дней и фикстуры (PBT-012–013); исследования Гантта (PBT-014–016) и решение PBT-017 (ADR); **ядро начато**: документ плана v1 и регистрация модуля (PBT-030). Все PR смержены в `develop`, активных changes нет.
- **В работе:** ничего; следующую задачу брать из реестра.
- **Далее:** платформа: PBT-025 (каталог документов) → PBT-026 (миграции) → PBT-027 (жизненный цикл скрытых виджетов); параллельно ядро: PBT-031+ (операции над задачами); PBT-066 (дизайн-токены и темы: светлая+тёмная, тёмная — дефолт) — в конце работ по дашборду (решение владельца 2026-10-12).

## Порядок погружения (для нового агента)

1. `.context/tasks/README.md` — реестр: статусы, PR, зависимости. Отсюда брать задачу.
2. Карточка задачи `.context/tasks/PBT-XXX.md` — цель, границы PR, DoD.
3. `.context/project-decisions.md` — согласованные решения и открытые вопросы. Критично различать статусы: «Согласовано» ≠ «Предложено».
4. `.context/openspec-workflow.md` — цикл работы задачи и места хранения артефактов.
5. По теме задачи: `.docs/adr/` (принятые правила), `.docs/research/` (отчёты спайков), `openspec/specs/` (действующее поведение по capabilities).

## Документация

Локальная (`.context/` — в `.gitignore`, в коммиты не попадает):

- `.context/intent.md` — исходное описание продукта.
- `.context/project-decisions.md` — согласованные решения, стек, глоссарий, история отменённых вариантов.
- `.context/tasks/README.md` — реестр задач PBT-001–PBT-066, статусы и ссылки на PR (единственное место статусов).
- `.context/tasks/PBT-XXX.md` — карточки задач: границы PR, зависимости, DoD.
- `.context/openspec-workflow.md` — полный процесс: цикл задачи, шаблон сценариев, capability-имена.
- `.context/openspec-setup.md` — версии инструментов и настройка OpenSpec с нуля.
- `.context/layout/` — макеты UI.

В репозитории:

- `.docs/adr/` — принятые решения: PBT-002 (границы платформы, стек, схема хранения, SDK v0), PBT-003 (семантика редактирования плана: правила A1–D7), PBT-017 (компоненты Гантта: SVAR/RCT, границы адаптеров, стратегии жестов, пороги PBT-058).
- `.docs/research/` — отчёты исследований: PBT-011 (vertical slice платформы), PBT-012 (фикстуры Гантта), PBT-014 (спайк SVAR), PBT-015 (спайк ресурсных дорожек), PBT-016 (замеры нагрузки).
- `openspec/specs/` — действующие требования по capabilities (`checklists`, `document-management`, `local-persistence`, `planning-documents`, `widget-layouts`, `widget-registry`, `widget-windows`, `working-calendars`, `workspace-tabs`); `openspec/changes/` — активные changes и `archive/`.

## Процесс (кратко; полная версия — `.context/openspec-workflow.md`)

- Единица работы: **одна задача PBT = один OpenSpec change = один PR**. Ветка `feature/pbt-xxx-slug` от `develop`.
- Имя change: `pbt-024-workspace-persistence` (lowercase kebab-case с ID задачи).
- Артефакты change: `proposal.md` (зачем/границы/Non-goals) → `design.md` (технические решения — здесь, не в требованиях) → `tasks.md` (шаги). Исследования и tooling без продуктового поведения — `skip_specs: true` в `.openspec.yaml`.
- Цикл: proposal + design на ревью владельца **до** кода → реализация строго в границах карточки → проверки → PR в `develop` → архивация change в ветке задачи с переносом delta specs в `openspec/specs/`.
- Валидация: `openspec validate <change> --strict` и `openspec validate --all --strict` (CLI 1.11.0; у `validate` нет флага `--no-interactive`, вопреки `openspec-setup.md`).
- Статусы: `Backlog → Ready → In progress → In review → Done`; статус и ссылка на PR меняются только в реестре.

## Разработка

- `npm run dev` — основное приложение, `http://localhost:5173`; selftest хранилища: `/#storage-selftest`.
- `npm run dev:load-demo` — нагрузочный стенд Гантта, `http://localhost:5176` (исследование PBT-016, сохраняется до PBT-058; не входит в прод-сборку).
- После установки новых зависимостей перезапускайте dev-сервер: устаревший кэш Vite даёт пустую страницу с `504 Outdated Optimize Dep` в консоли (лечится `rm -rf node_modules/.vite` + перезапуск).
- `npm run lint` · `npm run typecheck` · `npm test` · `npm run test:browser` (локально: `npx playwright install chromium`).
- CI на каждый PR в `develop`: lint → typecheck → unit → build → `openspec validate --all --strict`.

## Конвенции

- Язык документации, размышлений и коммуникации — русский; служебные заголовки OpenSpec (ADDED/Requirements/Scenario, SHALL, GIVEN/WHEN/THEN) — английские.
- Не выдавать предложения за согласованные решения: статус — по `project-decisions.md`; кандидаты и компромиссы — в `design.md`, не в требованиях.
- Коды PBT неизменяемы; новые работы получают следующие свободные номера (сейчас — после PBT-066).
- Спайки не становятся production-кодом без принятого решения. Решение PBT-017 принято: продуктовые адаптеры пишутся с нуля в `packages/gantt`; стенды `apps/gantt-spike` и `apps/resource-timeline-spike` удалены (ADR-6), `apps/load-demo` сохраняется до PBT-058.
- Ограничения выбранных компонентов Гантта (исключительная семантика дат SVAR, ненадёжный payload жестов, бета-линия RCT) — см. [ADR PBT-017](.docs/adr/PBT-017.md) и `.docs/research/PBT-014.md`/`PBT-015.md` перед задачами представлений (PBT-037+).
