# Design — PBT-070 Рамка окна в стиле прототипа

Референс: `flexi-dashboard-hub/src/components/dashboard/WidgetFrame.tsx` (header, IconBtn, resize-уголок), `screenshots/redesign-ref/13-collapsed-widget.png`.

## D1. Заголовок 32px: состав и типографика

Прототип: `h-8` (32px), `bg-surface-raised/40`, `border-b`, содержимое — маркер, grip, название `text-sm text-gray-100/90` (14px, обычный вес), кнопки справа.

Реализация в `index.css`:

- `.widget-window__head { height: 32px; padding: 0 8px; gap: 8px; background: color-mix(in oklch, var(--surface-raised) 40%, transparent); border-bottom: 1px solid var(--border); }` (фон уже с PBT-069 — фиксируется высота и паддинги).
- Слева: иконка типа (emoji, `widget-window__icon`, 13px) → **ручка `GripVertical`** (lucide, 14px, `color-mix(in oklch, var(--muted-foreground) 60%, transparent)`) — визуальный указатель переносимости из прототипа.
- **Отклонение:** цветная точка-индикатор прототипа (`bg-warning`, 10px) не переносится — в нашем заголовке левую позицию занимает функциональная иконка типа виджета; точка не несёт данных. Заявлено в proposal Non-goals.
- `.widget-window__title { font-size: 14px; font-weight: 400; color: color-mix(in oklch, var(--foreground) 90%, transparent); }` — прежде 12px/600.

Свернутое окно — прежняя семантика PBT-027 (head-only, нижняя граница прозрачна).

## D2. Кнопки 24×24 ghost

Прототип `IconBtn`: `h-6 w-6 rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground`, danger-вариант `hover:text-destructive`.

- `.widget-window__button { width: 24px; height: 24px; border-radius: var(--radius-sm); }` (flex-центрирование и svg 16px уже с PBT-069; ChevronUp/ChevronDown/X — lucide).
- `.widget-window__button:hover { background: var(--accent); color: var(--foreground); }` — уже есть.
- **Закрытие:** класс-модификатор `widget-window__button--danger`, hover — `color: var(--destructive)` (фон — тот же accent). В `WidgetWindow.tsx` добавляется класс кнопке закрытия; aria-label не меняется.
- Кнопки остаются в контейнере `widget-window__actions` с `mousedown stopPropagation` (существующая защита от drag-ручки сетки — не трогать).

## D3. Resize-уголок каскада

Прототип: SVG `M9 3 L3 9 M9 6 L6 9`, stroke 1.2, muted/70 — «двойной диагональный штрих» 16×16 в правом нижнем углу.

Реализация без литеральных цветов и без SVG-файлов: два псевдоэлемента `::before`/`::after` на `.cascade-resize-se` — полоски 2px `background: var(--muted-foreground)`, повёрнутые на 45°, разнесённые по диагонали (7px и 4px от угла). Хэндл 16×16, `cursor-se-resize` — уже есть. Ручки остальных сторон (`cascade-resize`) не меняются.

Правило токенов соблюдено: цвет — `var(--muted-foreground)`.

## D4. Переходы рамки

`.widget-window { transition: box-shadow 150ms ease, border-color 150ms ease; }` — как `transition-[box-shadow,border-color]` прототипа. Только эти свойства: активация (`primary` + `shadow-float`, с PBT-069) анимируется мягко, геометрия не анимируется (жесты раскладок не затрагиваются).

## D5. Сетка (тайлинг)

Хэндл RGL (`react-resizable-handle`) остаётся штатным: цвет уже токеном (PBT-069), геометрию и поведение не трогаем — CSS-переопределение хэндла RGL рассинхронизирует жесты (прецедент PBT-068). Визуальное выравнивание хэндла сетки — потенциальная будущая правка в границах layout-задач, не этой.

## D6. Поведение и доступность

Изменения строго визуальные: разметка кнопок, aria-label, обработчики, контракты SDK — без изменений. Существующие e2e `widget-windows` (клики по aria-label с названием экземпляра) остаются валидны; добавляется визуальная сверка скриншотами. Ручная проверка: сворачивание, закрытие, активация, drag/resize в обоих режимах, 1024×778 и широкий экран.

## D7. Риски

- Фикс-высота 32px: длинные emoji-иконки не влияют (13px); проверяется визуально.
- `color-mix` с прозрачностью для цвета текста заголовка — поддержан целевыми браузерами (oklch-миксы уже используются с PBT-069).
- Промежуточных миграций нет: правки css + один класс в tsx.
