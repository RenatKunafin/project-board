# Design — PBT-056 Экспорт PlantUML из интерфейса

## Context

Генератор PBT-055 (`serializePlanToPlantUml` → `{ text, report }`) готов; механика скачивания — прецедент `handleExportPlan` (Blob + `a[download]` + revoke, PBT-051); диалоговые паттерны — `OnlineGanttImportDialog`/`AbsenceConvertDialog`. Тулбар плана: иконочные кнопки 📤/📥 с aria-label и компактным классом.

## Goals / Non-Goals

Goals: предпросмотр текста и ограничений до скачивания; DoD карточки закрыт e2e; офлайн.

Non-Goals (сверх proposal): рендер диаграммы, интеграция с Confluence, профильный выбор состава, экспорт из ресурсного вида.

## Decisions

### D1. Точка входа и состояние

Кнопка 📊 (`data-export-plantuml`, aria-label «Экспорт PlantUML») рядом с 📤/📥. Состояние `plantumlPreview: { text, report, fileName } | undefined` — вычисляется при открытии из актуальных `planRef`/`documentRef` (как `handleExportPlan` PBT-051); фильтры не участвуют (экспорт полного документа). Закрытие/Esc — сброс.

### D2. Диалог `PlantUmlExportDialog`

Props: `text`, `report` (`PlantUmlExportNote[]`), `fileName`, `onDownload()`, `onClose()`. Секции: моноширинный `readonly`-блок текста (`data-plantuml-text`, скролл, выделяем — fallback копирования); «Ограничения» — пункты отчёта, при пустом отчёте — «Все данные плана перенесены»; инструкция (DoD-4): «Текст самодостаточен для любого инструмента PlantUML. В Confluence вставьте его в PlantUML-макрос вашей инсталляции — поддержку и настройки определяет конкретный плагин.» Кнопки: «Скопировать» (`navigator.clipboard.writeText` с `try/catch`, не-блокирующая деградация: скрытая `textarea`+`select()` fallback не вводим — выделение уже доступно в блоке текста), «Скачать .puml» (primary), «Закрыть». Esc — отмена (по образцу).

### D3. Имя файла и скачивание

`plantumlFileName(now)` = `pb-plantuml-YYYY-MM-DD_HH-mm-ss.puml` (прецедент `planFileName`, PBT-050; дефисы ради Windows). Скачивание — Blob `text/plain;charset=utf-8` + `a[download]` + revoke по образцу `handleExportPlan`.

### D4. E2E (`tests/e2e/plantuml-export.spec.ts`)

Контрольный план (приёмы plan-transfer.spec): экспорт → предпросмотр содержит `@startgantt`…`@endgantt`, `title`, `requires`; ограничения видны (план с лагом); скачивание → `suggestedFilename` матчит шаблон, содержимое файла = текст предпросмотра; экспорт при активном фильтре — все задачи в тексте (скрытая тоже), фильтр после закрытия не изменился; отмена — `writeDocumentContent`-ревизия не менялась? Проверка «не меняет документ»: счётчик задач и повторный экспорт дают тот же текст. data-атрибуты: `data-plantuml-text`, `data-plantuml-copy`, `data-plantuml-download`, `data-plantuml-report`.

### D5. Стили

Свой `plantuml-export-dialog.css` по каркасу диалогов (overlay/head/body/foot, `--color-surface` и токены); моноширинный блок — `font-family: monospace` (системный стек, токена моно в :root нет до PBT-066).

## Risks / Trade-offs

- [Большие планы — длинный текст в DOM] → блок со скроллом, без `<pre>` переполнения (`white-space: pre`, `max-height`); план-500 ≈ 300 строк — приемлемо.
- [Clipboard API требует жеста/secure context] → вызов из onClick; не-secure (http-localhost ок); деградация — ручное выделение текста.

## Migration Plan

Новый UI-слой; откат — удалить диалог и кнопку.

## Open Questions

(нет)
