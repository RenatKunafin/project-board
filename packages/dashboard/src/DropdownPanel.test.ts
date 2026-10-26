import { describe, expect, it } from 'vitest';
import { dropdownPanelPosition } from './DropdownPanel';

describe('dropdownPanelPosition — clamp к viewport (PBT-090)', () => {
  it('панель под кнопкой, выравнивание по правому краю', () => {
    const p = dropdownPanelPosition(
      { left: 900, right: 1000, top: 40, bottom: 72 },
      { width: 1280, height: 800 },
      { width: 300, height: 400 },
    );
    expect(p).toEqual({ left: 700, top: 78 });
  });

  it('левый край: не выходит за границу экрана', () => {
    const p = dropdownPanelPosition(
      { left: 4, right: 104, top: 40, bottom: 72 },
      { width: 1280, height: 800 },
      { width: 300, height: 400 },
    );
    expect(p.left).toBe(8);
  });

  it('правый край: кламп к ширине viewport', () => {
    const p = dropdownPanelPosition(
      { left: 1180, right: 1280, top: 40, bottom: 72 },
      { width: 1280, height: 800 },
      { width: 300, height: 400 },
    );
    expect(p.left).toBe(1280 - 300 - 8);
  });

  it('нехватка высоты внизу — разворот вверх над кнопкой', () => {
    const p = dropdownPanelPosition(
      { left: 900, right: 1000, top: 700, bottom: 732 },
      { width: 1280, height: 800 },
      { width: 300, height: 400 },
    );
    expect(p.top).toBe(700 - 400 - 6);
  });

  it('разворот вверх не выходит за верхнюю границу', () => {
    const p = dropdownPanelPosition(
      { left: 900, right: 1000, top: 100, bottom: 132 },
      { width: 1280, height: 300 },
      { width: 300, height: 400 },
    );
    expect(p.top).toBe(8);
  });
});
