# Design — PBT-069 Дизайн-токены и тёмная тема

Референс: `flexi-dashboard-hub/src/styles.css` (`:root`, `canvas-grid`, `shadow-float`). Референс-скриншоты: `screenshots/redesign-ref/01-dashboard-overview.png`.

## D1. Файл токенов и способ доставки

Новый `apps/project-board/src/tokens.css` — единственное место литеральных цветов; импортируется в `index.css` первой строкой. Доставка виджетам — глобальные CSS-переменные (документированное решение «пока только глобальные переменные», карточка PBT-066; тема в SDK v0 отсутствует осознанно). Пакеты (`gantt`, `checklist`) используют `var(--…)` без знания о файле.

## D2. Набор токенов (значения прототипа)

| Токен | Значение | Назначение |
| --- | --- | --- |
| `--background` | `oklch(0.2 0.022 250)` | фон канваса вкладки |
| `--chrome` | `oklch(0.17 0.02 250)` | панели каркаса (шапка, вкладки) |
| `--surface` | `oklch(0.235 0.025 250)` | поверхности окон |
| `--surface-raised` | `oklch(0.27 0.027 250)` | заголовки окон, шапки таблиц |
| `--foreground` | `oklch(0.9 0.012 250)` | основной текст |
| `--card` / `--card-foreground` | `= surface` / `= foreground` | карты/панели |
| `--popover` / `--popover-foreground` | `oklch(0.255 0.027 250)` / `oklch(0.92 0.01 250)` | dropdown-панели |
| `--primary` / `--primary-foreground` | `oklch(0.62 0.17 255)` / `oklch(0.98 0 0)` | акцент |
| `--secondary` / `--secondary-foreground` | `oklch(0.3 0.028 250)` / `= foreground` | вторичные поверхности |
| `--muted` / `--muted-foreground` | `oklch(0.28 0.025 250)` / `oklch(0.66 0.025 250)` | приглушённое |
| `--accent` / `--accent-foreground` | `oklch(0.32 0.03 250)` / `oklch(0.95 0.01 250)` | hover/выделение |
| `--destructive` / `--destructive-foreground` | `oklch(0.66 0.2 22)` / `oklch(0.98 0 0)` | опасные действия, конфликты |
| `--success` | `oklch(0.76 0.17 155)` | позитивные статусы |
| `--warning` | `oklch(0.84 0.16 88)` | предупреждения, отпуска |
| `--border` / `--input` / `--ring` | `oklch(0.31 0.025 250)` / `oklch(0.33 0.025 250)` / `= primary` | границы/поля/фокус |
| `--font-sans` | `'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif` | основной шрифт |
| `--font-mono` | `'JetBrains Mono', ui-monospace, monospace` | даты, шкалы, числа |
| `--radius` | `0.375rem` (+ `sm/md/lg/xl` через calc) | радиусы |
| `--shadow-float` | `0 18px 40px -12px oklch(0 0 0 / 0.6)` | «плавающие» окна/панели |

## D3. Маппинг старых токенов (полная замена имён, без алиасов)

| Было | Станет |
| --- | --- |
| `--color-bg` | `--background` (панели каркаса, где была «шапка» — `--chrome` по месту) |
| `--color-surface` | `--surface` (вторичные поверхности кнопок — `--secondary` по месту) |
| `--color-border` | `--border` |
| `--color-text` | `--foreground` |
| `--color-text-muted` | `--muted-foreground` |
| `--color-text-faint` | `--muted-foreground` (различие — прозрачностью `color-mix`, где уместно) |
| `--color-accent` / `--color-on-accent` | `--primary` / `--primary-foreground` |
| `--color-danger` | `--destructive` |
| `--radius-sm: 6px` | `--radius-md` (= `--radius` 6px); выравнивание прочих радиусов — PBT-070+ |

Спец. токены производных представлений — остаются по именам, значения переопределяются производными:

