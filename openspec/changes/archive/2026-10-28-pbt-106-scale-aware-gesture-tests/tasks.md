## 1. Масштабно-зависимый helper

- [x] 1.1 Заменить фиксированный `96px` на целевое смещение в календарных днях, вычисленное через `zoomPxPerDay('days')`; проверить, что движение в два дня соответствует 48px в текущем дневном масштабе.
- [x] 1.2 Использовать вычисленный delta для обычного drag/resize и отпускания вне чарта; production browser-набором подтвердить неизменность ожидаемых дат, ревизий, соседних задач и завершения жестов.

## 2. Регрессионная проверка и PR

- [x] 2.1 Собрать production preview и выполнить все 10 сценариев `tests/e2e/shared-plan-gestures.spec.ts` без retry/skip; убедиться, что исходные 7 сценариев больше не падают.
- [x] 2.2 Выполнить полный набор `npm run verify:repository`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:browser`, `openspec validate pbt-106-scale-aware-gesture-tests --strict` и `openspec validate --all --strict`; подтвердить, что runtime-код не менялся.
- [x] 2.3 Открыть один PR в `develop` по шаблону проекта с описанием baseline-причины и фактических результатов проверок.
