## 1. Подготовка

- [x] 1.1 Пройти `openspec validate pbt-093-canvas-polish --strict`.

## 2. Реализация

- [x] 2.1 CSS: margin-top 0 панели вкладок (канвас вплотную к вкладкам).
- [x] 2.2 Аутлайн активного жеста: состояние в CascadeLayout, класс окна, CSS (outline primary, без сдвига layout).
- [x] 2.3 Автопрокрутка viewport при drag/resize к нижнему/верхнему краю.

## 3. Проверки

- [x] 3.1 E2e: прижатие к вкладкам (gap 0); аутлайн при переносе/ресайзе; ресайз за нижний край одним жестом.
- [x] 3.2 Полный обязательный набор: verify:repository, lint, typecheck, unit, build, test:browser, `openspec validate --all --strict`; живой браузер + скриншоты в test-results.

## 4. Завершение

- [ ] 4.1 PR в develop с фактически выполненными проверками.
- [ ] 4.2 После принятия PR синхронизировать дельты/архивировать change, дождаться CI архивного коммита, merge; отметить Done по факту.