| Токен | Новое значение (по мотивам прототипа) |
| --- | --- |
| `--color-gantt-weekend` | `var(--muted)` (прототип: `.demo-weekend`) |
| `--color-gantt-holiday` | `color-mix(in oklch, var(--warning) 15%, var(--surface))` |
| `--color-rt-task-border` | `var(--primary)` |
| `--color-rt-unavailability-bg` | `color-mix(in oklch, var(--warning) 14%, var(--surface))` |
| `--color-rt-unavailability-border` | `var(--warning)` |
| `--color-rt-conflict-bg` | `color-mix(in oklch, var(--destructive) 18%, var(--surface))` |

Примечание: семантика «отпуск = warning» вместо прежнего красного — по прототипу (`resource-bar-absence`); конфликт остаётся destructive. Тонкая настройка видов — PBT-073/074, здесь значения просто перестают быть светлыми.

## D4. Шрифты

`@fontsource/ibm-plex-sans@5.3.0` (400, 500, 600, 700 — cyrillic + latin), `@fontsource/jetbrains-mono@5.3.0` (400, 500). Импорты конкретных весов/подмножеств — в `main.tsx` до `index.css`. Fallback сохранён в значении токена. Результат: страница не делает внешних запросов шрифтов (критерий DoD и требование спеки).

## D5. Иконки lucide-react

Пин `0.575.0` (версия прототипа). Место-образец — кнопки рамки окна (`WidgetWindow`): текстовые символы `−`/`×` → `ChevronUp`/`ChevronDown`/`X` (16px, `currentColor`), aria-label и обработчики без изменений — e2e не затронуты. SDK `icon?: string` не трогаем: иконка типа виджета в каталоге — emoji до отдельного решения о наборе и контракте (расширение контракта — новое решение по правилам ADR-6). Размер иконок 16px (h-4/w-4 прототипа).

## D6. Точечная сетка канваса

Класс `.canvas-grid` (radial-gradient, точка 1px `oklch(1 0 0 / 0.06)`, шаг 16px) в `index.css`; применяется к контейнеру каскадного размещения. В тайлинге не применяется: раскладку структурирует RGL-сетка, точки добавили бы визуальный шум (прототип рисует сетку в обоих режимах — осознанное отклонение). Шаг 16px фиксирован (настройка шага сетки в прототипе — часть демо-настроек, не переносится).

## D7. Ликвидация литеральных цветов вне токенов

Известные на момент design: `selftest__result` (#1a7f37/#c62828), `save-state` (rgba-пяди четырёх статусов) в `index.css`; возможны хексы в css пакетов — полный grep на реализации (`#([0-9a-f]{3,8})\b|rgba?\(|hsla?\(|oklch\(`). Замена: `var(--success)` и т.п.; фоновые подложки — `color-mix(in oklch, var(--token) 10%, transparent)`.

## D8. Риски и проверки

- **oklch**: целевые браузеры (2 последние мажора Chrome/Edge/Firefox/Safari, ADR-4) поддерживают — риска нет.
- **e2e**: цветовых ассертаций в `tests/` нет (проверить grep'ом `#`, `rgb`, `toHaveCSS`); прогон полного набора на чистой среде обязателен (правило AGENTS: `pkill vite preview`, порт 4173).
- **Промежуточный вид**: до PBT-073/074 SVAR/RCT переходят на нейтрально-тёмные спец. токены — допустимое промежуточное состояние серии.
- Скриншоты до/после в `change/screenshots/`; проверка вручную на 1024×778 и широком экране; контроль контрастов визуально по референсу.

## D9. Проверка DoD

- `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(' --include='*.css' apps packages` — совпадения только в `tokens.css` (импорт-строки шрифтов не в счёт: они в `main.tsx`).
- DevTools → Network: фильтр font — только локальные бандлы.
- Визуальное сравнение с `screenshots/redesign-ref/01-dashboard-overview.png` (допустимы отличия в компоновке — компоненты ещё старые).
