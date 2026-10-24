import { describe, expect, it } from 'vitest';
import {
  addTab,
  createWorkspaceState,
  removeTab,
  renameTab,
  setActive,
  WorkspaceError,
} from './workspace.js';

describe('workspace — создание и переключение', () => {
  it('создаёт рабочее пространство с одной активной вкладкой', () => {
    const state = createWorkspaceState('Чек-листы');
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ title: 'Чек-листы' });
    expect(state.activeId).toBe(state.tabs[0].id);
  });

  it('новая вкладка становится активной, порядок сохраняется', () => {
    let state = createWorkspaceState('Чек-листы');
    state = addTab(state, 'План ОКАД');
    expect(state.tabs.map((tab) => tab.title)).toEqual([
      'Чек-листы',
      'План ОКАД',
    ]);
    expect(state.activeId).toBe(state.tabs[1].id);
  });

  it('переключение активной вкладки', () => {
    let state = createWorkspaceState('A');
    state = addTab(state, 'B');
    state = setActive(state, state.tabs[0].id);
    expect(state.activeId).toBe(state.tabs[0].id);
  });

  it('неизвестный id отклоняется', () => {
    const state = createWorkspaceState('A');
    expect(() => setActive(state, 'missing')).toThrowError(WorkspaceError);
  });
});

describe('workspace — переименование', () => {
  it('переименовывает вкладку', () => {
    let state = createWorkspaceState('Новая вкладка');
    state = renameTab(state, state.tabs[0].id, 'План ОКАД');
    expect(state.tabs[0].title).toBe('План ОКАД');
  });

  it('пустое название не применяется', () => {
    const state = createWorkspaceState('План ОКАД');
    expect(() => renameTab(state, state.tabs[0].id, '   ')).toThrowError(
      WorkspaceError,
    );
    expect(state.tabs[0].title).toBe('План ОКАД');
  });
});

describe('workspace — удаление', () => {
  it.each([
    { count: 2, removed: 0, active: 0, expected: 'B' },
    { count: 3, removed: 0, active: 0, expected: 'B' },
    { count: 3, removed: 1, active: 1, expected: 'C' },
    { count: 3, removed: 2, active: 2, expected: 'B' },
    { count: 3, removed: 0, active: 1, expected: 'B' },
    { count: 3, removed: 2, active: 1, expected: 'B' },
  ])('сосед после закрытия: $count вкладки, удалена $removed, активна $active', ({ count, removed, active, expected }) => {
    let state = createWorkspaceState('A');
    for (const title of ['B', 'C'].slice(0, count - 1)) state = addTab(state, title);
    state = setActive(state, state.tabs[active].id);
    const result = removeTab(state, state.tabs[removed].id);
    expect(result.tabs.find(tab => tab.id === result.activeId)?.title).toBe(expected);
    expect(result.tabs).toHaveLength(count - 1);
  });

  it('удаляет активную: активной становится соседняя справа', () => {
    let state = createWorkspaceState('A');
    state = addTab(state, 'B'); // активна B
    const aId = state.tabs[0].id;
    const bId = state.tabs[1].id;
    state = setActive(state, bId);
    state = removeTab(state, bId);
    expect(state.tabs.map((tab) => tab.title)).toEqual(['A']);
    expect(state.activeId).toBe(aId);
  });

  it('удаление крайней правой активной делает активной соседнюю слева', () => {
    let state = createWorkspaceState('A');
    state = addTab(state, 'B'); // активна B (крайняя правая)
    state = removeTab(state, state.tabs[1].id);
    expect(state.activeId).toBe(state.tabs[0].id);
  });

  it('последняя вкладка не удаляется', () => {
    const state = createWorkspaceState('A');
    expect(() => removeTab(state, state.tabs[0].id)).toThrowError(
      WorkspaceError,
    );
    expect(state.tabs).toHaveLength(1);
  });

  it('неактивная вкладка удаляется без смены активной', () => {
    let state = createWorkspaceState('A');
    state = addTab(state, 'B'); // активна B
    const aId = state.tabs[0].id;
    state = removeTab(state, aId);
    expect(state.activeId).toBe(state.tabs[0].id);
  });
});
