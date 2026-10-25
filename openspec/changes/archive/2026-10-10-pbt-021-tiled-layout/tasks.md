## 1. Адаптер в платформе

- [x] 1.1 Зависимость `react-grid-layout@1.4.4` (точный пин; v2.3.0 отброшена — design D1) (+ devDep @types); `tiled-layout.ts`: типы `TiledArea`, `TiledItem`, конверсия `sizeConstraints → min/max`, дефолтный размер, сериализация `Record<instanceId, {x,y,w,h}>` в обе стороны
- [x] 1.2 `TiledLayout.tsx`: рендер RGL (cols 12, rowHeight 72, gap 12, vertical compact), ручка `.widget-window__head`, placeholder, resize-уголок; колбэк `onLayoutChange` в собственной структуре; unit-тесты конверсий и ограничений

## 2. Приложение

- [x] 2.1 `App.tsx`: раскладка per tab (Record instanceId → область), новые окна — свободная область с дефолтным размером; сворачивание: `h:1` с запоминанием прежней высоты, разворачивание — возврат
- [x] 2.2 `index.css`: стили сетки/placeholder/resize на токенах; базовые CSS RGL импортированы в адаптере платформы (резолв от пакета); `.instances` — область вкладки с вертикальной прокруткой

## 3. Сквозная проверка

- [x] 3.1 E2E: 4–6 окон — перенос за заголовок (drag) сдвигает соседей, поле ввода не переносит окно; resize соблюдает минимум типа; сворачивание сжимает до строки, разворачивание возвращает; прокрутка при переполнении; скриншот раскладки к PR
- [x] 3.2 Прогнать `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, `openspec validate pbt-021-tiled-layout --strict`; DoD-чекбоксы карточки; реестр (статус, PR)
