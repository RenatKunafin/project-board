# Tasks — PBT-075 Чек-лист: оформление, прогресс и скрытие выполненных

## 1. Стили пакета

- [ ] 1.1 `packages/checklist/src/checklist.css` по D1/D3/D4/D5 (токены, значения прототипа); импорт в виджете; удаление блока `.checklist__*` из `apps/project-board/src/index.css`
- [ ] 1.2 `lucide-react@0.575.0` пином в `packages/checklist/package.json` (Plus, Trash2)

## 2. Виджет

- [ ] 2.1 Шапка: производный прогресс «N/M выполнено (X%)» + полоса success (D1)
- [ ] 2.2 Кнопка-чип «Скрыть выполненные»: `aria-pressed`, стили toggle (D1)
- [ ] 2.3 Скрытие → `updateSettings({ hideDone })`, чтение из `settings.hideDone`; убрать `setViewSettings` (D2)
- [ ] 2.4 Пункты: hover-строка, чекбокс 16px accent-primary, Trash2 на hover (aria-label и локатор сохранены), инлайн-переименование не тронуто (D3)
- [ ] 2.5 Ввод: placeholder «Новая задача…», primary-кнопка «+» с aria-label «Добавить» (D4)

## 3. Тесты

- [ ] 3.1 E2e: обновить `shell.spec.ts` (кнопка вместо чекбокса скрытия, placeholder) — 2 теста + локаторы
- [ ] 3.2 Новые e2e: прогресс (2/3, 67%, полоса), скрытие переживает reload, добавление кнопкой «+» (D6)

## 4. Проверки и PR

- [ ] 4.1 Скриншоты «до» (виджет с выполненными, 1024×778) — до правок; «после» — по завершении
- [ ] 4.2 Живые проверки MCP: сценарий карточки «3 пункта → 2 выполнено → скрыть → reload»; 1024×778 и широкое окно; консоль чистая
- [ ] 4.3 Полный набор: lint → typecheck → test → build → чистая среда → test:browser → `openspec validate --all --strict`
- [ ] 4.4 PR в `develop`; после одобрения — архивация change с sync specs перед merge
