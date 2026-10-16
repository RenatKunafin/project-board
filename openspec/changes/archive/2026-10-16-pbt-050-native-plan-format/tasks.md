# Tasks — PBT-050 Native plan format

## Реализация

1. [x] `packages/gantt/src/native-plan-format.ts`: константы `PLAN_FILE_FORMAT`/`PLAN_FILE_FORMAT_VERSION`, типы конверта и диагностики, `serializePlanFile` (D1–D3).
2. [x] `planFileName(now: Date): string` — шаблон `pb-plan-YYYY-MM-DD_HH-mm-ss.json` (D8).
3. [x] `deserializePlanFile`: пайплайн ранних отклонений — JSON, конверт, формат, будущая версия, версия содержимого (D4).
4. [x] Подключение `parsePlanContent` к десериализации: `plan-invalid` с полным перечнем проблем (D4.6).
5. [x] Экспорт нового модуля из `packages/gantt/src/index.ts`.

## Тесты (unit, `native-plan-format.test.ts`)

6. [x] Сериализация: полный контрольный план — все разделы в файле; название из payload; производные значения отсутствуют; форматированный JSON.
7. [x] `planFileName`: фиксированная дата → ожидаемая строка шаблона; нули в компонентах (детерминизм, D8).
8. [x] Диагностика десериализации: битый JSON; не-объект/неполный конверт (`invalid-envelope`); чужой `format` (`unknown-format`); `formatVersion` больше поддерживаемой (`unsupported-future-version`); `schemaVersion` не поддерживается; вход не изменяется.
9. [x] Невалидное содержимое: битая ссылка/цикл групп — `plan-invalid` с деталями `parsePlanContent`.
10. [x] Round-trip: `serialize → deserialize` восстанавливает название и все разделы идентично (DoD-1); дополнительное поле задачи проходит без потерь (D6).
11. [x] Политика идентификаторов: два импорта одного файла — независимые планы с одинаковыми внутренними ID, мутация одного не видна в другом (DoD-4, D5).

## Артефакты формата

12. [x] `tests/fixtures/gantt/native-plan-sample.json` — эталонный файл, все разделы модели (D7).
13. [x] `packages/gantt/NATIVE-PLAN-FORMAT.md` — описание формата: конверт, семантика дат, коды диагностики, политика ID, шаблон имени файла, ограничение v1 (D7, D8).

## Проверки и завершение

14. [x] `npm run lint` · `npm run typecheck` · `npm test` — зелёные.
15. [x] `openspec validate pbt-050-native-plan-format --strict` — зелёное.
16. [x] Отметить выполненные пункты DoD в карточке PBT-050; статус задачи в реестре — по циклу (In progress после ревью артефактов).
